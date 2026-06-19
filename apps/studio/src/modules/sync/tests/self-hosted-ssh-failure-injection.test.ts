import EventEmitter from 'events';
import { getSyncConnectionsForLocalSite } from '@studio/common/lib/sync-connections';
import { exportSite } from 'src/modules/import-export/lib/ipc-handlers';
import {
	pushSelfHostedSshSite,
	restoreSelfHostedSshBackup,
} from 'src/modules/sync/lib/ipc-handlers';
import { hydrateSyncConnectionCredentials } from 'src/modules/sync/lib/sync-credential-vault';
import { SiteServer } from 'src/site-server';
import type { IpcMainInvokeEvent } from 'electron';

type ExecHandler = ( command: string ) => { stdout?: string; exitCode?: number };

// A scripted fake ssh2 Client: each `exec` consults the matchers registered for the test, so we
// can inject command failures, bad verification output, and SFTP errors deterministically.
// Hoisted so it is available to the `vi.mock( 'ssh2' )` factory, which vitest lifts above imports.
const { FakeClient } = vi.hoisted( () => {
	const { EventEmitter: NodeEventEmitter } = require( 'events' );
	class FakeClient extends NodeEventEmitter {
		static execHandler: ExecHandler = () => ( { stdout: '', exitCode: 0 } );
		static sftpError: Error | null = null;

		connect() {
			setImmediate( () => this.emit( 'ready' ) );
			return this;
		}

		exec( command: string, cb: ( err: Error | undefined, stream: EventEmitter ) => void ) {
			const result = FakeClient.execHandler( command );
			const stream = new NodeEventEmitter() as EventEmitter & { stderr: EventEmitter };
			stream.stderr = new NodeEventEmitter();
			cb( undefined, stream );
			setImmediate( () => {
				if ( result.stdout ) {
					stream.emit( 'data', Buffer.from( result.stdout ) );
				}
				stream.emit( 'close', result.exitCode ?? 0 );
			} );
		}

		sftp( cb: ( err: Error | undefined, sftp: unknown ) => void ) {
			if ( FakeClient.sftpError ) {
				cb( FakeClient.sftpError, undefined );
				return;
			}
			cb( undefined, {
				fastPut: ( _l: string, _r: string, _o: unknown, done: ( e?: Error ) => void ) => done(),
				fastGet: ( _r: string, _l: string, _o: unknown, done: ( e?: Error ) => void ) => done(),
				end: () => undefined,
			} );
		}

		end() {
			return this;
		}
	}
	return { FakeClient };
} );

vi.mock( 'ssh2', () => ( { Client: FakeClient } ) );
vi.mock( '@studio/common/lib/sync-connections' );
vi.mock( 'src/modules/sync/lib/sync-credential-vault' );
vi.mock( 'src/modules/import-export/lib/ipc-handlers' );
vi.mock( 'src/site-server' );
vi.mock( 'src/lib/get-site-url', () => ( { getSiteUrl: () => 'https://remote.test' } ) );
vi.mock( 'src/ipc-utils', () => ( { sendIpcEventToRenderer: vi.fn() } ) );

vi.mock( 'fs/promises', async ( importOriginal ) => {
	const actual = ( await importOriginal() ) as Record< string, unknown >;
	const overrides = {
		mkdir: vi.fn( async () => undefined ),
		rm: vi.fn( async () => undefined ),
		stat: vi.fn( async () => ( { size: 1024 } ) ),
	};
	return { ...actual, ...overrides, default: { ...actual, ...overrides } };
} );

const LOCAL_SITE_ID = 'local-1';
const CONNECTION_ID = 'conn-1';

const stagingConnection = {
	id: CONNECTION_ID,
	localSiteId: LOCAL_SITE_ID,
	provider: 'self-hosted-ssh',
	syncMode: 'ssh-wp-cli',
	siteUrl: 'https://remote.test',
	environmentType: 'staging',
	lastPullTimestamp: null,
	lastPushTimestamp: null,
	capabilities: {
		canPull: true,
		canPush: true,
		canPushToProduction: false,
		canSyncContent: false,
		canSyncDatabase: true,
		canSyncFiles: true,
		requiresBackupBeforePush: true,
		requiresDryRunBeforeProductionPush: false,
	},
	auth: {
		host: 'example.test',
		port: 22,
		username: 'deploy',
		password: 'secret',
		remoteWordPressPath: '/var/www/html',
	},
};

const event = {} as IpcMainInvokeEvent;
const pushOptions = { optionsToSync: [ 'all' as const ] };

// Plenty of disk: available far exceeds required, so the disk guard passes unless overridden.
const healthyDiskOutput = `${ 50 * 1024 * 1024 * 1024 }\n0`;
const verifyBadOutput = '6.5\nhttps://remote.test\nhttps://remote.test\n3\nfalse';

function scriptCommands( overrides: ExecHandler ) {
	FakeClient.execHandler = overrides;
}

beforeEach( () => {
	FakeClient.execHandler = () => ( { stdout: '', exitCode: 0 } );
	FakeClient.sftpError = null;
	vi.mocked( getSyncConnectionsForLocalSite ).mockResolvedValue( [ stagingConnection as never ] );
	vi.mocked( hydrateSyncConnectionCredentials ).mockResolvedValue( stagingConnection as never );
	vi.mocked( exportSite ).mockResolvedValue( undefined as never );
	vi.mocked( SiteServer.get ).mockReturnValue( {
		details: {},
		executeWpCliCommand: vi.fn( async () => ( { stdout: '', stderr: '', exitCode: 0 } ) ),
	} as unknown as ReturnType< typeof SiteServer.get > );
} );

afterEach( () => {
	vi.clearAllMocks();
} );

describe( 'SSH push failure injection', () => {
	it( 'blocks the push before upload when remote disk space is insufficient', async () => {
		scriptCommands( ( command ) => {
			// Disk estimate: report tiny available space and a huge backup estimate.
			if ( command.includes( 'df -Pk' ) ) {
				return { stdout: `${ 10 * 1024 }\n${ 5 * 1024 * 1024 * 1024 }`, exitCode: 0 };
			}
			return { stdout: '', exitCode: 0 };
		} );

		await expect(
			pushSelfHostedSshSite( event, LOCAL_SITE_ID, CONNECTION_ID, pushOptions )
		).rejects.toThrow( /Not enough remote disk space/ );

		// The upload SFTP step must never run when the guard trips.
		expect( FakeClient.sftpError ).toBeNull();
	} );

	it( 'propagates a remote command failure during backup/apply', async () => {
		scriptCommands( ( command ) => {
			if ( command.includes( 'df -Pk' ) ) {
				return { stdout: healthyDiskOutput, exitCode: 0 };
			}
			if ( command.includes( 'mkdir -p' ) && ! command.includes( 'wp-content' ) ) {
				return { stdout: '', exitCode: 0 };
			}
			// The backup/apply command fails on the remote.
			if ( command.includes( 'tar -czf' ) || command.includes( 'db export' ) ) {
				return { stdout: 'disk write error', exitCode: 1 };
			}
			return { stdout: '', exitCode: 0 };
		} );

		await expect(
			pushSelfHostedSshSite( event, LOCAL_SITE_ID, CONNECTION_ID, pushOptions )
		).rejects.toThrow();
	} );

	it( 'auto-rolls back and reports a failed-state backup when post-push verification fails', async () => {
		scriptCommands( ( command ) => {
			if ( command.includes( 'df -Pk' ) ) {
				return { stdout: healthyDiskOutput, exitCode: 0 };
			}
			// Backup/apply command returns the backup path.
			if ( command.includes( 'printf' ) && command.includes( '.studio-backups' ) ) {
				return { stdout: '/var/www/html/.studio-backups/studio-backup-1.tar.gz\n', exitCode: 0 };
			}
			// Verification reports a bad database, so the push must roll back.
			if ( command.includes( 'core version' ) ) {
				return { stdout: verifyBadOutput, exitCode: 0 };
			}
			return { stdout: '', exitCode: 0 };
		} );

		await expect(
			pushSelfHostedSshSite( event, LOCAL_SITE_ID, CONNECTION_ID, pushOptions )
		).rejects.toThrow( /verification/i );
	} );

	it( 'reports both failures when verification and the rollback both fail', async () => {
		let verifyCalls = 0;
		scriptCommands( ( command ) => {
			if ( command.includes( 'df -Pk' ) ) {
				return { stdout: healthyDiskOutput, exitCode: 0 };
			}
			if ( command.includes( 'printf' ) && command.includes( '.studio-backups' ) ) {
				return { stdout: '/var/www/html/.studio-backups/studio-backup-1.tar.gz\n', exitCode: 0 };
			}
			if ( command.includes( 'core version' ) ) {
				verifyCalls++;
				// First (post-push) and second (post-rollback) verifications both fail.
				return { stdout: verifyBadOutput, exitCode: 0 };
			}
			return { stdout: '', exitCode: 0 };
		} );

		await expect(
			pushSelfHostedSshSite( event, LOCAL_SITE_ID, CONNECTION_ID, pushOptions )
		).rejects.toThrow( /both failed/i );
		expect( verifyCalls ).toBeGreaterThanOrEqual( 2 );
	} );
} );

describe( 'SSH restore failure injection', () => {
	const backupId = 'studio-backup-1.tar.gz';
	const manifest = JSON.stringify( {
		id: backupId,
		createdAt: '2026-01-01T00:00:00.000Z',
		archivePath: `/var/www/html/.studio-backups/${ backupId }`,
		includeDatabase: true,
		selectedPaths: [ 'plugins' ],
		sizeInBytes: 10,
	} );

	beforeEach( () => {
		// The restore flow reads the backup manifest over SFTP via readFile; serve our manifest.
		FakeClient.prototype.sftp = function ( cb: ( err: undefined, sftp: unknown ) => void ) {
			cb( undefined, {
				readFile: ( _path: string, done: ( e: Error | undefined, c: Buffer ) => void ) =>
					done( undefined, Buffer.from( manifest ) ),
				fastPut: ( _l: string, _r: string, _o: unknown, done: ( e?: Error ) => void ) => done(),
				fastGet: ( _r: string, _l: string, _o: unknown, done: ( e?: Error ) => void ) => done(),
				end: () => undefined,
			} );
		} as never;
	} );

	it( 'auto-rolls back to the pre-restore backup when restore verification fails', async () => {
		scriptCommands( ( command ) => {
			if ( command.includes( 'core version' ) ) {
				return { stdout: verifyBadOutput, exitCode: 0 };
			}
			// Restore + safety backup command echoes the safety backup path.
			if ( command.includes( 'printf' ) && command.includes( 'pre-restore' ) ) {
				return {
					stdout: '/var/www/html/.studio-backups/studio-pre-restore-1.tar.gz\n',
					exitCode: 0,
				};
			}
			return { stdout: '', exitCode: 0 };
		} );

		await expect(
			restoreSelfHostedSshBackup( event, LOCAL_SITE_ID, CONNECTION_ID, backupId )
		).rejects.toThrow( /pre-restore backup/i );
	} );

	it( 'rejects production restores', async () => {
		vi.mocked( hydrateSyncConnectionCredentials ).mockResolvedValue( {
			...stagingConnection,
			environmentType: 'production',
		} as never );

		await expect(
			restoreSelfHostedSshBackup( event, LOCAL_SITE_ID, CONNECTION_ID, backupId )
		).rejects.toThrow( /disabled for production/i );
	} );
} );
