import {
	listSyncDeployments,
	recordSyncDeployment,
} from 'src/modules/sync/lib/sync-deployment-history';
import { loadUserData, saveUserData } from 'src/storage/user-data';
import type { SyncDeploymentRecord } from '@studio/common/types/sync';
import type { UserData } from 'src/storage/storage-types';

vi.mock( 'src/storage/user-data', () => ( {
	loadUserData: vi.fn(),
	saveUserData: vi.fn(),
	lockAppdata: vi.fn( async () => undefined ),
	unlockAppdata: vi.fn( async () => undefined ),
} ) );

const LOCAL_SITE_ID = 'local-1';
const CONNECTION_ID = 'conn-1';

function record( overrides: Partial< SyncDeploymentRecord > = {} ): SyncDeploymentRecord {
	return {
		id: 'rec-1',
		localSiteId: LOCAL_SITE_ID,
		connectionId: CONNECTION_ID,
		provider: 'self-hosted-ssh',
		operation: 'push',
		environmentType: 'staging',
		startedAt: '2026-06-19T10:00:00.000Z',
		finishedAt: '2026-06-19T10:01:00.000Z',
		status: 'success',
		detail: 'Pushed to https://remote.test.',
		...overrides,
	};
}

let store: UserData;

beforeEach( () => {
	store = { version: 1, siteMetadata: {} };
	vi.mocked( loadUserData ).mockImplementation( async () => store );
	vi.mocked( saveUserData ).mockImplementation( async ( data ) => {
		store = data;
	} );
} );

afterEach( () => {
	vi.clearAllMocks();
} );

describe( 'sync deployment history', () => {
	it( 'records and lists a deployment, newest-first', async () => {
		await recordSyncDeployment( record( { id: 'a', startedAt: '2026-06-19T10:00:00.000Z' } ) );
		await recordSyncDeployment( record( { id: 'b', startedAt: '2026-06-19T11:00:00.000Z' } ) );

		const history = await listSyncDeployments( LOCAL_SITE_ID, CONNECTION_ID );
		expect( history.map( ( r ) => r.id ) ).toEqual( [ 'b', 'a' ] );
	} );

	it( 'scopes history per connection', async () => {
		await recordSyncDeployment( record( { id: 'a', connectionId: 'conn-1' } ) );
		await recordSyncDeployment( record( { id: 'b', connectionId: 'conn-2' } ) );

		expect( ( await listSyncDeployments( LOCAL_SITE_ID, 'conn-1' ) ).map( ( r ) => r.id ) ).toEqual(
			[ 'a' ]
		);
		expect( ( await listSyncDeployments( LOCAL_SITE_ID, 'conn-2' ) ).map( ( r ) => r.id ) ).toEqual(
			[ 'b' ]
		);
	} );

	it( 'caps history at 100 entries per connection', async () => {
		for ( let index = 0; index < 105; index++ ) {
			await recordSyncDeployment(
				record( {
					id: `rec-${ index }`,
					startedAt: new Date(
						Date.parse( '2026-06-19T00:00:00.000Z' ) + index * 1000
					).toISOString(),
				} )
			);
		}
		const history = await listSyncDeployments( LOCAL_SITE_ID, CONNECTION_ID );
		expect( history ).toHaveLength( 100 );
		// The newest 100 are kept; the oldest five (rec-0..rec-4) are dropped.
		expect( history.some( ( r ) => r.id === 'rec-0' ) ).toBe( false );
		expect( history[ 0 ].id ).toBe( 'rec-104' );
	} );

	it( 'records a failed deployment', async () => {
		await recordSyncDeployment( record( { status: 'failed', detail: 'Push failed.' } ) );
		const history = await listSyncDeployments( LOCAL_SITE_ID, CONNECTION_ID );
		expect( history[ 0 ].status ).toBe( 'failed' );
	} );

	it( 'skips malformed stored entries when listing', async () => {
		store.syncDeploymentHistory = {
			[ `${ LOCAL_SITE_ID }:${ CONNECTION_ID }` ]: [
				{ not: 'a record' },
				record( { id: 'good' } ),
			],
		};
		const history = await listSyncDeployments( LOCAL_SITE_ID, CONNECTION_ID );
		expect( history.map( ( r ) => r.id ) ).toEqual( [ 'good' ] );
	} );

	it( 'returns an empty list for an unknown connection', async () => {
		expect( await listSyncDeployments( LOCAL_SITE_ID, 'missing' ) ).toEqual( [] );
	} );
} );
