import { syncConnectionSchema, type SyncConnection } from '@studio/common/types/sync';
import {
	lockSharedConfig,
	readSharedConfig,
	saveSharedConfig,
	unlockSharedConfig,
} from './shared-config';
import type { SharedConfig } from './shared-config';

function getConnectionsForLocalSite(
	config: Pick< SharedConfig, 'syncConnections' > | null,
	localSiteId: string
): SyncConnection[] {
	return config?.syncConnections?.[ localSiteId ] ?? [];
}

function getMutableConnectionsForLocalSite(
	config: SharedConfig,
	localSiteId: string
): SyncConnection[] {
	config.syncConnections ??= {};
	config.syncConnections[ localSiteId ] ??= [];
	return config.syncConnections[ localSiteId ];
}

function pruneEmptyConnectionsForLocalSite( config: SharedConfig, localSiteId: string ): void {
	if ( ! config.syncConnections ) {
		return;
	}

	if ( config.syncConnections[ localSiteId ]?.length === 0 ) {
		delete config.syncConnections[ localSiteId ];
	}

	if ( Object.keys( config.syncConnections ).length === 0 ) {
		delete config.syncConnections;
	}
}

function normalizeConnection( localSiteId: string, connection: SyncConnection ): SyncConnection {
	return syncConnectionSchema.parse( {
		...connection,
		localSiteId,
	} );
}

export async function getSyncConnectionsForLocalSite(
	localSiteId: string
): Promise< SyncConnection[] > {
	const config = await readSharedConfig().catch( () => null );
	return getConnectionsForLocalSite( config, localSiteId );
}

export async function addOrUpdateSyncConnection(
	localSiteId: string,
	connection: SyncConnection
): Promise< SyncConnection[] > {
	try {
		await lockSharedConfig();
		const config = await readSharedConfig();
		const connections = getMutableConnectionsForLocalSite( config, localSiteId );
		const incoming = normalizeConnection( localSiteId, connection );
		const existingIndex = connections.findIndex( ( item ) => item.id === incoming.id );

		if ( existingIndex >= 0 ) {
			connections[ existingIndex ] = incoming;
		} else {
			connections.push( incoming );
		}

		await saveSharedConfig( config );
		return connections;
	} finally {
		await unlockSharedConfig();
	}
}

export async function removeSyncConnection(
	localSiteId: string,
	connectionId: string
): Promise< SyncConnection[] > {
	try {
		await lockSharedConfig();
		const config = await readSharedConfig();
		const connections = getConnectionsForLocalSite( config, localSiteId );
		const nextConnections = connections.filter( ( connection ) => connection.id !== connectionId );

		config.syncConnections ??= {};
		config.syncConnections[ localSiteId ] = nextConnections;
		pruneEmptyConnectionsForLocalSite( config, localSiteId );

		await saveSharedConfig( config );
		return nextConnections;
	} finally {
		await unlockSharedConfig();
	}
}
