import { getSyncConnectionsForLocalSite } from '@studio/common/lib/sync-connections';
import { fetchSiteRest } from 'src/lib/wordpress-rest-api';
import {
	previewSelfHostedRestContentPush,
	pushSelfHostedRestContent,
} from 'src/modules/sync/lib/ipc-handlers';
import { hydrateSyncConnectionCredentials } from 'src/modules/sync/lib/sync-credential-vault';
import { SiteServer } from 'src/site-server';
import type { IpcMainInvokeEvent } from 'electron';

vi.mock( 'src/lib/wordpress-rest-api' );
vi.mock( '@studio/common/lib/sync-connections' );
vi.mock( 'src/modules/sync/lib/sync-credential-vault' );
vi.mock( 'src/modules/sync/lib/sync-deployment-history', () => ( {
	recordSyncDeployment: vi.fn( async () => undefined ),
	listSyncDeployments: vi.fn( async () => [] ),
} ) );
vi.mock( 'src/site-server' );

const LOCAL_SITE_ID = 'local-1';
const CONNECTION_ID = 'conn-1';

const connection = {
	id: CONNECTION_ID,
	localSiteId: LOCAL_SITE_ID,
	provider: 'self-hosted-rest',
	syncMode: 'rest-content',
	siteUrl: 'https://remote.test',
	environmentType: 'staging',
	lastPullTimestamp: null,
	lastPushTimestamp: null,
	capabilities: {
		canPull: false,
		canPush: true,
		canPushToProduction: false,
		canSyncContent: true,
		canSyncDatabase: false,
		canSyncFiles: false,
		requiresBackupBeforePush: false,
		requiresDryRunBeforeProductionPush: false,
	},
	auth: { username: 'admin', applicationPassword: 'pass word here' },
};

type LocalCollections = {
	posts?: unknown[];
	pages?: unknown[];
	categories?: unknown[];
	tags?: unknown[];
	media?: unknown[];
};

// In-memory store of meta written via `wp post meta update`, keyed by `${postId}:${metaKey}`.
let storedMeta: Map< string, string >;

function setupLocalSite( collections: LocalCollections ) {
	const data: Required< LocalCollections > = {
		posts: collections.posts ?? [],
		pages: collections.pages ?? [],
		categories: collections.categories ?? [],
		tags: collections.tags ?? [],
		media: collections.media ?? [],
	};

	vi.mocked( fetchSiteRest ).mockImplementation( async ( _event, _siteId, request ) => {
		const path = request.path ?? '';
		const resource = path.replace( /^\/wp\/v2\//, '' ).split( '?' )[ 0 ];
		const page = Number( new URLSearchParams( path.split( '?' )[ 1 ] ?? '' ).get( 'page' ) ?? '1' );
		const list = page === 1 ? data[ resource as keyof typeof data ] ?? [] : [];
		return { status: 200, body: JSON.stringify( list ) } as Awaited<
			ReturnType< typeof fetchSiteRest >
		>;
	} );

	vi.mocked( SiteServer.get ).mockReturnValue( {
		executeWpCliCommand: vi.fn( async ( args: string[] ) => {
			if ( args[ 0 ] === 'post' && args[ 1 ] === 'meta' && args[ 2 ] === 'get' ) {
				return {
					stdout: storedMeta.get( `${ args[ 3 ] }:${ args[ 4 ] }` ) ?? '',
					stderr: '',
					exitCode: 0,
				};
			}
			if ( args[ 0 ] === 'post' && args[ 1 ] === 'meta' && args[ 2 ] === 'update' ) {
				storedMeta.set( `${ args[ 3 ] }:${ args[ 4 ] }`, args[ 5 ] );
				return { stdout: '', stderr: '', exitCode: 0 };
			}
			return { stdout: '', stderr: '', exitCode: 0 };
		} ),
	} as unknown as ReturnType< typeof SiteServer.get > );
}

type RemoteRecord = { id: number; slug?: string; [ key: string ]: unknown };

// A minimal fake remote WordPress REST API backed by in-memory collections.
function setupRemote() {
	const remote: Record< string, RemoteRecord[] > = {
		posts: [],
		pages: [],
		categories: [],
		tags: [],
		media: [],
	};
	let nextId = 1000;
	const requests: Array< { method: string; path: string; body: unknown } > = [];

	const fetchMock = vi.fn( async ( url: string | URL, init?: RequestInit ) => {
		const parsed = new URL( String( url ) );

		// Reading a local media file before upload: return raw bytes.
		if ( ! parsed.pathname.startsWith( '/wp-json/' ) ) {
			return {
				ok: true,
				status: 200,
				arrayBuffer: async () => new ArrayBuffer( 8 ),
			} as Response;
		}

		const segments = parsed.pathname.replace( /^\/wp-json\/wp\/v2\//, '' ).split( '/' );
		const resource = segments[ 0 ];
		const idInPath = segments[ 1 ] ? Number( segments[ 1 ] ) : null;
		const method = init?.method ?? 'GET';
		const isJsonBody =
			typeof init?.body === 'string' &&
			( init.headers as Record< string, string > | undefined )?.[ 'Content-Type' ] ===
				'application/json';
		const body = isJsonBody ? JSON.parse( String( init?.body ) ) : undefined;
		requests.push( { method, path: parsed.pathname, body } );
		const collection = remote[ resource ] ?? ( remote[ resource ] = [] );

		const ok = ( payload: unknown ) =>
			( {
				ok: true,
				status: 200,
				text: async () => JSON.stringify( payload ),
			} ) as Response;

		if ( method === 'GET' ) {
			if ( idInPath ) {
				return ok( collection.find( ( r ) => r.id === idInPath ) ?? null );
			}
			const slug = parsed.searchParams.get( 'slug' );
			return ok( slug ? collection.filter( ( r ) => r.slug === slug ) : collection );
		}

		// POST = create or update.
		if ( idInPath ) {
			const existing = collection.find( ( r ) => r.id === idInPath );
			if ( existing ) {
				Object.assign( existing, body );
				return ok( existing );
			}
		}
		const created: RemoteRecord = { id: nextId++, ...body };
		collection.push( created );
		return ok( created );
	} );

	vi.stubGlobal( 'fetch', fetchMock );
	return { remote, requests };
}

beforeEach( () => {
	storedMeta = new Map();
	vi.mocked( getSyncConnectionsForLocalSite ).mockResolvedValue( [ connection as never ] );
	vi.mocked( hydrateSyncConnectionCredentials ).mockResolvedValue( connection as never );
} );

afterEach( () => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
} );

const event = {} as IpcMainInvokeEvent;

describe( 'previewSelfHostedRestContentPush', () => {
	it( 'reports create for unmapped local content', async () => {
		setupLocalSite( {
			posts: [ { id: 1, slug: 'hello', type: 'post', title: { raw: 'Hello' } } ],
		} );
		setupRemote();

		const preview = await previewSelfHostedRestContentPush( event, LOCAL_SITE_ID, CONNECTION_ID );

		expect( preview.summary ).toEqual( { create: 1, update: 0, conflict: 0 } );
		expect( preview.items[ 0 ].action ).toBe( 'create' );
	} );

	it( 'reports conflict when a remote slug exists but is unmapped', async () => {
		setupLocalSite( {
			posts: [ { id: 1, slug: 'hello', type: 'post', title: { raw: 'Hello' } } ],
		} );
		const { remote } = setupRemote();
		remote.posts.push( { id: 500, slug: 'hello' } );

		const preview = await previewSelfHostedRestContentPush( event, LOCAL_SITE_ID, CONNECTION_ID );

		expect( preview.summary.conflict ).toBe( 1 );
		expect( preview.items[ 0 ].action ).toBe( 'conflict' );
	} );
} );

describe( 'pushSelfHostedRestContent', () => {
	it( 'creates remote drafts and stores the remote id mapping', async () => {
		setupLocalSite( {
			posts: [ { id: 1, slug: 'hello', type: 'post', title: { raw: 'Hello' }, sticky: true } ],
		} );
		const { remote, requests } = setupRemote();

		const summary = await pushSelfHostedRestContent( event, LOCAL_SITE_ID, CONNECTION_ID );

		expect( summary.posts ).toBe( 1 );
		expect( remote.posts ).toHaveLength( 1 );
		const created = requests.find( ( r ) => r.method === 'POST' && r.path.endsWith( '/posts' ) );
		expect( ( created?.body as Record< string, unknown > ).status ).toBe( 'draft' );
		expect( ( created?.body as Record< string, unknown > ).sticky ).toBe( true );
		expect( storedMeta.get( `1:_studio_remote_post_id_${ CONNECTION_ID }` ) ).toBe(
			String( remote.posts[ 0 ].id )
		);
	} );

	it( 'is idempotent: a second push updates the same remote item instead of creating a new one', async () => {
		setupLocalSite( {
			posts: [ { id: 1, slug: 'hello', type: 'post', title: { raw: 'Hello' } } ],
		} );
		const { remote, requests } = setupRemote();

		await pushSelfHostedRestContent( event, LOCAL_SITE_ID, CONNECTION_ID );
		const remoteId = remote.posts[ 0 ].id;
		await pushSelfHostedRestContent( event, LOCAL_SITE_ID, CONNECTION_ID );

		expect( remote.posts ).toHaveLength( 1 );
		const updates = requests.filter(
			( r ) => r.method === 'POST' && r.path.endsWith( `/posts/${ remoteId }` )
		);
		expect( updates.length ).toBeGreaterThanOrEqual( 1 );
	} );

	it( 'pushes page parents before children and maps the remote parent id', async () => {
		setupLocalSite( {
			pages: [
				{ id: 20, slug: 'child', type: 'page', title: { raw: 'Child' }, parent: 10, menu_order: 2 },
				{ id: 10, slug: 'parent', type: 'page', title: { raw: 'Parent' }, parent: 0 },
			],
		} );
		const { remote } = setupRemote();

		await pushSelfHostedRestContent( event, LOCAL_SITE_ID, CONNECTION_ID );

		const parent = remote.pages.find( ( p ) => p.slug === 'parent' );
		const child = remote.pages.find( ( p ) => p.slug === 'child' );
		expect( child?.parent ).toBe( parent?.id );
		expect( child?.menu_order ).toBe( 2 );
	} );

	it( 'preserves the publish date and date_gmt only when publishing', async () => {
		setupLocalSite( {
			posts: [
				{
					id: 1,
					slug: 'dated',
					type: 'post',
					title: { raw: 'Dated' },
					date: '2024-01-02T03:04:05',
					date_gmt: '2024-01-02T03:04:05',
				},
			],
		} );
		const { requests } = setupRemote();

		await pushSelfHostedRestContent( event, LOCAL_SITE_ID, CONNECTION_ID, { publish: true } );

		const created = requests.find( ( r ) => r.method === 'POST' && r.path.endsWith( '/posts' ) );
		const body = created?.body as Record< string, unknown >;
		expect( body.status ).toBe( 'publish' );
		expect( body.date ).toBe( '2024-01-02T03:04:05' );
		expect( body.date_gmt ).toBe( '2024-01-02T03:04:05' );
	} );

	it( 'uploads media referenced only by attachment id and rewrites the id in content', async () => {
		setupLocalSite( {
			posts: [
				{
					id: 1,
					slug: 'gallery',
					type: 'post',
					title: { raw: 'Gallery' },
					content: { raw: '<!-- wp:image {"id":42} --><figure class="wp-image-42"></figure>' },
				},
			],
			media: [
				{
					id: 42,
					source_url: 'https://remote.test/wp-content/uploads/never.jpg',
					mime_type: 'image/jpeg',
					alt_text: 'Alt',
				},
			],
		} );
		const { remote, requests } = setupRemote();

		await pushSelfHostedRestContent( event, LOCAL_SITE_ID, CONNECTION_ID );

		expect( remote.media ).toHaveLength( 1 );
		const remoteMediaId = remote.media[ 0 ].id;
		const created = requests.find( ( r ) => r.method === 'POST' && r.path.endsWith( '/posts' ) );
		const content = ( created?.body as Record< string, string > ).content;
		expect( content ).toContain( `"id":${ remoteMediaId }` );
		expect( content ).toContain( `wp-image-${ remoteMediaId }` );
	} );

	describe( 'scheduled publishing', () => {
		it( 'creates content with status=future and a future date_gmt when scheduled', async () => {
			setupLocalSite( {
				posts: [ { id: 1, slug: 'hello', type: 'post', title: { raw: 'Hello' } } ],
			} );
			const { requests } = setupRemote();
			const future = new Date( Date.now() + 7 * 24 * 60 * 60 * 1000 ).toISOString();

			await pushSelfHostedRestContent( event, LOCAL_SITE_ID, CONNECTION_ID, {
				scheduledDate: future,
			} );

			const created = requests.find( ( r ) => r.method === 'POST' && r.path.endsWith( '/posts' ) );
			const body = created?.body as Record< string, unknown >;
			expect( body.status ).toBe( 'future' );
			expect( typeof body.date_gmt ).toBe( 'string' );
			expect( new Date( `${ body.date_gmt as string }Z` ).getTime() ).toBeGreaterThan( Date.now() );
		} );

		it( 'rejects a scheduled date in the past', async () => {
			setupLocalSite( {
				posts: [ { id: 1, slug: 'hello', type: 'post', title: { raw: 'Hello' } } ],
			} );
			setupRemote();

			await expect(
				pushSelfHostedRestContent( event, LOCAL_SITE_ID, CONNECTION_ID, {
					scheduledDate: '2000-01-01T00:00:00.000Z',
				} )
			).rejects.toThrow( /must be in the future/i );
		} );

		it( 'rejects an invalid scheduled date', async () => {
			setupLocalSite( {
				posts: [ { id: 1, slug: 'hello', type: 'post', title: { raw: 'Hello' } } ],
			} );
			setupRemote();

			await expect(
				pushSelfHostedRestContent( event, LOCAL_SITE_ID, CONNECTION_ID, {
					scheduledDate: 'not-a-date',
				} )
			).rejects.toThrow( /invalid scheduled/i );
		} );
	} );

	describe( 'production editorial approval gate', () => {
		const productionConnection = { ...connection, environmentType: 'production' };

		beforeEach( () => {
			vi.mocked( getSyncConnectionsForLocalSite ).mockResolvedValue( [
				productionConnection as never,
			] );
			vi.mocked( hydrateSyncConnectionCredentials ).mockResolvedValue(
				productionConnection as never
			);
		} );

		it( 'blocks a production publish without approval', async () => {
			setupLocalSite( {
				posts: [ { id: 1, slug: 'hello', type: 'post', title: { raw: 'Hello' } } ],
			} );
			setupRemote();

			await expect(
				pushSelfHostedRestContent( event, LOCAL_SITE_ID, CONNECTION_ID, { publish: true } )
			).rejects.toThrow( /editorial approval/i );
		} );

		it( 'blocks a production publish with the wrong approval token', async () => {
			setupLocalSite( {
				posts: [ { id: 1, slug: 'hello', type: 'post', title: { raw: 'Hello' } } ],
			} );
			setupRemote();

			await expect(
				pushSelfHostedRestContent( event, LOCAL_SITE_ID, CONNECTION_ID, {
					publish: true,
					approval: 'yes',
				} )
			).rejects.toThrow( /editorial approval/i );
		} );

		it( 'allows a production publish with the PUBLISH approval token', async () => {
			setupLocalSite( {
				posts: [ { id: 1, slug: 'hello', type: 'post', title: { raw: 'Hello' } } ],
			} );
			const { requests } = setupRemote();

			await pushSelfHostedRestContent( event, LOCAL_SITE_ID, CONNECTION_ID, {
				publish: true,
				approval: 'PUBLISH',
			} );

			const created = requests.find( ( r ) => r.method === 'POST' && r.path.endsWith( '/posts' ) );
			expect( ( created?.body as Record< string, unknown > ).status ).toBe( 'publish' );
		} );

		it( 'blocks scheduling to production without approval', async () => {
			setupLocalSite( {
				posts: [ { id: 1, slug: 'hello', type: 'post', title: { raw: 'Hello' } } ],
			} );
			setupRemote();

			await expect(
				pushSelfHostedRestContent( event, LOCAL_SITE_ID, CONNECTION_ID, {
					scheduledDate: new Date( Date.now() + 86_400_000 ).toISOString(),
				} )
			).rejects.toThrow( /editorial approval/i );
		} );

		it( 'allows a production draft push without approval', async () => {
			setupLocalSite( {
				posts: [ { id: 1, slug: 'hello', type: 'post', title: { raw: 'Hello' } } ],
			} );
			const { requests } = setupRemote();

			await pushSelfHostedRestContent( event, LOCAL_SITE_ID, CONNECTION_ID );

			const created = requests.find( ( r ) => r.method === 'POST' && r.path.endsWith( '/posts' ) );
			expect( ( created?.body as Record< string, unknown > ).status ).toBe( 'draft' );
		} );
	} );
} );
