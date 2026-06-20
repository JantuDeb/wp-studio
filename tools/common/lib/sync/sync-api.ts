import fs from 'fs';
import { Readable } from 'stream';
import { WpcomSyncProvider } from './providers';
import type { SyncSite, ImportResponse, SyncOption } from '@studio/common/types/sync';

const wpcomSyncProvider = new WpcomSyncProvider();

export async function fetchSyncableSites( token: string ): Promise< SyncSite[] > {
	return wpcomSyncProvider.fetchSyncableSites( token );
}

export async function initiateBackup(
	token: string,
	remoteSiteId: number,
	options: { optionsToSync: SyncOption[]; includePathList?: string[] }
): Promise< number > {
	return wpcomSyncProvider.initiateBackup( token, remoteSiteId, options );
}

export type BackupStatus = {
	status: 'in-progress' | 'finished' | 'failed';
	downloadUrl: string | null;
	percent: number;
};

export async function pollBackupStatus(
	token: string,
	remoteSiteId: number,
	backupId: number
): Promise< BackupStatus > {
	return wpcomSyncProvider.pollBackupStatus( token, remoteSiteId, backupId );
}

export async function initiateImport(
	token: string,
	remoteSiteId: number,
	attachmentId: string,
	options?: { optionsToSync?: SyncOption[]; specificSelectionPaths?: string[] }
): Promise< void > {
	await wpcomSyncProvider.initiateImport( token, remoteSiteId, attachmentId, options );
}

export async function pollImportStatus(
	token: string,
	remoteSiteId: number
): Promise< ImportResponse > {
	return wpcomSyncProvider.pollImportStatus( token, remoteSiteId );
}

export async function checkBackupSize( url: string ): Promise< number > {
	const response = await fetch( url, { method: 'HEAD' } );
	if ( ! response.ok ) {
		throw new Error( `Failed to fetch backup size: ${ response.statusText }` );
	}
	const contentLength = response.headers.get( 'content-length' );
	if ( ! contentLength ) {
		return 0;
	}
	return parseInt( contentLength, 10 );
}

export async function downloadBackup( url: string, destPath: string ): Promise< void > {
	const response = await fetch( url );
	if ( ! response.ok || ! response.body ) {
		throw new Error( 'Failed to download backup' );
	}

	const fileStream = fs.createWriteStream( destPath );
	const readable = Readable.fromWeb( response.body as import('stream/web').ReadableStream );

	return new Promise< void >( ( resolve, reject ) => {
		readable.pipe( fileStream );
		fileStream.on( 'finish', resolve );
		fileStream.on( 'error', reject );
		readable.on( 'error', reject );
	} );
}

export async function fetchLatestRewindId(
	token: string,
	remoteSiteId: number
): Promise< string > {
	return wpcomSyncProvider.fetchLatestRewindId( token, remoteSiteId );
}

export type RemoteFileEntry = {
	name: string;
	isDirectory: boolean;
	pathId: string;
	path: string;
};

export async function fetchRemoteFileTree(
	token: string,
	remoteSiteId: number,
	rewindId: string,
	treePath: string = '/wp-content/'
): Promise< RemoteFileEntry[] > {
	return wpcomSyncProvider.fetchRemoteFileTree( token, remoteSiteId, rewindId, treePath );
}
