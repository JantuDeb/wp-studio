import { app, IpcMainInvokeEvent } from 'electron';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
	addConnectedWpcomSite,
	getAllConnectedWpcomSitesForCurrentUser,
	getConnectedWpcomSitesForLocalSite,
	removeConnectedWpcomSite,
	updateConnectedWpcomSites as updateConnectedWpcomSitesShared,
} from '@studio/common/lib/connected-sites';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { getCurrentUserId } from '@studio/common/lib/shared-config';
import { fetchSyncableSites } from '@studio/common/lib/sync/sync-api';
import {
	addOrUpdateSyncConnection,
	getSyncConnectionsForLocalSite,
	removeSyncConnection,
} from '@studio/common/lib/sync-connections';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';
import {
	selfHostedRestConnectionSchema,
	SyncConnection,
	SyncSite,
} from '@studio/common/types/sync';
import { Upload } from 'tus-js-client';
import { z } from 'zod';
import {
	PullStateProgressInfo,
	PushStateProgressInfo,
} from 'src/hooks/use-sync-states-progress-info';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { ACTIVE_SYNC_OPERATIONS } from 'src/lib/active-sync-operations';
import { download } from 'src/lib/download';
import { getSyncBackupTempPath } from 'src/lib/get-sync-backup-temp-path';
import { getAuthenticationToken } from 'src/lib/oauth';
import { fetchSiteRest } from 'src/lib/wordpress-rest-api';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';
import { exportSite } from 'src/modules/import-export/lib/ipc-handlers';
import { SiteServer } from 'src/site-server';
import { SyncOption } from 'src/types';

type LocalRenderedField = {
	raw?: string;
	rendered?: string;
};

type LocalTerm = {
	id: number;
	name: string;
	slug: string;
};

type LocalMedia = {
	id: number;
	source_url: string;
	mime_type?: string;
	title?: LocalRenderedField;
	alt_text?: string;
	caption?: LocalRenderedField;
	description?: LocalRenderedField;
};

type LocalContentItem = {
	id: number;
	slug: string;
	type: 'post' | 'page';
	status?: string;
	title?: LocalRenderedField;
	content?: LocalRenderedField;
	excerpt?: LocalRenderedField;
	featured_media?: number;
	categories?: number[];
	tags?: number[];
};

type RemoteEntity = {
	id: number;
	slug?: string;
	source_url?: string;
};

type LocalContentSelectionItem = {
	id: number;
	type: 'post' | 'page';
	title: string;
	slug: string;
	status: string;
	categories: number;
	tags: number;
	hasFeaturedImage: boolean;
};

type ContentPushPreviewItem = {
	id: number;
	type: 'post' | 'page';
	title: string;
	slug: string;
	action: 'create' | 'update' | 'conflict';
	remoteId: number | null;
	reason?: string;
};

type ContentPushPreview = {
	items: ContentPushPreviewItem[];
	summary: {
		create: number;
		update: number;
		conflict: number;
	};
};

/**
 * Registry to store AbortControllers for ongoing sync operations (push/pull).
 * Key format: `${selectedSiteId}-${remoteSiteId}`
 */
const SYNC_ABORT_CONTROLLERS = new Map< string, AbortController >();

/**
 * Registry to store TUS upload instances and their pause state for ongoing uploads.
 * Key format: `${selectedSiteId}-${remoteSiteId}`
 * This allows pause/resume functionality for uploads.
 */
type UploadState = {
	upload: Upload;
	isManuallyPaused: boolean;
	abortController: AbortController;
};

const SYNC_TUS_UPLOADS = new Map< string, UploadState >();

/**
 * Pause an ongoing sync upload.
 */
export function pauseSyncUpload(
	event: IpcMainInvokeEvent,
	selectedSiteId: string,
	remoteSiteId: number
) {
	const uploadKey = `${ selectedSiteId }-${ remoteSiteId }`;
	const uploadState = SYNC_TUS_UPLOADS.get( uploadKey );

	if ( uploadState ) {
		if ( uploadState.isManuallyPaused ) {
			return true;
		}

		uploadState.isManuallyPaused = true;
		void uploadState.upload.abort();
		void sendIpcEventToRenderer( 'sync-upload-manually-paused', {
			selectedSiteId,
			remoteSiteId,
		} );
		return true;
	}

	return false;
}

/**
 * Resume a paused sync upload.
 */
export function resumeSyncUpload(
	event: IpcMainInvokeEvent,
	selectedSiteId: string,
	remoteSiteId: number
) {
	const uploadKey = `${ selectedSiteId }-${ remoteSiteId }`;
	const uploadState = SYNC_TUS_UPLOADS.get( uploadKey );

	if ( uploadState ) {
		if ( ! uploadState.isManuallyPaused ) {
			return true;
		}

		uploadState.isManuallyPaused = false;
		uploadState.upload.start();
		void sendIpcEventToRenderer( 'sync-upload-resumed', {
			selectedSiteId,
			remoteSiteId,
		} );
		return true;
	}

	return false;
}

/**
 * Clear the ID of a push/pull operation.
 */
export function clearSyncOperation( event: IpcMainInvokeEvent, id: string ) {
	ACTIVE_SYNC_OPERATIONS.delete( id );
	SYNC_ABORT_CONTROLLERS.delete( id );
}

export function cancelSyncOperation( event: IpcMainInvokeEvent, id: string ) {
	const abortController = SYNC_ABORT_CONTROLLERS.get( id );
	if ( abortController ) {
		abortController.abort();
		SYNC_ABORT_CONTROLLERS.delete( id );
	}

	const uploadState = SYNC_TUS_UPLOADS.get( id );
	if ( uploadState ) {
		uploadState.abortController.abort();
		SYNC_TUS_UPLOADS.delete( id );
	}

	ACTIVE_SYNC_OPERATIONS.delete( id );
}

/**
 * Store the ID of a push/pull operation in a deduped set.
 */
export function addSyncOperation(
	event: IpcMainInvokeEvent,
	id: string,
	state?: PullStateProgressInfo | PushStateProgressInfo
) {
	ACTIVE_SYNC_OPERATIONS.set( id, state );
}

export async function exportSiteForPush(
	event: IpcMainInvokeEvent,
	id: string,
	operationId: string,
	configuration?: {
		optionsToSync?: SyncOption[];
		specificSelectionPaths?: string[];
	}
) {
	const site = SiteServer.get( id );
	if ( ! site ) {
		throw new Error( 'Site not found.' );
	}

	const tempDir = path.join( app.getPath( 'temp' ), 'com.wordpress.studio', randomUUID() );
	fs.mkdirSync( tempDir, { recursive: true } );
	const archivePath = path.join( tempDir, `site_${ id }.tar.gz` );

	const abortController = new AbortController();
	SYNC_ABORT_CONTROLLERS.set( operationId, abortController );

	try {
		if ( abortController.signal.aborted ) {
			throw new Error( 'Export aborted' );
		}

		const shouldIncludeSyncOption = (
			optionsToSync: SyncOption[] | undefined,
			option: SyncOption
		): boolean => {
			return (
				optionsToSync?.includes( option ) || optionsToSync?.includes( 'all' ) || ! optionsToSync
			);
		};

		const includes = {
			database: shouldIncludeSyncOption( configuration?.optionsToSync, 'sqls' ),
			wpContent: ( [ 'uploads', 'plugins', 'themes', 'contents' ] as const ).some( ( option ) =>
				shouldIncludeSyncOption( configuration?.optionsToSync, option )
			),
		};

		let mode: 'full' | 'content' | 'db';
		if ( includes.database && includes.wpContent ) {
			mode = 'full';
		} else if ( includes.wpContent ) {
			mode = 'content';
		} else {
			mode = 'db';
		}

		await exportSite( event, site.details.id, archivePath, {
			mode,
			splitDatabaseDumpByTable: true,
			specificSelectionPaths: configuration?.specificSelectionPaths,
			applyDeployIgnore: true,
			abortSignal: abortController.signal,
		} );

		if ( abortController.signal.aborted ) {
			await fsPromises.unlink( archivePath ).catch( () => {
				// Ignore cleanup errors
			} );
			throw new Error( 'Export aborted' );
		}

		const stats = fs.statSync( archivePath );
		return { archivePath, archiveSizeInBytes: stats.size };
	} finally {
		SYNC_ABORT_CONTROLLERS.delete( operationId );
	}
}

export async function pushArchive(
	event: IpcMainInvokeEvent,
	selectedSiteId: string,
	remoteSiteId: number,
	archivePath: string,
	optionsToSync?: string[],
	specificSelectionPaths?: string[]
): Promise< { success: boolean; error?: string } > {
	const token = await getAuthenticationToken();

	if ( ! token?.accessToken ) {
		throw new Error( 'No token found' );
	}

	let hasUploadStarted = false;
	let isUploadingPaused = false;
	const file = fs.createReadStream( archivePath );
	const fileSize = fs.statSync( archivePath ).size;
	const filename = path.basename( archivePath );

	const abortController = new AbortController();
	const uploadKey = `${ selectedSiteId }-${ remoteSiteId }`;

	const attachmentPromise = new Promise< string >( ( resolve, reject ) => {
		const upload = new Upload( file, {
			endpoint: `https://public-api.wordpress.com/rest/v1.1/studio-file-uploads/${ remoteSiteId }`,
			chunkSize: 500000,
			retryDelays: [ 0, 1000, 3000, 5000, 10000, 25000 ],
			overridePatchMethod: true,
			removeFingerprintOnSuccess: true,
			storeFingerprintForResuming: true,
			headers: {
				Authorization: `Bearer ${ token.accessToken }`,
			},
			metadata: {
				filename,
				filetype: 'application/gzip',
			},
			uploadSize: fileSize,
			onBeforeRequest: ( req ) => {
				if ( req.getMethod() === 'HEAD' ) {
					// @ts-expect-error We need to override the method to get the response headers.
					req._method = 'GET';
					req.setHeader( 'X-HTTP-Method-Override', 'HEAD' );
				}
			},
			onError: ( error ) => {
				console.error( '[TUS] Upload error', error );
				reject( error );
			},
			onProgress: ( bytesSent: number, bytesTotal: number ) => {
				if ( isUploadingPaused ) {
					isUploadingPaused = false;
					void sendIpcEventToRenderer( 'sync-upload-resumed', {
						selectedSiteId: selectedSiteId,
						remoteSiteId: remoteSiteId,
					} );
					console.log( '[TUS] Upload resumed' );
				}

				if ( ! hasUploadStarted ) {
					hasUploadStarted = true;
				}

				// Calculate upload progress percentage (0-100)
				const uploadProgress = bytesTotal > 0 ? ( bytesSent / bytesTotal ) * 100 : 0;
				void sendIpcEventToRenderer( 'sync-upload-progress', {
					selectedSiteId: selectedSiteId,
					remoteSiteId: remoteSiteId,
					progress: uploadProgress,
				} );
			},
			onSuccess: ( payload ) => {
				if ( ! payload.lastResponse ) {
					reject( new Error( 'Upload completed but no response received' ) );
					return;
				}

				const attachmentId = payload.lastResponse.getHeader( 'x-studio-file-upload-media-id' );
				if ( attachmentId ) {
					resolve( attachmentId );
				} else {
					reject( new Error( 'Upload completed but required header not found' ) );
				}
			},
			onShouldRetry: ( error ) => {
				// Don't retry or send events if this is a manual pause
				const uploadState = SYNC_TUS_UPLOADS.get( uploadKey );
				if ( uploadState?.isManuallyPaused ) {
					return false;
				}

				// Update the UI only if the upload has started and is paused for network reasons.
				if ( hasUploadStarted ) {
					isUploadingPaused = true;
					void sendIpcEventToRenderer( 'sync-upload-network-paused', {
						selectedSiteId: selectedSiteId,
						remoteSiteId: remoteSiteId,
						error: error.message,
					} );
					console.error( '[TUS] Upload paused due to network error: ', error.message );
				}

				const status = error.originalResponse ? error.originalResponse.getStatus() : 0;
				// Stop retrying if the upload failed because of a 403 error.
				if ( status === 403 ) {
					return false;
				}

				return true;
			},
		} );

		abortController.signal.addEventListener( 'abort', () => {
			void upload.abort();
			reject( new Error( 'Export aborted' ) );
		} );

		const existingUploadState = SYNC_TUS_UPLOADS.get( uploadKey );
		if ( existingUploadState ) {
			// Abort the existing upload if it exists before starting the new one.
			void existingUploadState.upload.abort();
			SYNC_TUS_UPLOADS.delete( uploadKey );
		}

		SYNC_TUS_UPLOADS.set( uploadKey, {
			upload,
			isManuallyPaused: false,
			abortController,
		} );

		upload.start();
	} ).finally( () => {
		SYNC_TUS_UPLOADS.delete( uploadKey );
		file.destroy();
		file.close();
		fs.unlinkSync( archivePath );
	} );

	const wpcom = wpcomFactory( token.accessToken, wpcomXhrRequest );
	const formData: [ string, unknown, Record< string, string >? ][] = [];

	if ( specificSelectionPaths && specificSelectionPaths.length > 0 ) {
		const joinedPaths = specificSelectionPaths.join( ',' );
		formData.push( [ 'list_sync_items', joinedPaths ] );
	}

	if ( optionsToSync ) {
		formData.push( [ 'options', optionsToSync.join( ',' ) ] );
	}

	try {
		const attachmentId = await attachmentPromise;
		formData.push( [ 'import_attachment_id', attachmentId ] );

		await wpcom.req.post( {
			path: `/sites/${ remoteSiteId }/studio-app/sync/import/initiate`,
			apiNamespace: 'wpcom/v2',
			formData,
		} );

		return { success: true };
	} catch ( error ) {
		if ( abortController.signal.aborted ) {
			throw error;
		}

		const parseResult = z.object( { error: z.string() } ).safeParse( error );

		if ( parseResult.success ) {
			return { success: false, error: parseResult.data.error };
		}

		return { success: false, error: 'Unknown error' };
	}
}

export async function downloadSyncBackup(
	event: Electron.IpcMainInvokeEvent,
	remoteSiteId: number,
	downloadUrl: string,
	operationId: string
) {
	const tmpDir = path.join( app.getPath( 'temp' ), 'wp-studio-backups' );
	await fsPromises.mkdir( tmpDir, { recursive: true } );

	const filePath = getSyncBackupTempPath( remoteSiteId );

	const abortController = new AbortController();
	SYNC_ABORT_CONTROLLERS.set( operationId, abortController );

	try {
		await download( downloadUrl, filePath, false, '', abortController.signal );
		return filePath;
	} catch ( error ) {
		// A cancelled operation (user cancel or logout cleanup) aborts this signal. That's an
		// intentional stop, not a failure — return without logging or throwing so it doesn't
		// surface as an error, and let the caller treat the missing path as "stopped".
		if ( abortController.signal.aborted ) {
			return undefined;
		}
		console.error( `[Download] Download failed for operation: ${ operationId }`, error );
		throw error;
	} finally {
		SYNC_ABORT_CONTROLLERS.delete( operationId );
	}
}

export async function removeSyncBackup( event: IpcMainInvokeEvent, remoteSiteId: number ) {
	const filePath = getSyncBackupTempPath( remoteSiteId );
	try {
		await fsPromises.unlink( filePath );
	} catch ( error ) {
		// The backup file may never have been created — e.g. cancelling a pull that was still
		// initializing the remote backup, before anything was downloaded. A missing file is
		// not an error here, so only rethrow unexpected failures.
		if ( ! isErrnoException( error ) || error.code !== 'ENOENT' ) {
			throw error;
		}
	}
}

type WpcomSitesToConnect = { sites: SyncSite[]; localSiteId: string }[];

export async function connectWpcomSites( event: IpcMainInvokeEvent, list: WpcomSitesToConnect ) {
	const currentUserId = await getCurrentUserId();
	if ( ! currentUserId ) {
		throw new Error( 'User not authenticated' );
	}

	for ( const { sites, localSiteId } of list ) {
		for ( const siteToAdd of sites ) {
			await addConnectedWpcomSite( localSiteId, siteToAdd );
		}
	}
}

type WpcomSitesToDisconnect = { siteIds: number[]; localSiteId: string }[];

export async function disconnectWpcomSites(
	event: IpcMainInvokeEvent,
	list: WpcomSitesToDisconnect
) {
	const currentUserId = await getCurrentUserId();
	if ( ! currentUserId ) {
		throw new Error( 'User not authenticated' );
	}

	for ( const { siteIds, localSiteId } of list ) {
		for ( const id of siteIds ) {
			await removeConnectedWpcomSite( localSiteId, id );
		}
	}
}

export async function updateConnectedWpcomSites(
	event: IpcMainInvokeEvent,
	updatedSites: SyncSite[]
) {
	const currentUserId = await getCurrentUserId();
	if ( ! currentUserId ) {
		throw new Error( 'User not authenticated' );
	}

	// Group the updates by their local site since our storage is now per-site.
	const byLocalSite = new Map< string, SyncSite[] >();
	for ( const site of updatedSites ) {
		const list = byLocalSite.get( site.localSiteId ) ?? [];
		list.push( site );
		byLocalSite.set( site.localSiteId, list );
	}

	for ( const [ localSiteId, sites ] of byLocalSite ) {
		await updateConnectedWpcomSitesShared( localSiteId, sites );
	}
}

// Wraps the CLI `pull` command for apps/ui. The desktop renderer handles
// pull via `pullSiteThunk` + `pollPullBackupThunk` using its own WPCOM
// client to initiate + poll + download — that polling lives in the
// renderer sync slice with no end-to-end IPC equivalent to reuse. Calling
// the CLI instead keeps apps/ui free of wpcom-client setup and mirrors the
// simpler flow used by `push`. Exchanges everything (`--options all`).
export async function pullSiteFromLive(
	_event: IpcMainInvokeEvent,
	siteFolder: string,
	remoteSiteId: number
): Promise< void > {
	return new Promise< void >( ( resolve, reject ) => {
		const [ emitter ] = executeCliCommand(
			[ 'pull', '--path', siteFolder, '--remote-site', String( remoteSiteId ), '--options', 'all' ],
			{ output: 'capture' }
		);

		emitter.on( 'success', () => resolve() );
		emitter.on( 'failure', ( { error } ) => reject( error ) );
		emitter.on( 'error', ( { error } ) => reject( error ) );
	} );
}

// Fetches every WordPress.com site the authenticated user can sync to.
// The desktop renderer builds this list itself via its own WPCOM client
// (see wpcomSitesApi.getWpComSites); apps/ui doesn't own a wpcom client
// yet, so we expose a thin IPC wrapper that reuses the stored auth token.
export async function fetchSyncableWpcomSites( _event: IpcMainInvokeEvent ): Promise< SyncSite[] > {
	const token = await getAuthenticationToken();
	if ( ! token?.accessToken ) {
		throw new Error( 'Authentication required to fetch WordPress.com sites.' );
	}
	return fetchSyncableSites( token.accessToken );
}

export async function getConnectedWpcomSites(
	event: IpcMainInvokeEvent,
	localSiteId?: string
): Promise< SyncSite[] > {
	if ( localSiteId ) {
		return getConnectedWpcomSitesForLocalSite( localSiteId );
	}
	return getAllConnectedWpcomSitesForCurrentUser();
}

export async function getSyncConnections(
	event: IpcMainInvokeEvent,
	localSiteId: string
): Promise< SyncConnection[] > {
	return getSyncConnectionsForLocalSite( localSiteId );
}

export async function saveSyncConnection(
	event: IpcMainInvokeEvent,
	localSiteId: string,
	connection: SyncConnection
): Promise< SyncConnection[] > {
	return addOrUpdateSyncConnection( localSiteId, connection );
}

export async function deleteSyncConnection(
	event: IpcMainInvokeEvent,
	localSiteId: string,
	connectionId: string
): Promise< SyncConnection[] > {
	return removeSyncConnection( localSiteId, connectionId );
}

export async function testSyncConnection(
	event: IpcMainInvokeEvent,
	connection: SyncConnection
): Promise< { ok: boolean; message?: string } > {
	const parsed = selfHostedRestConnectionSchema.safeParse( connection );
	if ( ! parsed.success ) {
		return { ok: false, message: 'Only REST API self-hosted connections can be tested yet.' };
	}

	const siteUrl = new URL( parsed.data.siteUrl );
	const restUrl = new URL( '/wp-json/', siteUrl );

	try {
		const response = await fetch( restUrl, {
			headers: {
				Accept: 'application/json',
			},
			signal: AbortSignal.timeout( 10000 ),
		} );

		if ( ! response.ok ) {
			return {
				ok: false,
				message: `WordPress REST API returned HTTP ${ response.status }.`,
			};
		}

		const body = ( await response.json() ) as unknown;
		const result = z
			.object( {
				name: z.string().optional(),
				namespaces: z.array( z.string() ).optional(),
				routes: z.record( z.string(), z.unknown() ).optional(),
			} )
			.safeParse( body );

		if (
			! result.success ||
			! result.data.namespaces?.includes( 'wp/v2' ) ||
			! result.data.routes?.[ '/wp/v2/posts' ]
		) {
			return { ok: false, message: 'The site did not return a WordPress REST API index.' };
		}

		return { ok: true, message: 'WordPress REST API is available.' };
	} catch ( error ) {
		return {
			ok: false,
			message:
				error instanceof Error ? error.message : 'Unable to connect to the WordPress REST API.',
		};
	}
}

function getRestAuthHeader( username: string, applicationPassword: string ): string {
	return `Basic ${ Buffer.from( `${ username }:${ applicationPassword }` ).toString( 'base64' ) }`;
}

function getRemoteRestUrl( siteUrl: string, pathName: string ): URL {
	const baseUrl = new URL( siteUrl );
	const path = pathName.replace( /^\/+/, '' );
	return new URL( `/wp-json/${ path }`, baseUrl );
}

async function remoteRestRequest< T >(
	connection: z.infer< typeof selfHostedRestConnectionSchema >,
	pathName: string,
	options: {
		method?: string;
		body?: unknown;
		headers?: Record< string, string >;
		rawBody?: BodyInit;
	} = {}
): Promise< T > {
	const headers: Record< string, string > = {
		Accept: 'application/json',
		Authorization: getRestAuthHeader(
			connection.auth.username,
			connection.auth.applicationPassword
		),
		...options.headers,
	};

	let body = options.rawBody;
	if ( options.body !== undefined ) {
		headers[ 'Content-Type' ] = 'application/json';
		body = JSON.stringify( options.body );
	}

	const response = await fetch( getRemoteRestUrl( connection.siteUrl, pathName ), {
		method: options.method ?? 'GET',
		headers,
		body,
	} );

	const text = await response.text();
	const parsed = text ? JSON.parse( text ) : null;

	if ( ! response.ok ) {
		const message =
			typeof parsed?.message === 'string'
				? parsed.message
				: `Remote REST request failed with HTTP ${ response.status }.`;
		throw new Error( message );
	}

	return parsed as T;
}

async function localRestRequest< T >( localSiteId: string, pathName: string ): Promise< T > {
	const response = await fetchSiteRest( {} as IpcMainInvokeEvent, localSiteId, {
		path: pathName,
	} );

	if ( response.status < 200 || response.status >= 300 ) {
		throw new Error( response.body || `Local REST request failed with HTTP ${ response.status }.` );
	}

	return JSON.parse( response.body ) as T;
}

function getRawField( field: LocalRenderedField | undefined ): string {
	return field?.raw ?? field?.rendered ?? '';
}

async function fetchAllLocal< T >( localSiteId: string, resource: string ): Promise< T[] > {
	const items: T[] = [];
	for ( let page = 1; ; page++ ) {
		const separator = resource.includes( '?' ) ? '&' : '?';
		const pageItems = await localRestRequest< T[] >(
			localSiteId,
			`/wp/v2/${ resource }${ separator }context=edit&per_page=100&page=${ page }`
		);
		items.push( ...pageItems );
		if ( pageItems.length < 100 ) {
			return items;
		}
	}
}

async function fetchAllLocalContent( localSiteId: string ): Promise< LocalContentItem[] > {
	const [ posts, pages ] = await Promise.all( [
		fetchAllLocal< LocalContentItem >( localSiteId, 'posts?status=any' ),
		fetchAllLocal< LocalContentItem >( localSiteId, 'pages?status=any' ),
	] );
	return [
		...posts.map( ( post ) => ( { ...post, type: 'post' as const } ) ),
		...pages.map( ( page ) => ( { ...page, type: 'page' as const } ) ),
	];
}

function filterSelectedContentItems(
	contentItems: LocalContentItem[],
	selectedItems?: Array< { id: number; type: 'post' | 'page' } >
): LocalContentItem[] {
	const selectedKeys = new Set(
		selectedItems?.map( ( item ) => `${ item.type }:${ item.id }` ) ?? []
	);
	return selectedKeys.size > 0
		? contentItems.filter( ( item ) => selectedKeys.has( `${ item.type }:${ item.id }` ) )
		: contentItems;
}

export async function listSelfHostedRestContent(
	_event: IpcMainInvokeEvent,
	localSiteId: string
): Promise< LocalContentSelectionItem[] > {
	const contentItems = await fetchAllLocalContent( localSiteId );
	return contentItems.map( ( item ) => ( {
		id: item.id,
		type: item.type,
		title: getRawField( item.title ) || item.slug || `#${ item.id }`,
		slug: item.slug,
		status: item.status ?? 'unknown',
		categories: item.categories?.length ?? 0,
		tags: item.tags?.length ?? 0,
		hasFeaturedImage: Boolean( item.featured_media ),
	} ) );
}

function mapTermsById( terms: LocalTerm[] ): Map< number, LocalTerm > {
	return new Map( terms.map( ( term ) => [ term.id, term ] ) );
}

async function ensureRemoteTerm(
	connection: z.infer< typeof selfHostedRestConnectionSchema >,
	taxonomy: 'categories' | 'tags',
	term: LocalTerm
): Promise< number > {
	const existing = await remoteRestRequest< RemoteEntity[] >(
		connection,
		`/wp/v2/${ taxonomy }?slug=${ encodeURIComponent( term.slug ) }`
	);

	if ( existing[ 0 ]?.id ) {
		return existing[ 0 ].id;
	}

	const created = await remoteRestRequest< RemoteEntity >( connection, `/wp/v2/${ taxonomy }`, {
		method: 'POST',
		body: {
			name: term.name,
			slug: term.slug,
		},
	} );
	return created.id;
}

function getUsedMediaIds(
	contentItems: LocalContentItem[],
	mediaItems: LocalMedia[]
): Set< number > {
	const usedMediaIds = new Set< number >();
	const contentBlob = contentItems
		.map( ( item ) => `${ getRawField( item.content ) }\n${ getRawField( item.excerpt ) }` )
		.join( '\n' );

	for ( const item of contentItems ) {
		if ( item.featured_media ) {
			usedMediaIds.add( item.featured_media );
		}
	}

	for ( const media of mediaItems ) {
		if ( media.source_url && contentBlob.includes( media.source_url ) ) {
			usedMediaIds.add( media.id );
		}
	}

	return usedMediaIds;
}

async function uploadRemoteMedia(
	connection: z.infer< typeof selfHostedRestConnectionSchema >,
	media: LocalMedia
): Promise< RemoteEntity > {
	const storedRemoteId = await getStoredRemotePostId(
		connection.localSiteId,
		media.id,
		connection.id
	);
	if ( storedRemoteId ) {
		try {
			return await remoteRestRequest< RemoteEntity >(
				connection,
				`/wp/v2/media/${ storedRemoteId }?context=edit`
			);
		} catch {
			// If the remote attachment was deleted, upload it again and refresh the mapping.
		}
	}

	const sourceResponse = await fetch( media.source_url );
	if ( ! sourceResponse.ok ) {
		throw new Error( `Failed to read local media ${ media.source_url }.` );
	}

	const filename = decodeURIComponent(
		new URL( media.source_url ).pathname.split( '/' ).filter( Boolean ).pop() ??
			`media-${ media.id }`
	);

	const uploaded = await remoteRestRequest< RemoteEntity >( connection, '/wp/v2/media', {
		method: 'POST',
		rawBody: await sourceResponse.arrayBuffer(),
		headers: {
			'Content-Type': media.mime_type || 'application/octet-stream',
			'Content-Disposition': `attachment; filename="${ filename.replace( /"/g, '' ) }"`,
		},
	} );

	await remoteRestRequest( connection, `/wp/v2/media/${ uploaded.id }`, {
		method: 'POST',
		body: {
			title: getRawField( media.title ) || filename,
			alt_text: media.alt_text ?? '',
			caption: getRawField( media.caption ),
			description: getRawField( media.description ),
		},
	} );

	await storeRemotePostId( connection.localSiteId, media.id, connection.id, uploaded.id );

	return uploaded;
}

function replaceMediaUrls( value: string, uploadedMediaByLocalUrl: Map< string, string > ): string {
	let nextValue = value;
	for ( const [ localUrl, remoteUrl ] of uploadedMediaByLocalUrl ) {
		nextValue = nextValue.split( localUrl ).join( remoteUrl );
	}
	return nextValue;
}

async function getStoredRemotePostId(
	localSiteId: string,
	localPostId: number,
	connectionId: string
): Promise< number | null > {
	const site = SiteServer.get( localSiteId );
	if ( ! site ) {
		throw new Error( 'Site not found.' );
	}

	const result = await site.executeWpCliCommand( [
		'post',
		'meta',
		'get',
		String( localPostId ),
		`_studio_remote_post_id_${ connectionId }`,
	] );

	const value = Number.parseInt( result.stdout.trim(), 10 );
	return Number.isFinite( value ) ? value : null;
}

async function storeRemotePostId(
	localSiteId: string,
	localPostId: number,
	connectionId: string,
	remotePostId: number
): Promise< void > {
	const site = SiteServer.get( localSiteId );
	if ( ! site ) {
		throw new Error( 'Site not found.' );
	}

	await site.executeWpCliCommand( [
		'post',
		'meta',
		'update',
		String( localPostId ),
		`_studio_remote_post_id_${ connectionId }`,
		String( remotePostId ),
	] );
}

async function findRemoteContentMatch(
	connection: z.infer< typeof selfHostedRestConnectionSchema >,
	item: LocalContentItem
): Promise< { remoteId: number | null; source: 'stored' | 'slug' | null } > {
	const storedRemoteId = await getStoredRemotePostId(
		connection.localSiteId,
		item.id,
		connection.id
	);
	if ( storedRemoteId ) {
		return { remoteId: storedRemoteId, source: 'stored' };
	}

	const resource = item.type === 'page' ? 'pages' : 'posts';
	const existing = await remoteRestRequest< RemoteEntity[] >(
		connection,
		`/wp/v2/${ resource }?slug=${ encodeURIComponent( item.slug ) }&status=any&context=edit`
	);
	return existing[ 0 ]?.id
		? { remoteId: existing[ 0 ].id, source: 'slug' }
		: { remoteId: null, source: null };
}

async function findRemoteContentItem(
	connection: z.infer< typeof selfHostedRestConnectionSchema >,
	item: LocalContentItem
): Promise< number | null > {
	const match = await findRemoteContentMatch( connection, item );
	if ( match.source === 'slug' ) {
		throw new Error(
			`Remote ${ item.type } with slug "${ item.slug }" already exists but is not mapped to this local item.`
		);
	}
	return match.remoteId;
}

export async function previewSelfHostedRestContentPush(
	_event: IpcMainInvokeEvent,
	localSiteId: string,
	connectionId: string,
	options: { selectedItems?: Array< { id: number; type: 'post' | 'page' } > } = {}
): Promise< ContentPushPreview > {
	const connections = await getSyncConnectionsForLocalSite( localSiteId );
	const connection = connections.find( ( item ) => item.id === connectionId );
	const parsed = selfHostedRestConnectionSchema.parse( connection );
	const allContentItems = await fetchAllLocalContent( localSiteId );
	const contentItems = filterSelectedContentItems( allContentItems, options.selectedItems );
	const items: ContentPushPreviewItem[] = [];

	for ( const item of contentItems ) {
		const match = await findRemoteContentMatch( parsed, item );
		const base = {
			id: item.id,
			type: item.type,
			title: getRawField( item.title ) || item.slug || `#${ item.id }`,
			slug: item.slug,
			remoteId: match.remoteId,
		};

		if ( match.source === 'stored' ) {
			items.push( { ...base, action: 'update' } );
		} else if ( match.source === 'slug' ) {
			items.push( {
				...base,
				action: 'conflict',
				reason: 'A remote item already uses this slug, but Studio has not mapped it yet.',
			} );
		} else {
			items.push( { ...base, action: 'create' } );
		}
	}

	return {
		items,
		summary: {
			create: items.filter( ( item ) => item.action === 'create' ).length,
			update: items.filter( ( item ) => item.action === 'update' ).length,
			conflict: items.filter( ( item ) => item.action === 'conflict' ).length,
		},
	};
}

export async function pushSelfHostedRestContent(
	_event: IpcMainInvokeEvent,
	localSiteId: string,
	connectionId: string,
	options: {
		publish?: boolean;
		selectedItems?: Array< { id: number; type: 'post' | 'page' } >;
	} = {}
): Promise< { posts: number; pages: number; media: number; categories: number; tags: number } > {
	const connections = await getSyncConnectionsForLocalSite( localSiteId );
	const connection = connections.find( ( item ) => item.id === connectionId );
	const parsed = selfHostedRestConnectionSchema.parse( connection );

	const [ allContentItems, categories, tags, mediaItems ] = await Promise.all( [
		fetchAllLocalContent( localSiteId ),
		fetchAllLocal< LocalTerm >( localSiteId, 'categories' ),
		fetchAllLocal< LocalTerm >( localSiteId, 'tags' ),
		fetchAllLocal< LocalMedia >( localSiteId, 'media' ),
	] );

	const contentItems = filterSelectedContentItems( allContentItems, options.selectedItems );

	const categoriesById = mapTermsById( categories );
	const tagsById = mapTermsById( tags );
	const remoteCategoryIdsByLocalId = new Map< number, number >();
	const remoteTagIdsByLocalId = new Map< number, number >();

	for ( const item of contentItems.filter( ( contentItem ) => contentItem.type === 'post' ) ) {
		for ( const localCategoryId of item.categories ?? [] ) {
			const category = categoriesById.get( localCategoryId );
			if ( category && ! remoteCategoryIdsByLocalId.has( localCategoryId ) ) {
				remoteCategoryIdsByLocalId.set(
					localCategoryId,
					await ensureRemoteTerm( parsed, 'categories', category )
				);
			}
		}

		for ( const localTagId of item.tags ?? [] ) {
			const tag = tagsById.get( localTagId );
			if ( tag && ! remoteTagIdsByLocalId.has( localTagId ) ) {
				remoteTagIdsByLocalId.set( localTagId, await ensureRemoteTerm( parsed, 'tags', tag ) );
			}
		}
	}

	const usedMediaIds = getUsedMediaIds( contentItems, mediaItems );
	const mediaById = new Map( mediaItems.map( ( media ) => [ media.id, media ] ) );
	const remoteMediaByLocalId = new Map< number, RemoteEntity >();
	const uploadedMediaByLocalUrl = new Map< string, string >();

	for ( const localMediaId of usedMediaIds ) {
		const media = mediaById.get( localMediaId );
		if ( media ) {
			const uploaded = await uploadRemoteMedia( parsed, media );
			remoteMediaByLocalId.set( localMediaId, uploaded );
			if ( media.source_url && uploaded.source_url ) {
				uploadedMediaByLocalUrl.set( media.source_url, uploaded.source_url );
			}
		}
	}

	const summary = { posts: 0, pages: 0, media: remoteMediaByLocalId.size, categories: 0, tags: 0 };
	summary.categories = remoteCategoryIdsByLocalId.size;
	summary.tags = remoteTagIdsByLocalId.size;

	for ( const item of contentItems ) {
		const resource = item.type === 'page' ? 'pages' : 'posts';
		const remoteId = await findRemoteContentItem( parsed, item );
		const body: Record< string, unknown > = {
			title: getRawField( item.title ),
			content: replaceMediaUrls( getRawField( item.content ), uploadedMediaByLocalUrl ),
			excerpt: replaceMediaUrls( getRawField( item.excerpt ), uploadedMediaByLocalUrl ),
			slug: item.slug,
			status: options.publish ? 'publish' : 'draft',
		};

		if ( item.featured_media ) {
			body.featured_media = remoteMediaByLocalId.get( item.featured_media )?.id ?? 0;
		}

		if ( item.type === 'post' ) {
			body.categories = ( item.categories ?? [] )
				.map( ( localCategoryId ) => remoteCategoryIdsByLocalId.get( localCategoryId ) )
				.filter( ( id ): id is number => typeof id === 'number' );
			body.tags = ( item.tags ?? [] )
				.map( ( localTagId ) => remoteTagIdsByLocalId.get( localTagId ) )
				.filter( ( id ): id is number => typeof id === 'number' );
		}

		const saved = await remoteRestRequest< RemoteEntity >(
			parsed,
			remoteId ? `/wp/v2/${ resource }/${ remoteId }` : `/wp/v2/${ resource }`,
			{
				method: 'POST',
				body,
			}
		);
		await storeRemotePostId( localSiteId, item.id, connectionId, saved.id );

		if ( item.type === 'page' ) {
			summary.pages++;
		} else {
			summary.posts++;
		}
	}

	return summary;
}
