import {
	getSafeConfigEditCommand,
	getServerStackProbeCommand,
	getWebServerAdapter,
	parseServerStackProbe,
} from 'src/modules/sync/lib/self-hosted-server-stack';

describe( 'getServerStackProbeCommand', () => {
	it( 'embeds the docroot hint and probes each tool', () => {
		const command = getServerStackProbeCommand( '/var/www/html' );
		expect( command ).toContain( 'docroot=%s\\n\' "/var/www/html"' );
		expect( command ).toContain( 'apache_present' );
		expect( command ).toContain( 'nginx_present' );
		expect( command ).toContain( 'php_version' );
		expect( command ).toContain( 'can_sudo' );
	} );
} );

describe( 'parseServerStackProbe', () => {
	it( 'parses a typical Apache + PHP-FPM + MySQL host', () => {
		const output = [
			'os=Ubuntu 22.04.3 LTS',
			'apache_present=1',
			'apache_version=2.4.52',
			'php_version=8.2.10',
			'php_fpm=1',
			'mysql_version=mysql  Ver 8.0.35 for Linux',
			'docroot=/var/www/html',
			'can_sudo=1',
		].join( '\n' );

		const stack = parseServerStackProbe( output, '/var/www/html' );
		expect( stack ).toMatchObject( {
			os: 'Ubuntu 22.04.3 LTS',
			webServer: 'apache',
			webServerVersion: '2.4.52',
			phpVersion: '8.2.10',
			phpFpm: true,
			dbEngine: 'MySQL',
			dbVersion: '8.0.35',
			docroot: '/var/www/html',
			canSudo: true,
		} );
	} );

	it( 'detects nginx and MariaDB', () => {
		const output = [
			'os=Debian GNU/Linux 12',
			'nginx_present=1',
			'nginx_version=1.22.1',
			'php_version=8.1.2',
			'mysql_version=mysql  Ver 15.1 Distrib 10.11.2-MariaDB',
			'docroot=/srv/www',
		].join( '\n' );

		const stack = parseServerStackProbe( output, '/srv/www' );
		expect( stack.webServer ).toBe( 'nginx' );
		expect( stack.webServerVersion ).toBe( '1.22.1' );
		expect( stack.dbEngine ).toBe( 'MariaDB' );
		expect( stack.dbVersion ).toBe( '10.11.2' );
		expect( stack.phpFpm ).toBe( false );
		expect( stack.canSudo ).toBe( false );
	} );

	it( 'prefers the version-reporting server when both are present', () => {
		const output = [ 'apache_present=1', 'nginx_present=1', 'nginx_version=1.24.0' ].join( '\n' );
		expect( parseServerStackProbe( output, '/x' ).webServer ).toBe( 'nginx' );
	} );

	it( 'returns unknown web server and null fields when nothing is detected', () => {
		const stack = parseServerStackProbe( 'os=Alpine', '/x' );
		expect( stack.webServer ).toBe( 'unknown' );
		expect( stack.phpVersion ).toBeNull();
		expect( stack.dbEngine ).toBeNull();
		expect( stack.webServerVersion ).toBeNull();
	} );
} );

describe( 'getWebServerAdapter', () => {
	it( 'builds nginx commands, with sudo when available', () => {
		const adapter = getWebServerAdapter( 'nginx', true );
		expect( adapter.kind ).toBe( 'nginx' );
		expect( adapter.testConfigCommand() ).toBe( 'sudo nginx -t' );
		expect( adapter.reloadCommand() ).toBe( 'sudo nginx -s reload' );
	} );

	it( 'builds apache commands without sudo when unavailable', () => {
		const adapter = getWebServerAdapter( 'apache', false );
		expect( adapter.testConfigCommand() ).toContain( 'configtest' );
		expect( adapter.testConfigCommand().startsWith( 'sudo ' ) ).toBe( false );
		expect( adapter.reloadCommand() ).toContain( 'graceful' );
	} );
} );

describe( 'getSafeConfigEditCommand', () => {
	it( 'backs up, writes, validates, and restores on failure', () => {
		const { command, backupPath } = getSafeConfigEditCommand( {
			targetPath: '/etc/nginx/sites-enabled/site',
			contentBase64: 'Zm9v',
			testConfigCommand: 'nginx -t',
			timestamp: 1700000000000,
		} );

		expect( backupPath ).toBe( '/etc/nginx/sites-enabled/site.studio-bak-1700000000000' );
		expect( command ).toContain( `cp -p '/etc/nginx/sites-enabled/site' '${ backupPath }'` );
		expect( command ).toContain(
			"printf '%s' 'Zm9v' | base64 -d > '/etc/nginx/sites-enabled/site'"
		);
		// Failure branch restores the backup and exits non-zero.
		expect( command ).toContain( 'if ! nginx -t; then' );
		expect( command ).toContain( `cp -p '${ backupPath }' '/etc/nginx/sites-enabled/site'` );
		expect( command ).toContain( 'exit 1' );
	} );
} );
