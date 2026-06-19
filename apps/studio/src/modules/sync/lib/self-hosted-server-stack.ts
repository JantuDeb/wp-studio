import type { SelfHostedServerStack } from '@studio/common/types/sync';

/**
 * Foundation for remote server-config management (doc section 8.0). Everything here is pure: a single
 * SSH probe command, a parser for its output, and a web-server adapter that builds the per-server
 * (Apache vs nginx) shell commands used by 8.1–8.3. Keeping it side-effect-free makes it unit
 * testable without a live host; the IPC handlers run these commands over the existing SSH helpers.
 */

// A single, side-effect-free probe. Each line is `key=value`; missing tools yield empty values.
// Quoting/escaping of the WordPress path happens at the call site.
export function getServerStackProbeCommand( docrootHint: string ): string {
	const lines = [
		'printf \'os=%s\\n\' "$(. /etc/os-release 2>/dev/null && printf \'%s\' "$PRETTY_NAME" || uname -s)"',
		// Web server: prefer a running process, fall back to which.
		"if command -v apache2 >/dev/null 2>&1 || command -v httpd >/dev/null 2>&1; then printf 'apache_present=1\\n'; fi",
		"if command -v nginx >/dev/null 2>&1; then printf 'nginx_present=1\\n'; fi",
		"printf 'apache_version=%s\\n' \"$( (apache2 -v 2>/dev/null || httpd -v 2>/dev/null) | sed -n 's@.*Apache/\\([0-9.]*\\).*@\\1@p' | head -n1)\"",
		"printf 'nginx_version=%s\\n' \"$(nginx -v 2>&1 | sed -n 's@.*nginx/\\([0-9.]*\\).*@\\1@p' | head -n1)\"",
		"printf 'php_version=%s\\n' \"$(php -r 'echo PHP_VERSION;' 2>/dev/null)\"",
		"if command -v php-fpm >/dev/null 2>&1 || ls /etc/php*/fpm >/dev/null 2>&1; then printf 'php_fpm=1\\n'; fi",
		'printf \'mysql_version=%s\\n\' "$(mysql --version 2>/dev/null | head -n1)"',
		`printf 'docroot=%s\\n' "${ docrootHint }"`,
		// Non-interactive sudo check.
		"if sudo -n true 2>/dev/null; then printf 'can_sudo=1\\n'; fi",
	];
	return lines.join( '; ' );
}

/**
 * Parse the probe output into a structured stack. The `docrootHint` is the WordPress path Studio
 * already knows from the connection, used to look up the matching vhost/.htaccess later.
 */
export function parseServerStackProbe(
	output: string,
	docrootHint: string
): SelfHostedServerStack {
	const values = new Map< string, string >();
	for ( const line of output.split( '\n' ) ) {
		const index = line.indexOf( '=' );
		if ( index > 0 ) {
			values.set( line.slice( 0, index ).trim(), line.slice( index + 1 ).trim() );
		}
	}

	const apachePresent = values.get( 'apache_present' ) === '1';
	const nginxPresent = values.get( 'nginx_present' ) === '1';
	let webServer: SelfHostedServerStack[ 'webServer' ] = 'unknown';
	if ( apachePresent && ! nginxPresent ) {
		webServer = 'apache';
	} else if ( nginxPresent && ! apachePresent ) {
		webServer = 'nginx';
	} else if ( apachePresent && nginxPresent ) {
		// Both installed: prefer whichever reports a version (typically the active one).
		webServer = values.get( 'nginx_version' ) ? 'nginx' : 'apache';
	}

	const mysqlRaw = values.get( 'mysql_version' ) || '';
	const isMariaDb = /mariadb/i.test( mysqlRaw );
	const dbEngine = mysqlRaw ? ( isMariaDb ? 'MariaDB' : 'MySQL' ) : null;
	// MariaDB reports `... Ver 15.1 Distrib 10.11.2-MariaDB`: the real engine version follows
	// `Distrib`, while the leading number is just the mysql client/protocol version.
	const dbVersionMatch =
		( isMariaDb ? mysqlRaw.match( /Distrib\s+([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i ) : null ) ||
		mysqlRaw.match( /([0-9]+\.[0-9]+(?:\.[0-9]+)?)/ );

	const nonEmpty = ( key: string ): string | null => {
		const value = values.get( key );
		return value ? value : null;
	};

	return {
		os: values.get( 'os' ) || 'unknown',
		webServer,
		webServerVersion:
			webServer === 'apache'
				? nonEmpty( 'apache_version' )
				: webServer === 'nginx'
				? nonEmpty( 'nginx_version' )
				: null,
		phpVersion: nonEmpty( 'php_version' ),
		phpFpm: values.get( 'php_fpm' ) === '1',
		dbEngine,
		dbVersion: dbVersionMatch ? dbVersionMatch[ 1 ] : null,
		docroot: docrootHint || null,
		configPaths: { vhost: null, htaccess: null },
		canSudo: values.get( 'can_sudo' ) === '1',
	};
}

export type WebServerKind = 'apache' | 'nginx';

/**
 * A web-server adapter exposes the same operations for Apache and nginx, so the feature handlers
 * (8.1 rewrites, 8.2 SSL, 8.3 vhost creation) build commands through one interface. All methods
 * return shell command strings; the caller runs them over SSH and wraps them in the
 * backup→validate→reload→rollback safety flow.
 */
export type WebServerAdapter = {
	kind: WebServerKind;
	/** Validate the server configuration; non-zero exit indicates an invalid config. */
	testConfigCommand: () => string;
	/** Gracefully reload the server to apply config changes. */
	reloadCommand: () => string;
	/** Reload PHP-FPM (best-effort; a no-op-ish `true` fallback when not present). */
	reloadPhpFpmCommand: () => string;
};

function withSudo( canSudo: boolean, command: string ): string {
	return canSudo ? `sudo ${ command }` : command;
}

export function getWebServerAdapter( kind: WebServerKind, canSudo: boolean ): WebServerAdapter {
	if ( kind === 'nginx' ) {
		return {
			kind,
			testConfigCommand: () => withSudo( canSudo, 'nginx -t' ),
			reloadCommand: () => withSudo( canSudo, 'nginx -s reload' ),
			reloadPhpFpmCommand: () =>
				withSudo( canSudo, "sh -c 'systemctl reload php*-fpm 2>/dev/null || true'" ),
		};
	}
	return {
		kind,
		// `apachectl` on most distros; `apache2ctl` on Debian/Ubuntu — try both.
		testConfigCommand: () =>
			withSudo( canSudo, "sh -c 'apachectl configtest 2>/dev/null || apache2ctl configtest'" ),
		reloadCommand: () =>
			withSudo( canSudo, "sh -c 'apachectl graceful 2>/dev/null || apache2ctl graceful'" ),
		reloadPhpFpmCommand: () =>
			withSudo( canSudo, "sh -c 'systemctl reload php*-fpm 2>/dev/null || true'" ),
	};
}

/**
 * Build the safe-config-edit command sequence: snapshot the target file to a timestamped backup,
 * write the new content, run the server config test, and on failure restore the backup. The new
 * content is provided base64-encoded by the caller to avoid shell-quoting hazards. `timestamp` is
 * injected (not read from the clock) so the result is deterministic and testable.
 *
 * Returns a single `&&`/`||`-composed command that exits non-zero (after restoring) if validation
 * fails, so the caller can detect and surface the failure.
 */
export function getSafeConfigEditCommand( params: {
	targetPath: string;
	contentBase64: string;
	testConfigCommand: string;
	timestamp: number;
} ): { command: string; backupPath: string } {
	const { targetPath, contentBase64, testConfigCommand, timestamp } = params;
	const backupPath = `${ targetPath }.studio-bak-${ timestamp }`;
	const command = [
		`cp -p '${ targetPath }' '${ backupPath }' 2>/dev/null || true`,
		`printf '%s' '${ contentBase64 }' | base64 -d > '${ targetPath }'`,
		// Validate; if it fails, restore the backup and exit non-zero.
		`if ! ${ testConfigCommand }; then cp -p '${ backupPath }' '${ targetPath }' 2>/dev/null; echo 'studio-config-validation-failed' >&2; exit 1; fi`,
	].join( ' && ' );
	return { command, backupPath };
}
