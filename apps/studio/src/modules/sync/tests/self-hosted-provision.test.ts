import {
	assertAbsolutePath,
	assertSqlIdentifier,
	buildCreateDatabaseCommand,
	buildSecretExportPrefix,
	buildVhost,
	buildWordPressInstallCommand,
	validateProvisionRequest,
} from 'src/modules/sync/lib/self-hosted-provision';
import type { SelfHostedProvisionRequest } from '@studio/common/types/sync';

function request(
	overrides: Partial< SelfHostedProvisionRequest > = {}
): SelfHostedProvisionRequest {
	return {
		domain: 'example.com',
		docroot: '/var/www/example',
		dbName: 'example_db',
		dbUser: 'example_user',
		dbPassword: 'p@ss w0rd!',
		adminDbUser: 'root',
		adminDbPassword: 'rootpw',
		siteTitle: 'Example Site',
		wpAdminUser: 'admin',
		wpAdminPassword: 'wp-admin-pw',
		wpAdminEmail: 'admin@example.com',
		...overrides,
	};
}

describe( 'provision validators', () => {
	it( 'accepts valid identifiers and paths', () => {
		expect( assertAbsolutePath( '/var/www/site/', 'docroot' ) ).toBe( '/var/www/site' );
		expect( assertSqlIdentifier( 'wp_db', 'db' ) ).toBe( 'wp_db' );
	} );

	it( 'rejects path traversal and shell metacharacters in paths', () => {
		expect( () => assertAbsolutePath( '/var/../etc/passwd', 'docroot' ) ).toThrow();
		expect( () => assertAbsolutePath( '/var/www/$(rm -rf /)', 'docroot' ) ).toThrow();
		expect( () => assertAbsolutePath( 'relative/path', 'docroot' ) ).toThrow();
	} );

	it( 'rejects SQL identifiers with injection characters', () => {
		expect( () => assertSqlIdentifier( 'db; DROP TABLE x', 'db' ) ).toThrow();
		expect( () => assertSqlIdentifier( 'db`', 'db' ) ).toThrow();
		expect( () => assertSqlIdentifier( '1db', 'db' ) ).toThrow();
	} );

	it( 'validates a full request and rejects a bad email', () => {
		expect( validateProvisionRequest( request() ) ).toEqual( {
			domain: 'example.com',
			docroot: '/var/www/example',
			dbName: 'example_db',
			dbUser: 'example_user',
		} );
		expect( () => validateProvisionRequest( request( { wpAdminEmail: 'nope' } ) ) ).toThrow();
		expect( () => validateProvisionRequest( request( { domain: 'bad domain' } ) ) ).toThrow();
	} );
} );

describe( 'buildVhost', () => {
	it( 'builds an nginx server block routing PHP to FPM', () => {
		const vhost = buildVhost( 'nginx', { domain: 'example.com', docroot: '/var/www/example' } );
		expect( vhost.path ).toBe( '/etc/nginx/sites-available/example.com.conf' );
		expect( vhost.content ).toContain( 'server_name example.com;' );
		expect( vhost.content ).toContain( 'root /var/www/example;' );
		expect( vhost.content ).toContain( 'fastcgi_pass' );
	} );

	it( 'builds an apache vhost with AllowOverride', () => {
		const vhost = buildVhost( 'apache', { domain: 'example.com', docroot: '/var/www/example' } );
		expect( vhost.path ).toBe( '/etc/apache2/sites-available/example.com.conf' );
		expect( vhost.content ).toContain( 'DocumentRoot /var/www/example' );
		expect( vhost.content ).toContain( 'AllowOverride All' );
	} );
} );

describe( 'buildSecretExportPrefix', () => {
	it( 'decodes base64 secrets into shell variables', () => {
		const prefix = buildSecretExportPrefix( { STUDIO_DB_PASS: 'Zm9v' } );
		expect( prefix ).toContain( "STUDIO_DB_PASS=$(printf '%s' 'Zm9v' | base64 -d)" );
	} );

	it( 'rejects non-base64 values and invalid variable names', () => {
		expect( () => buildSecretExportPrefix( { STUDIO_DB_PASS: "'; rm -rf /" } ) ).toThrow();
		expect( () => buildSecretExportPrefix( { 'bad-name': 'Zm9v' } ) ).toThrow();
	} );
} );

describe( 'buildCreateDatabaseCommand', () => {
	it( 'references password vars, never literals, and escapes identifiers', () => {
		const command = buildCreateDatabaseCommand( {
			dbName: 'example_db',
			dbUser: 'example_user',
			adminDbUser: 'root',
		} );
		expect( command ).toContain( 'mysql -u \'root\' -p"${STUDIO_DB_ADMIN_PASS}"' );
		expect( command ).toContain( "IDENTIFIED BY '${STUDIO_DB_PASS}'" );
		expect( command ).toContain( 'CREATE DATABASE IF NOT EXISTS' );
		// No literal password is present.
		expect( command ).not.toContain( 'rootpw' );
	} );

	it( 'rejects an invalid admin user', () => {
		expect( () =>
			buildCreateDatabaseCommand( { dbName: 'd', dbUser: 'u', adminDbUser: 'root; DROP' } )
		).toThrow();
	} );
} );

describe( 'buildWordPressInstallCommand', () => {
	it( 'downloads, configures, installs, and prints the version', () => {
		const command = buildWordPressInstallCommand( {
			wpCliPath: 'wp',
			docroot: '/var/www/example',
			dbName: 'example_db',
			dbUser: 'example_user',
			url: 'http://example.com',
			wpAdminUser: 'admin',
			wpAdminEmail: 'admin@example.com',
		} );
		expect( command ).toContain( 'core download --force' );
		expect( command ).toContain( '--dbpass="$STUDIO_DB_PASS"' );
		expect( command ).toContain( '--admin_password="$STUDIO_WP_ADMIN_PASS"' );
		expect( command ).toContain( "--url='http://example.com'" );
		expect( command.trimEnd().endsWith( 'core version' ) ).toBe( true );
	} );
} );
