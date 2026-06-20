import { __ } from '@wordpress/i18n';
import { syncConnectionCapabilitiesSchema } from '@studio/common/types/sync';
import type { SelfHostedConnection, SyncProvider, SyncProviderTestResult } from './types';
import type {
	SelfHostedConnectorConnection,
	SelfHostedRestConnection,
	SelfHostedSshConnection,
} from '@studio/common/types/sync';

function getNotImplementedResult(): SyncProviderTestResult {
	return {
		ok: false,
		message: __( 'This self-hosted sync provider is not implemented yet.' ),
	};
}

export abstract class SelfHostedSyncProvider< TConnection extends SelfHostedConnection >
	implements SyncProvider< TConnection >
{
	abstract readonly provider: TConnection[ 'provider' ];
	abstract readonly capabilities: TConnection[ 'capabilities' ];

	async testConnection(): Promise< SyncProviderTestResult > {
		return getNotImplementedResult();
	}
}

export class SelfHostedRestContentSyncProvider extends SelfHostedSyncProvider< SelfHostedRestConnection > {
	readonly provider = 'self-hosted-rest' as const;

	readonly capabilities = syncConnectionCapabilitiesSchema.parse( {
		canPull: false,
		canPush: true,
		canPushToProduction: true,
		canSyncContent: true,
		canSyncDatabase: false,
		canSyncFiles: false,
		requiresBackupBeforePush: false,
		requiresDryRunBeforeProductionPush: false,
	} );
}

export class SelfHostedSshSyncProvider extends SelfHostedSyncProvider< SelfHostedSshConnection > {
	readonly provider = 'self-hosted-ssh' as const;

	readonly capabilities = syncConnectionCapabilitiesSchema.parse( {
		canPull: true,
		canPush: true,
		canPushToProduction: false,
		canSyncContent: true,
		canSyncDatabase: true,
		canSyncFiles: true,
		requiresBackupBeforePush: true,
		requiresDryRunBeforeProductionPush: true,
	} );
}

export class SelfHostedConnectorPluginSyncProvider extends SelfHostedSyncProvider< SelfHostedConnectorConnection > {
	readonly provider = 'self-hosted-connector' as const;

	readonly capabilities = syncConnectionCapabilitiesSchema.parse( {
		canPull: true,
		canPush: true,
		canPushToProduction: false,
		canSyncContent: true,
		canSyncDatabase: true,
		canSyncFiles: true,
		requiresBackupBeforePush: true,
		requiresDryRunBeforeProductionPush: true,
	} );
}
