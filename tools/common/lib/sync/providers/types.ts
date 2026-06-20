import type {
	ImportResponse,
	SelfHostedConnectorConnection,
	SelfHostedRestConnection,
	SelfHostedSshConnection,
	SyncConnection,
	SyncConnectionCapabilities,
	SyncOption,
	SyncProviderType,
	SyncSite,
} from '@studio/common/types/sync';

export type BackupStatus = {
	status: 'in-progress' | 'finished' | 'failed';
	downloadUrl: string | null;
	percent: number;
};

export type RemoteFileEntry = {
	name: string;
	isDirectory: boolean;
	pathId: string;
	path: string;
};

export type SyncProviderTestResult = {
	ok: boolean;
	message?: string;
	details?: Record< string, unknown >;
};

export interface SyncProvider< TConnection extends SyncConnection = SyncConnection > {
	readonly provider: SyncProviderType;
	readonly capabilities: SyncConnectionCapabilities;
	testConnection( connection: TConnection ): Promise< SyncProviderTestResult >;
}

export interface WpcomArchiveSyncProvider extends SyncProvider< SyncSite > {
	readonly provider: 'wpcom';
	fetchSyncableSites( token: string ): Promise< SyncSite[] >;
	initiateBackup(
		token: string,
		remoteSiteId: number,
		options: { optionsToSync: SyncOption[]; includePathList?: string[] }
	): Promise< number >;
	pollBackupStatus(
		token: string,
		remoteSiteId: number,
		backupId: number
	): Promise< BackupStatus >;
	initiateImport(
		token: string,
		remoteSiteId: number,
		attachmentId: string,
		options?: { optionsToSync?: SyncOption[]; specificSelectionPaths?: string[] }
	): Promise< void >;
	pollImportStatus( token: string, remoteSiteId: number ): Promise< ImportResponse >;
	fetchLatestRewindId( token: string, remoteSiteId: number ): Promise< string >;
	fetchRemoteFileTree(
		token: string,
		remoteSiteId: number,
		rewindId: string,
		treePath?: string
	): Promise< RemoteFileEntry[] >;
}

export type SelfHostedConnection =
	| SelfHostedRestConnection
	| SelfHostedSshConnection
	| SelfHostedConnectorConnection;
