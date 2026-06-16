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
	auth: selfHostedRestAuthSchema,
} );

export const selfHostedSshConnectionSchema = syncConnectionBaseSchema.extend( {
	provider: z.literal( 'self-hosted-ssh' ),
	syncMode: z.literal( 'ssh-wp-cli' ),
	auth: selfHostedSshAuthSchema,
} );

export const selfHostedConnectorConnectionSchema = syncConnectionBaseSchema.extend( {
	provider: z.literal( 'self-hosted-connector' ),
	syncMode: z.literal( 'connector-plugin' ),
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
