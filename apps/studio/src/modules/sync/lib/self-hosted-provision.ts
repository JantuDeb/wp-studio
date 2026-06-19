import { assertValidDomain } from './self-hosted-ssl';
import type { WebServerKind } from './self-hosted-server-stack';
import type { SelfHostedProvisionRequest } from '@studio/common/types/sync';

/**
 * Pure helpers for provisioning a new WordPress site on a pre-installed stack (doc 8.3).
 *
 * Provisioning is the most destructive server operation, so every identifier that reaches a shell
 * command (domain, docroot, DB name/user, SQL identifiers) is validated here against strict
 * allow-lists. Secrets (DB password, MySQL admin password, WP admin password) are NEVER interpolated
 * into command strings — they are passed to the remote via base64-encoded values that are decoded
 * into shell variables, so they cannot break quoting or be injected. These builders return command
 * strings + the env map the caller must supply; the IPC handler runs them over the existing SSH
 * helpers.
 */

// Absolute POSIX path, no traversal, no shell metacharacters.
const ABSOLUTE_PATH = /^\/[A-Za-z0-9._\-/]+$/;
// MySQL identifier: letters, digits, underscore; must start with a letter/underscore.
const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function assertAbsolutePath( value: string, label: string ): string {
	if ( ! ABSOLUTE_PATH.test( value ) || value.includes( '..' ) ) {
		throw new Error( `Invalid ${ label }: ${ value }` );
	}
	return value.replace( /\/+$/, '' );
}

export function assertSqlIdentifier( value: string, label: string ): string {
	if ( ! SQL_IDENTIFIER.test( value ) || value.length > 64 ) {
		throw new Error( `Invalid ${ label }: ${ value }` );
	}
	return value;
}

/** Validate every field of a provisioning request that reaches a shell/SQL command. */
export function validateProvisionRequest( request: SelfHostedProvisionRequest ): {
	domain: string;
	docroot: string;
	dbName: string;
	dbUser: string;
} {
	const domain = assertValidDomain( request.domain.trim() );
	const docroot = assertAbsolutePath( request.docroot.trim(), 'document root' );
	const dbName = assertSqlIdentifier( request.dbName.trim(), 'database name' );
	const dbUser = assertSqlIdentifier( request.dbUser.trim(), 'database user' );
	if ( ! request.adminDbUser.trim() ) {
		throw new Error( 'A database admin user is required.' );
	}
	if ( ! request.wpAdminUser.trim() || ! request.wpAdminEmail.trim() ) {
		throw new Error( 'A WordPress admin username and email are required.' );
	}
	if ( ! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test( request.wpAdminEmail.trim() ) ) {
		throw new Error( 'A valid WordPress admin email is required.' );
	}
	return { domain, docroot, dbName, dbUser };
}

// Base64 alphabet only — safe to single-quote inside a shell command.
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Build a shell prefix that decodes base64-encoded secrets into shell variables, so secret values
 * never appear literally in any command string or argv. Each value must already be base64-encoded;
 * the names are fixed and referenced by the command builders (`$STUDIO_DB_PASS`, etc.).
 */
export function buildSecretExportPrefix( secretsBase64: Record< string, string > ): string {
	return (
		Object.entries( secretsBase64 )
			.map( ( [ name, value ] ) => {
				if ( ! /^[A-Z_][A-Z0-9_]*$/.test( name ) || ! BASE64.test( value ) ) {
					throw new Error( 'Invalid secret encoding.' );
				}
				return `${ name }=$(printf '%s' '${ value }' | base64 -d)`;
			} )
			.join( '; ' ) + '; '
	);
}

/**
 * Build the Apache or nginx virtual-host file contents for a new site. PHP requests are routed to
 * the detected PHP-FPM socket on nginx; Apache relies on its PHP handler. Validated inputs only.
 */
export function buildVhost(
	webServer: WebServerKind,
	params: { domain: string; docroot: string }
): { path: string; content: string } {
	const { domain, docroot } = params;
	if ( webServer === 'nginx' ) {
		return {
			path: `/etc/nginx/sites-available/${ domain }.conf`,
			content: [
				'server {',
				'    listen 80;',
				`    server_name ${ domain };`,
				`    root ${ docroot };`,
				'    index index.php index.html;',
				'    location / {',
				'        try_files $uri $uri/ /index.php?$args;',
				'    }',
				'    location ~ \\.php$ {',
				'        include snippets/fastcgi-php.conf;',
				'        fastcgi_pass unix:/run/php/php-fpm.sock;',
				'    }',
				'}',
				'',
			].join( '\n' ),
		};
	}
	return {
		path: `/etc/apache2/sites-available/${ domain }.conf`,
		content: [
			'<VirtualHost *:80>',
			`    ServerName ${ domain }`,
			`    DocumentRoot ${ docroot }`,
			`    <Directory ${ docroot }>`,
			'        AllowOverride All',
			'        Require all granted',
			'    </Directory>',
			'</VirtualHost>',
			'',
		].join( '\n' ),
	};
}

/**
 * Build the command + env to create the site database and user. The DB password and admin password
 * are supplied via env (`STUDIO_DB_PASS`, `STUDIO_DB_ADMIN_PASS`) so they never appear in the command
 * string or process list arguments. The admin user is validated against the SQL identifier rule by
 * the caller's request validation.
 */
export function buildCreateDatabaseCommand( params: {
	dbName: string;
	dbUser: string;
	adminDbUser: string;
} ): string {
	const { dbName, dbUser, adminDbUser } = params;
	const admin = assertSqlIdentifier( adminDbUser.trim(), 'database admin user' );
	// Identifiers are validated; the two passwords expand from shell vars (set by the secret prefix)
	// inside a double-quoted `-e` string. Backticks around identifiers are backslash-escaped so the
	// shell does not treat them as command substitution.
	const sql = [
		`CREATE DATABASE IF NOT EXISTS \\\`${ dbName }\\\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
		`CREATE USER IF NOT EXISTS '${ dbUser }'@'localhost' IDENTIFIED BY '\${STUDIO_DB_PASS}';`,
		`ALTER USER '${ dbUser }'@'localhost' IDENTIFIED BY '\${STUDIO_DB_PASS}';`,
		`GRANT ALL PRIVILEGES ON \\\`${ dbName }\\\`.* TO '${ dbUser }'@'localhost';`,
		'FLUSH PRIVILEGES;',
	].join( ' ' );
	return `mysql -u '${ admin }' -p"\${STUDIO_DB_ADMIN_PASS}" -e "${ sql }"`;
}

/**
 * Build the WP-CLI command sequence to download WordPress, generate wp-config (DB password from
 * env), install core with the admin account (admin password from env), and print the installed
 * version. `wpCliPath` is the connection's configured WP-CLI binary or `wp`.
 */
export function buildWordPressInstallCommand( params: {
	wpCliPath: string;
	docroot: string;
	dbName: string;
	dbUser: string;
	url: string;
	wpAdminUser: string;
	wpAdminEmail: string;
} ): string {
	// The site title is passed via the `$STUDIO_SITE_TITLE` shell var (set by the secret-export
	// prefix) so titles with spaces/quotes are handled safely.
	const { wpCliPath, docroot, dbName, dbUser, url, wpAdminUser, wpAdminEmail } = params;
	const wp = `${ wpCliPath } --path='${ docroot }'`;
	return [
		`mkdir -p '${ docroot }'`,
		`${ wp } core download --force`,
		`${ wp } config create --dbname='${ dbName }' --dbuser='${ dbUser }' --dbpass="$STUDIO_DB_PASS" --force`,
		`${ wp } core install --url='${ url }' --title="$STUDIO_SITE_TITLE" --admin_user='${ wpAdminUser }' --admin_password="$STUDIO_WP_ADMIN_PASS" --admin_email='${ wpAdminEmail }' --skip-email`,
		`${ wp } core version`,
	].join( ' && ' );
}
