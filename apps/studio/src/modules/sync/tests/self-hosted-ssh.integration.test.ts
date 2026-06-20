import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { Client } from 'ssh2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify( execFile );
const shouldRun = process.env.RUN_SSH_INTEGRATION_TESTS === '1';
const fixtureDirectory = path.join( __dirname, 'fixtures', 'ssh-wordpress' );
const composeArgs = [ 'compose', '-f', path.join( fixtureDirectory, 'compose.yml' ) ];

async function runDockerCompose( ...args: string[] ): Promise< string > {
	const { stdout } = await execFileAsync( 'docker', [ ...composeArgs, ...args ], {
		cwd: fixtureDirectory,
		timeout: 180_000,
	} );
	return stdout;
}

async function connect(): Promise< Client > {
	return new Promise( ( resolve, reject ) => {
		const client = new Client();
		let settled = false;
		client
			.once( 'ready', () => {
				settled = true;
				resolve( client );
			} )
			.on( 'error', ( error ) => {
				if ( ! settled ) {
					settled = true;
					client.end();
					reject( error );
				}
			} )
			.connect( {
				host: '127.0.0.1',
				port: 22222,
				username: 'studio',
				password: 'studio',
				readyTimeout: 10_000,
			} );
	} );
}

async function connectWithPrivateKey(): Promise< Client > {
	const privateKey = readFileSync( path.join( fixtureDirectory, 'test_key' ) );
	return new Promise( ( resolve, reject ) => {
		const client = new Client();
		let settled = false;
		client
			.once( 'ready', () => {
				settled = true;
				resolve( client );
			} )
			.on( 'error', ( error ) => {
				if ( ! settled ) {
					settled = true;
					client.end();
					reject( error );
				}
			} )
			.connect( {
				host: '127.0.0.1',
				port: 22222,
				username: 'studio',
				privateKey,
				readyTimeout: 10_000,
			} );
	} );
}

async function runSshCommand( client: Client, command: string ): Promise< string > {
	return new Promise( ( resolve, reject ) => {
		client.exec( command, ( error, stream ) => {
			if ( error ) {
				reject( error );
				return;
			}
			let stdout = '';
			let stderr = '';
			stream
				.on( 'data', ( chunk: Buffer ) => {
					stdout += chunk.toString( 'utf8' );
				} )
				.on( 'close', ( code: number | null ) => {
					if ( code === 0 || code === null ) {
						resolve( stdout );
					} else {
						reject( new Error( stderr || `SSH command failed with ${ code }.` ) );
					}
				} );
			stream.stderr.on( 'data', ( chunk: Buffer ) => {
				stderr += chunk.toString( 'utf8' );
			} );
		} );
	} );
}

async function waitForWordPress(): Promise< void > {
	const deadline = Date.now() + 120_000;
	while ( Date.now() < deadline ) {
		try {
			const client = await connect();
			try {
				await runSshCommand(
					client,
					'cd /var/www/html && wp core is-installed || wp core install --url=http://localhost:18080 --title=Studio --admin_user=admin --admin_password=password --admin_email=admin@example.com --skip-email'
				);
				return;
			} finally {
				client.end();
			}
		} catch {
			await new Promise( ( resolve ) => setTimeout( resolve, 2000 ) );
		}
	}
	throw new Error( 'Timed out waiting for the SSH WordPress fixture.' );
}

describe.skipIf( ! shouldRun )( 'self-hosted SSH integration', () => {
	beforeAll( async () => {
		await runDockerCompose( 'up', '--build', '-d', '--wait' );
		await waitForWordPress();
	}, 240_000 );

	afterAll( async () => {
		await runDockerCompose( 'down', '--volumes', '--remove-orphans' );
	}, 120_000 );

	it( 'backs up and restores selected WordPress data without touching unrelated paths', async () => {
		const client = await connect();
		try {
			const result = await runSshCommand(
				client,
				[
					'set -e',
					'cd /var/www/html',
					'mkdir -p wp-content/plugins/selected wp-content/plugins/unrelated .studio-backups/work/sql .studio-backups/work/wp-content/plugins',
					'printf before > wp-content/plugins/selected/state.txt',
					'printf keep > wp-content/plugins/unrelated/state.txt',
					'wp option update studio_sync_fixture before',
					'wp db export .studio-backups/work/sql/database.sql --add-drop-table',
					'cp -a wp-content/plugins/selected .studio-backups/work/wp-content/plugins/selected',
					'tar -czf .studio-backups/fixture.tar.gz -C .studio-backups/work .',
					'printf after > wp-content/plugins/selected/state.txt',
					'printf changed > wp-content/plugins/unrelated/state.txt',
					'wp option update studio_sync_fixture after',
					'rm -rf .studio-backups/restore && mkdir -p .studio-backups/restore',
					'tar -xzf .studio-backups/fixture.tar.gz -C .studio-backups/restore',
					'rm -rf wp-content/plugins/selected',
					'cp -a .studio-backups/restore/wp-content/plugins/selected wp-content/plugins/selected',
					'wp db import .studio-backups/restore/sql/database.sql',
					'printf "%s|%s|%s" "$(cat wp-content/plugins/selected/state.txt)" "$(cat wp-content/plugins/unrelated/state.txt)" "$(wp option get studio_sync_fixture)"',
				].join( ' && ' )
			);
			expect( result.trim().split( '\n' ).at( -1 ) ).toBe( 'before|changed|before' );
		} finally {
			client.end();
		}
	} );

	it( 'authenticates over SSH using a private key', async () => {
		const client = await connectWithPrivateKey();
		try {
			const result = await runSshCommand( client, 'cd /var/www/html && wp core version' );
			expect( result.trim() ).toMatch( /^\d+\.\d+/ );
		} finally {
			client.end();
		}
	} );

	it( 'keeps Studio work and backup paths inside the configured WordPress directory', async () => {
		const client = await connect();
		try {
			const result = await runSshCommand(
				client,
				[
					'set -e',
					'test -d /var/www/html',
					'mkdir -p /var/www/html/.studio-sync-integration',
					'touch /var/www/html/.studio-sync-integration/marker',
					'test ! -e /tmp/studio-sync-integration',
					'printf scoped',
				].join( ' && ' )
			);
			expect( result ).toBe( 'scoped' );
		} finally {
			client.end();
		}
	} );
} );
