import { syncDeploymentRecordSchema, type SyncDeploymentRecord } from '@studio/common/types/sync';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';

// Keep a bounded history per connection so the config file does not grow without limit.
const MAX_RECORDS_PER_CONNECTION = 100;

function getHistoryKey( localSiteId: string, connectionId: string ): string {
	return `${ localSiteId }:${ connectionId }`;
}

/**
 * Append a deployment/audit record for a self-hosted sync operation. Writes under the app-data lock
 * and trims the per-connection history to the newest `MAX_RECORDS_PER_CONNECTION` entries. Records
 * contain no secrets.
 */
export async function recordSyncDeployment( record: SyncDeploymentRecord ): Promise< void > {
	const parsed = syncDeploymentRecordSchema.parse( record );
	const key = getHistoryKey( parsed.localSiteId, parsed.connectionId );

	try {
		await lockAppdata();
		const userData = await loadUserData();
		userData.syncDeploymentHistory ??= {};
		const existing = userData.syncDeploymentHistory[ key ] ?? [];
		userData.syncDeploymentHistory[ key ] = [ parsed, ...existing ].slice(
			0,
			MAX_RECORDS_PER_CONNECTION
		);
		await saveUserData( userData );
	} finally {
		await unlockAppdata();
	}
}

/**
 * List the deployment history for a connection, newest-first. Malformed entries are skipped so a
 * single bad record never breaks the view.
 */
export async function listSyncDeployments(
	localSiteId: string,
	connectionId: string
): Promise< SyncDeploymentRecord[] > {
	const userData = await loadUserData();
	const key = getHistoryKey( localSiteId, connectionId );
	const entries = userData.syncDeploymentHistory?.[ key ] ?? [];
	const records: SyncDeploymentRecord[] = [];
	for ( const entry of entries ) {
		const result = syncDeploymentRecordSchema.safeParse( entry );
		if ( result.success ) {
			records.push( result.data );
		}
	}
	return records.sort( ( a, b ) => b.startedAt.localeCompare( a.startedAt ) );
}
