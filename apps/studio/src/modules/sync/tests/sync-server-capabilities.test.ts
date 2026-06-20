import {
	deleteServerCapabilities,
	loadServerCapabilities,
	saveServerCapabilities,
} from 'src/modules/sync/lib/sync-server-capabilities';
import { loadUserData, saveUserData } from 'src/storage/user-data';
import type { SelfHostedServerStack } from '@studio/common/types/sync';
import type { UserData } from 'src/storage/storage-types';

vi.mock( 'src/storage/user-data', () => ( {
	loadUserData: vi.fn(),
	saveUserData: vi.fn(),
	lockAppdata: vi.fn( async () => undefined ),
	unlockAppdata: vi.fn( async () => undefined ),
} ) );

const LOCAL_SITE_ID = 'local-1';
const CONNECTION_ID = 'conn-1';

const stack: SelfHostedServerStack = {
	os: 'Ubuntu 22.04',
	webServer: 'nginx',
	webServerVersion: '1.22.1',
	phpVersion: '8.2',
	phpFpm: true,
	dbEngine: 'MySQL',
	dbVersion: '8.0.35',
	docroot: '/var/www/html',
	configPaths: { vhost: null, htaccess: null },
	canSudo: true,
};

let store: UserData;

beforeEach( () => {
	store = { version: 1, siteMetadata: {} };
	vi.mocked( loadUserData ).mockImplementation( async () => store );
	vi.mocked( saveUserData ).mockImplementation( async ( data ) => {
		store = data;
	} );
} );

afterEach( () => vi.clearAllMocks() );

describe( 'sync server capabilities cache', () => {
	it( 'saves and loads the detected stack', async () => {
		await saveServerCapabilities( LOCAL_SITE_ID, CONNECTION_ID, stack, '2026-06-19T00:00:00.000Z' );
		const loaded = await loadServerCapabilities( LOCAL_SITE_ID, CONNECTION_ID );
		expect( loaded?.stack.webServer ).toBe( 'nginx' );
		expect( loaded?.detectedAt ).toBe( '2026-06-19T00:00:00.000Z' );
	} );

	it( 'returns null when nothing is cached', async () => {
		expect( await loadServerCapabilities( LOCAL_SITE_ID, 'missing' ) ).toBeNull();
	} );

	it( 'returns null for a malformed cached entry', async () => {
		store.syncServerCapabilities = {
			[ `${ LOCAL_SITE_ID }:${ CONNECTION_ID }` ]: { stack: { nonsense: true }, detectedAt: 'x' },
		};
		expect( await loadServerCapabilities( LOCAL_SITE_ID, CONNECTION_ID ) ).toBeNull();
	} );

	it( 'scopes the cache per connection and deletes it', async () => {
		await saveServerCapabilities( LOCAL_SITE_ID, 'conn-1', stack, 't' );
		await saveServerCapabilities( LOCAL_SITE_ID, 'conn-2', stack, 't' );
		await deleteServerCapabilities( LOCAL_SITE_ID, 'conn-1' );
		expect( await loadServerCapabilities( LOCAL_SITE_ID, 'conn-1' ) ).toBeNull();
		expect( await loadServerCapabilities( LOCAL_SITE_ID, 'conn-2' ) ).not.toBeNull();
	} );
} );
