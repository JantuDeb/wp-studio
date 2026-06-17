import { safeStorage } from 'electron';
import {
	selfHostedConnectorAuthSchema,
	selfHostedRestAuthSchema,
	selfHostedSshAuthSchema,
	type SyncConnection,
} from '@studio/common/types/sync';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';

type SelfHostedConnection = Extract< SyncConnection, { siteUrl: string } >;

function getCredentialKey( localSiteId: string, connectionId: string ): string {
	return `${ localSiteId }:${ connectionId }`;
}

function isSelfHostedConnection( connection: SyncConnection ): connection is SelfHostedConnection {
	return 'siteUrl' in connection;
}

function getAuthSchemaForConnection( connection: SelfHostedConnection ) {
	switch ( connection.provider ) {
		case 'self-hosted-rest':
			return selfHostedRestAuthSchema;
		case 'self-hosted-ssh':
			return selfHostedSshAuthSchema;
		case 'self-hosted-connector':
			return selfHostedConnectorAuthSchema;
	}
}

function assertEncryptionAvailable(): void {
	if ( ! safeStorage.isEncryptionAvailable() ) {
		throw new Error( 'Secure credential storage is not available on this system.' );
	}
}

export function stripSyncConnectionAuth( connection: SyncConnection ): SyncConnection {
	if ( ! isSelfHostedConnection( connection ) || ! connection.auth ) {
		return connection;
	}

	const { auth, ...metadata } = connection;
	return metadata;
}

export function stripSyncConnectionsAuth( connections: SyncConnection[] ): SyncConnection[] {
	return connections.map( stripSyncConnectionAuth );
}

export async function saveSyncConnectionCredentials(
	localSiteId: string,
	connection: SyncConnection
): Promise< void > {
	if ( ! isSelfHostedConnection( connection ) || ! connection.auth ) {
		return;
	}

	assertEncryptionAvailable();
	const auth = getAuthSchemaForConnection( connection ).parse( connection.auth );
	const key = getCredentialKey( localSiteId, connection.id );
	const encryptedAuth = safeStorage.encryptString( JSON.stringify( auth ) ).toString( 'base64' );

	try {
		await lockAppdata();
		const userData = await loadUserData();
		userData.syncConnectionCredentials ??= {};
		userData.syncConnectionCredentials[ key ] = {
			encryptedAuth,
			updatedAt: new Date().toISOString(),
		};
		await saveUserData( userData );
	} finally {
		await unlockAppdata();
	}
}

export async function deleteSyncConnectionCredentials(
	localSiteId: string,
	connectionId: string
): Promise< void > {
	try {
		await lockAppdata();
		const userData = await loadUserData();
		const key = getCredentialKey( localSiteId, connectionId );
		if ( ! userData.syncConnectionCredentials?.[ key ] ) {
			return;
		}

		delete userData.syncConnectionCredentials[ key ];
		if ( Object.keys( userData.syncConnectionCredentials ).length === 0 ) {
			delete userData.syncConnectionCredentials;
		}
		await saveUserData( userData );
	} finally {
		await unlockAppdata();
	}
}

export async function hydrateSyncConnectionCredentials(
	localSiteId: string,
	connection: SyncConnection | undefined
): Promise< SyncConnection | undefined > {
	if ( ! connection || ! isSelfHostedConnection( connection ) || connection.auth ) {
		return connection;
	}

	assertEncryptionAvailable();
	const key = getCredentialKey( localSiteId, connection.id );
	const userData = await loadUserData();
	const encryptedAuth = userData.syncConnectionCredentials?.[ key ]?.encryptedAuth;
	if ( ! encryptedAuth ) {
		throw new Error( 'Saved credentials were not found for this sync connection.' );
	}

	const decrypted = safeStorage.decryptString( Buffer.from( encryptedAuth, 'base64' ) );
	const auth = getAuthSchemaForConnection( connection ).parse( JSON.parse( decrypted ) );

	return {
		...connection,
		auth,
	} as SyncConnection;
}
