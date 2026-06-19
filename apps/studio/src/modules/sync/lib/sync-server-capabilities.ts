import { selfHostedServerStackSchema, type SelfHostedServerStack } from '@studio/common/types/sync';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';

/**
 * Cache the detected server stack on the connection's app-data record (doc 8.4) so the renderer can
 * show capabilities (web server, PHP, DB) instantly without re-probing over SSH every time. The
 * cache holds no secrets; it is refreshed whenever detection runs.
 */

function getCapabilityKey( localSiteId: string, connectionId: string ): string {
	return `${ localSiteId }:${ connectionId }`;
}

export async function saveServerCapabilities(
	localSiteId: string,
	connectionId: string,
	stack: SelfHostedServerStack,
	detectedAt: string
): Promise< void > {
	const parsed = selfHostedServerStackSchema.parse( stack );
	try {
		await lockAppdata();
		const userData = await loadUserData();
		userData.syncServerCapabilities ??= {};
		userData.syncServerCapabilities[ getCapabilityKey( localSiteId, connectionId ) ] = {
			stack: parsed,
			detectedAt,
		};
		await saveUserData( userData );
	} finally {
		await unlockAppdata();
	}
}

/** Return the cached stack for a connection, or null when none is cached or it is malformed. */
export async function loadServerCapabilities(
	localSiteId: string,
	connectionId: string
): Promise< { stack: SelfHostedServerStack; detectedAt: string } | null > {
	const userData = await loadUserData();
	const record = userData.syncServerCapabilities?.[ getCapabilityKey( localSiteId, connectionId ) ];
	if ( ! record ) {
		return null;
	}
	const result = selfHostedServerStackSchema.safeParse( record.stack );
	return result.success ? { stack: result.data, detectedAt: record.detectedAt } : null;
}

export async function deleteServerCapabilities(
	localSiteId: string,
	connectionId: string
): Promise< void > {
	try {
		await lockAppdata();
		const userData = await loadUserData();
		const key = getCapabilityKey( localSiteId, connectionId );
		if ( ! userData.syncServerCapabilities?.[ key ] ) {
			return;
		}
		delete userData.syncServerCapabilities[ key ];
		await saveUserData( userData );
	} finally {
		await unlockAppdata();
	}
}
