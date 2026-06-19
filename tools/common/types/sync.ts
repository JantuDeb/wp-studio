import { z } from 'zod';

// WordPress.com /me/sites endpoint response schemas
export const sitesEndpointSiteSchema = z.object( {
	ID: z.number(),
	is_wpcom_atomic: z.boolean(),
	name: z.string(),
	URL: z.string(),
	jetpack: z.boolean().optional(),
	is_deleted: z.boolean(),
	hosting_provider_guess: z.string().optional(),
	environment_type: z
		.enum( [ 'production', 'staging', 'development', 'sandbox', 'local' ] )
		.nullable()
		.optional(),
	is_a8c: z.boolean().optional(),
	icon: z
		.object( {
			img: z.string(),
			ico: z.string(),
		} )
		.optional(),
	options: z
		.object( {
			created_at: z.string(),
			wpcom_staging_blog_ids: z.array( z.number() ),
			software_version: z.string(),
		} )
		.optional(),
	capabilities: z
		.object( {
			manage_options: z.boolean(),
		} )
		.optional(),
	plan: z
		.object( {
			expired: z.boolean().optional(),
			features: z.object( {
				active: z.array( z.string() ),
				available: z.record( z.string(), z.array( z.string() ) ).optional(),
			} ),
			is_free: z.boolean().optional(),
			product_id: z.coerce.number(),
			product_name_short: z.string(),
			product_slug: z.string(),
			user_is_owner: z.boolean().optional(),
		} )
		.optional(),
} );

export type SitesEndpointSite = z.infer< typeof sitesEndpointSiteSchema >;

// Permissive wrapper for the /me/sites response (to fail gracefully per-site)
export const sitesEndpointResponseSchema = z.object( {
	sites: z.array( z.unknown() ),
	total: z.number().optional(),
	page: z.number().optional(),
	per_page: z.number().optional(),
} );

// Sync support types
export const syncSupportValues = [
	'unsupported',
	'syncable',
	'needs-transfer',
	'already-connected',
	'needs-upgrade',
	'deleted',
	'missing-permissions',
] as const;

export type SyncSupport = ( typeof syncSupportValues )[ number ];

export const syncProviderValues = [
	'wpcom',
	'self-hosted-rest',
	'self-hosted-ssh',
	'self-hosted-connector',
] as const;

export const syncProviderSchema = z.enum( syncProviderValues );
export type SyncProviderType = z.infer< typeof syncProviderSchema >;

export const syncEnvironmentTypeValues = [ 'production', 'staging', 'development' ] as const;

export const syncEnvironmentTypeSchema = z.enum( syncEnvironmentTypeValues );
export type SyncEnvironmentType = z.infer< typeof syncEnvironmentTypeSchema >;

export const syncModeValues = [
	'wpcom',
	'rest-content',
	'ssh-wp-cli',
	'connector-plugin',
] as const;

export const syncModeSchema = z.enum( syncModeValues );
export type SyncMode = z.infer< typeof syncModeSchema >;

export const syncConnectionCapabilitiesSchema = z.object( {
	canPull: z.boolean().default( false ),
	canPush: z.boolean().default( false ),
	canPushToProduction: z.boolean().default( false ),
	canSyncContent: z.boolean().default( false ),
	canSyncDatabase: z.boolean().default( false ),
	canSyncFiles: z.boolean().default( false ),
	requiresBackupBeforePush: z.boolean().default( false ),
	requiresDryRunBeforeProductionPush: z.boolean().default( false ),
} );

export type SyncConnectionCapabilities = z.infer< typeof syncConnectionCapabilitiesSchema >;

// Sync site representation
export const syncSiteSchema = z.object( {
	provider: z.literal( 'wpcom' ).optional(),
	id: z.number(),
	localSiteId: z.string(),
	name: z.string(),
	url: z.string(),
	isStaging: z.boolean(),
	isPressable: z.boolean(),
	environmentType: z.string().nullable().optional(),
	syncSupport: z.enum( syncSupportValues ),
	lastPullTimestamp: z.string().nullable(),
	lastPushTimestamp: z.string().nullable(),
	wpVersion: z.string().optional(),
	planName: z.string().optional(),
	createdAt: z.string().optional(),
} );

export type SyncSite = z.infer< typeof syncSiteSchema >;

export const selfHostedRestAuthSchema = z.object( {
	username: z.string(),
	applicationPassword: z.string(),
} );

export const selfHostedSshAuthSchema = z.object( {
	host: z.string(),
	port: z.number().int().positive().default( 22 ),
	username: z.string(),
	password: z.string().optional(),
	privateKeyPath: z.string().optional(),
	privateKeyText: z.string().optional(),
	remoteWordPressPath: z.string(),
	wpCliPath: z.string().optional(),
} );

export const selfHostedConnectorAuthSchema = z.object( {
	token: z.string(),
} );

const syncConnectionBaseSchema = z.object( {
	id: z.string(),
	localSiteId: z.string(),
	siteUrl: z.string().url(),
	environmentType: syncEnvironmentTypeSchema,
	lastPullTimestamp: z.string().nullable().default( null ),
	lastPushTimestamp: z.string().nullable().default( null ),
	capabilities: syncConnectionCapabilitiesSchema,
	createdAt: z.string().optional(),
	updatedAt: z.string().optional(),
} );

export const selfHostedRestConnectionSchema = syncConnectionBaseSchema.extend( {
	provider: z.literal( 'self-hosted-rest' ),
	syncMode: z.literal( 'rest-content' ),
	auth: selfHostedRestAuthSchema.optional(),
} );

export const selfHostedSshConnectionSchema = syncConnectionBaseSchema.extend( {
	provider: z.literal( 'self-hosted-ssh' ),
	syncMode: z.literal( 'ssh-wp-cli' ),
	auth: selfHostedSshAuthSchema.optional(),
} );

export const selfHostedConnectorConnectionSchema = syncConnectionBaseSchema.extend( {
	provider: z.literal( 'self-hosted-connector' ),
	syncMode: z.literal( 'connector-plugin' ),
	auth: selfHostedConnectorAuthSchema.optional(),
} );

export const selfHostedRestConnectionWithAuthSchema = selfHostedRestConnectionSchema.extend( {
	auth: selfHostedRestAuthSchema,
} );

export const selfHostedSshConnectionWithAuthSchema = selfHostedSshConnectionSchema.extend( {
	auth: selfHostedSshAuthSchema,
} );

export const selfHostedConnectorConnectionWithAuthSchema =
	selfHostedConnectorConnectionSchema.extend( {
		auth: selfHostedConnectorAuthSchema,
	} );

export const syncConnectionSchema = z.union( [
	syncSiteSchema,
	selfHostedRestConnectionSchema,
	selfHostedSshConnectionSchema,
	selfHostedConnectorConnectionSchema,
] );

export type SelfHostedRestConnection = z.infer< typeof selfHostedRestConnectionSchema >;
export type SelfHostedSshConnection = z.infer< typeof selfHostedSshConnectionSchema >;
export type SelfHostedConnectorConnection = z.infer< typeof selfHostedConnectorConnectionSchema >;
export type SelfHostedRestConnectionWithAuth = z.infer<
	typeof selfHostedRestConnectionWithAuthSchema
>;
export type SelfHostedSshConnectionWithAuth = z.infer<
	typeof selfHostedSshConnectionWithAuthSchema
>;
export type SelfHostedConnectorConnectionWithAuth = z.infer<
	typeof selfHostedConnectorConnectionWithAuthSchema
>;
export type SyncConnection = z.infer< typeof syncConnectionSchema >;

// Pull backup API schemas
export const pullSiteResponseSchema = z.object( {
	success: z.boolean(),
	backup_id: z.number(),
} );

export const syncBackupResponseSchema = z.object( {
	status: z.enum( [ 'in-progress', 'finished', 'failed' ] ),
	download_url: z.string().nullable().optional(),
	percent: z.number(),
} );

// Push import API schemas
export const importFailedResponseSchema = z.object( {
	status: z.literal( 'failed' ),
	success: z.boolean(),
	error: z.string(),
	error_data: z
		.object( {
			vp_restore_status: z.string().nullable(),
			vp_restore_message: z.string().nullable(),
			vp_rewind_id: z.string().nullable(),
		} )
		.nullable(),
} );

export const importWorkingResponseSchema = z.object( {
	status: z.enum( [
		'started',
		'initial_backup_started',
		'initial_backup_finished',
		'archive_import_started',
		'archive_import_finished',
		'finished',
	] ),
	success: z.boolean(),
	backup_progress: z.number().nullable(),
	import_progress: z.number().nullable(),
} );

export const importResponseSchema = z.discriminatedUnion( 'status', [
	importWorkingResponseSchema,
	importFailedResponseSchema,
] );

export type ImportResponse = z.infer< typeof importResponseSchema >;

// Sync option types (shared between push/pull)
export const syncOptionSchema = z.enum( [
	'all',
	'sqls',
	'paths',
	'uploads',
	'plugins',
	'themes',
	'contents',
] );
export type SyncOption = z.infer< typeof syncOptionSchema >;

export const selfHostedSshPullOptionsSchema = z.object( {
	optionsToSync: z.array( syncOptionSchema ),
	specificSelectionPaths: z.array( z.string() ).optional(),
} );
export type SelfHostedSshPullOptions = z.infer< typeof selfHostedSshPullOptionsSchema >;

export const selfHostedSshPushOptionsSchema = selfHostedSshPullOptionsSchema;
export type SelfHostedSshPushOptions = z.infer< typeof selfHostedSshPushOptionsSchema >;

export const selfHostedSshBackupSchema = z.object( {
	id: z.string(),
	createdAt: z.string(),
	archivePath: z.string(),
	includeDatabase: z.boolean(),
	selectedPaths: z.array( z.string() ),
	sizeInBytes: z.number().nonnegative(),
} );
export type SelfHostedSshBackup = z.infer< typeof selfHostedSshBackupSchema >;

// Deployment history / audit record for a self-hosted push or restore. Stored in Desktop app data
// keyed by `localSiteId:connectionId` so users can see what was deployed where, when, and whether
// it verified.
export const syncDeploymentRecordSchema = z.object( {
	id: z.string(),
	localSiteId: z.string(),
	connectionId: z.string(),
	provider: syncProviderSchema,
	operation: z.enum( [ 'push', 'pull', 'restore', 'rest-content-push' ] ),
	environmentType: syncEnvironmentTypeSchema,
	startedAt: z.string(),
	finishedAt: z.string(),
	status: z.enum( [ 'success', 'verified-with-warnings', 'failed' ] ),
	detail: z.string(),
	// Optional scope summary, e.g. selected paths, item counts, or the backup path created.
	summary: z.record( z.string(), z.unknown() ).optional(),
} );
export type SyncDeploymentRecord = z.infer< typeof syncDeploymentRecordSchema >;

// Automatic backup retention policy. Any limit left undefined is not enforced. The newest backup is
// always kept regardless of policy so a push never deletes its own just-created backup.
export const selfHostedSshBackupRetentionPolicySchema = z.object( {
	maxCount: z.number().int().positive().optional(),
	maxAgeInDays: z.number().positive().optional(),
	maxTotalSizeInBytes: z.number().positive().optional(),
} );
export type SelfHostedSshBackupRetentionPolicy = z.infer<
	typeof selfHostedSshBackupRetentionPolicySchema
>;

export const selfHostedSshPullEstimateSchema = z.object( {
	includeDatabase: z.boolean(),
	databaseSizeInBytes: z.number().nonnegative(),
	wpContentSizeInBytes: z.number().nonnegative(),
	estimatedSourceSizeInBytes: z.number().nonnegative(),
	selectedPaths: z.array( z.string() ),
} );
export type SelfHostedSshPullEstimate = z.infer< typeof selfHostedSshPullEstimateSchema >;

export const selfHostedSshPushPreflightSchema = z.object( {
	archiveSizeInBytes: z.number().nonnegative(),
	estimatedBackupSizeInBytes: z.number().nonnegative(),
	availableDiskSpaceInBytes: z.number().nonnegative(),
	requiredDiskSpaceInBytes: z.number().nonnegative(),
	hasEnoughDiskSpace: z.boolean(),
	includeDatabase: z.boolean(),
	selectedPaths: z.array( z.string() ),
} );
export type SelfHostedSshPushPreflight = z.infer< typeof selfHostedSshPushPreflightSchema >;

export const selfHostedSshVerificationSchema = z.object( {
	ok: z.boolean(),
	coreVersion: z.string(),
	databaseOk: z.boolean(),
	siteUrl: z.string(),
	homeUrl: z.string(),
	activePluginCount: z.number().int().nonnegative(),
	urlMatchesConnection: z.boolean(),
} );
export type SelfHostedSshVerification = z.infer< typeof selfHostedSshVerificationSchema >;

// Remote server stack detected over SSH. Drives the adaptive (Apache/nginx) server-config UI and
// is persisted on the connection so the renderer can show capabilities without re-probing.
export const selfHostedServerWebServerValues = [ 'apache', 'nginx', 'unknown' ] as const;
export const selfHostedServerStackSchema = z.object( {
	os: z.string(),
	webServer: z.enum( selfHostedServerWebServerValues ),
	webServerVersion: z.string().nullable(),
	phpVersion: z.string().nullable(),
	phpFpm: z.boolean(),
	dbEngine: z.string().nullable(),
	dbVersion: z.string().nullable(),
	docroot: z.string().nullable(),
	// Best-effort discovered config paths, e.g. the active vhost and the site .htaccess.
	configPaths: z.object( {
		vhost: z.string().nullable(),
		htaccess: z.string().nullable(),
	} ),
	// True when the connecting user can run sudo non-interactively (gates reloads/cert issuance).
	canSudo: z.boolean(),
} );
export type SelfHostedServerStack = z.infer< typeof selfHostedServerStackSchema >;

export const selfHostedHtaccessSchema = z.object( {
	exists: z.boolean(),
	path: z.string(),
	content: z.string(),
} );
export type SelfHostedHtaccess = z.infer< typeof selfHostedHtaccessSchema >;

export const selfHostedPhpVersionsSchema = z.object( {
	current: z.string().nullable(),
	// Installed `phpX.Y` versions discovered on the host, e.g. [ '8.1', '8.2', '8.3' ].
	available: z.array( z.string() ),
} );
export type SelfHostedPhpVersions = z.infer< typeof selfHostedPhpVersionsSchema >;

// SSL/TLS status for the connection's domain (doc 8.2).
export const selfHostedSslStatusSchema = z.object( {
	// True when an HTTPS connection to the site presented a certificate.
	hasCertificate: z.boolean(),
	issuer: z.string().nullable(),
	subject: z.string().nullable(),
	// Subject Alternative Name domains covered by the cert.
	domains: z.array( z.string() ),
	validFrom: z.string().nullable(),
	validTo: z.string().nullable(),
	daysUntilExpiry: z.number().nullable(),
	isExpired: z.boolean(),
	// Whether `certbot` is installed on the host (gates issue/renew).
	certbotAvailable: z.boolean(),
} );
export type SelfHostedSslStatus = z.infer< typeof selfHostedSslStatusSchema >;

// Provision a new WordPress site on a server that already has a web server + PHP + DB (doc 8.3).
// Validation of each field is enforced in the main process before any command is built.
export const selfHostedProvisionRequestSchema = z.object( {
	domain: z.string(),
	// Absolute document root to create and point the vhost at.
	docroot: z.string(),
	dbName: z.string(),
	dbUser: z.string(),
	dbPassword: z.string(),
	// MySQL/MariaDB admin credentials used only to create the site DB + user.
	adminDbUser: z.string(),
	adminDbPassword: z.string(),
	// New WordPress admin account.
	siteTitle: z.string(),
	wpAdminUser: z.string(),
	wpAdminPassword: z.string(),
	wpAdminEmail: z.string(),
} );
export type SelfHostedProvisionRequest = z.infer< typeof selfHostedProvisionRequestSchema >;

export const selfHostedProvisionResultSchema = z.object( {
	domain: z.string(),
	docroot: z.string(),
	url: z.string(),
	vhostPath: z.string(),
	wpVersion: z.string(),
} );
export type SelfHostedProvisionResult = z.infer< typeof selfHostedProvisionResultSchema >;

// A config-file backup created by the safe-config-edit primitive (doc 8.5).
export const selfHostedConfigBackupSchema = z.object( {
	// The live config file this backup belongs to (e.g. the .htaccess or vhost path).
	target: z.string(),
	// The backup file path (`<target>.studio-bak-<timestamp>`).
	backupPath: z.string(),
	timestamp: z.number().int().nonnegative(),
	sizeInBytes: z.number().nonnegative(),
} );
export type SelfHostedConfigBackup = z.infer< typeof selfHostedConfigBackupSchema >;

export type SelfHostedSshProgress = {
	localSiteId: string;
	connectionId: string;
	operation: 'pull' | 'push' | 'restore';
	phase:
		| 'preparing'
		| 'exporting'
		| 'uploading'
		| 'downloading'
		| 'backing-up'
		| 'applying'
		| 'importing'
		| 'verifying'
		| 'finished'
		| 'failed';
	progress: number;
	message: string;
};

export const selfHostedSshManagedExtensionSchema = z.object( {
	name: z.string(),
	title: z.string(),
	status: z.string(),
	version: z.string(),
	updateVersion: z.string().nullable(),
} );
export type SelfHostedSshManagedExtension = z.infer< typeof selfHostedSshManagedExtensionSchema >;

export const selfHostedSshAdvisorySeverityValues = [ 'info', 'warning', 'critical' ] as const;
export const selfHostedSshAdvisorySchema = z.object( {
	type: z.enum( [ 'plugin', 'theme', 'core' ] ),
	slug: z.string(),
	title: z.string(),
	severity: z.enum( selfHostedSshAdvisorySeverityValues ),
	// One of: 'outdated' (an update is available), 'removed' (pulled from the wordpress.org
	// directory — a common security-removal signal), 'unknown' (could not be looked up).
	kind: z.enum( [ 'outdated', 'removed', 'unknown' ] ),
	installedVersion: z.string(),
	availableVersion: z.string().nullable(),
	detail: z.string(),
} );
export type SelfHostedSshAdvisory = z.infer< typeof selfHostedSshAdvisorySchema >;

export const selfHostedSshManagementStatusSchema = z.object( {
	coreVersion: z.string(),
	phpVersion: z.string(),
	plugins: z.array( selfHostedSshManagedExtensionSchema ),
	themes: z.array( selfHostedSshManagedExtensionSchema ),
	dueCronEvents: z.number().int().nonnegative(),
	debugLogExists: z.boolean(),
	debugLogSizeInBytes: z.number().nonnegative(),
	recentFatalErrorCount: z.number().int().nonnegative(),
	httpStatus: z.number().int().nonnegative().nullable(),
	httpResponseTimeMs: z.number().int().nonnegative().nullable(),
	availableDiskSpaceInBytes: z.number().nonnegative(),
	wordpressDiskUsageInBytes: z.number().nonnegative(),
} );
export type SelfHostedSshManagementStatus = z.infer< typeof selfHostedSshManagementStatusSchema >;

export const selfHostedSshMaintenanceActionSchema = z.discriminatedUnion( 'action', [
	z.object( { action: z.literal( 'flush-cache' ) } ),
	z.object( { action: z.literal( 'run-cron' ) } ),
	z.object( { action: z.literal( 'clear-debug-log' ) } ),
	z.object( {
		action: z.literal( 'update-plugin' ),
		name: z.string().regex( /^[a-zA-Z0-9._-]+$/ ),
	} ),
	z.object( {
		action: z.literal( 'update-theme' ),
		name: z.string().regex( /^[a-zA-Z0-9._-]+$/ ),
	} ),
	z.object( {
		action: z.literal( 'update-extensions' ),
		plugins: z.array( z.string().regex( /^[a-zA-Z0-9._-]+$/ ) ),
		themes: z.array( z.string().regex( /^[a-zA-Z0-9._-]+$/ ) ),
	} ),
	z.object( { action: z.literal( 'update-core' ) } ),
] );
export type SelfHostedSshMaintenanceAction = z.infer< typeof selfHostedSshMaintenanceActionSchema >;

export const selfHostedSshDebugLogSchema = z.object( {
	content: z.string(),
	sizeInBytes: z.number().nonnegative(),
	lines: z.number().int().nonnegative(),
	fatalErrorCount: z.number().int().nonnegative(),
} );
export type SelfHostedSshDebugLog = z.infer< typeof selfHostedSshDebugLogSchema >;

export const selfHostedSshIncrementalPreviewSchema = z.object( {
	changed: z.array( z.string() ),
	localOnly: z.array( z.string() ),
	remoteOnly: z.array( z.string() ),
	unchangedCount: z.number().int().nonnegative(),
} );
export type SelfHostedSshIncrementalPreview = z.infer<
	typeof selfHostedSshIncrementalPreviewSchema
>;
