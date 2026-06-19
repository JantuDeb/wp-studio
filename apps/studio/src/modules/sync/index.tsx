import { CheckboxControl, Notice, Spinner } from '@wordpress/components';
import { sprintf } from '@wordpress/i18n';
import { check, Icon } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { format } from 'date-fns';
import { PropsWithChildren, useEffect, useState } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { IllustrationGrid } from 'src/components/illustration-grid';
import Modal from 'src/components/modal';
import offlineIcon from 'src/components/offline-icon';
import ProgressBar from 'src/components/progress-bar';
import TextControl from 'src/components/text-control';
import { Tooltip } from 'src/components/tooltip';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { ConnectButton } from 'src/modules/sync/components/connect-button';
import { SelfHostedConnectionWizard } from 'src/modules/sync/components/self-hosted-connection-wizard';
import { SelfHostedSshSyncDialog } from 'src/modules/sync/components/self-hosted-ssh-sync-dialog';
import { SyncConnectedSites } from 'src/modules/sync/components/sync-connected-sites';
import { SyncDialog } from 'src/modules/sync/components/sync-dialog';
import { SyncSitesModalSelector } from 'src/modules/sync/components/sync-sites-modal-selector';
import { SyncTabImage } from 'src/modules/sync/components/sync-tab-image';
import {
	convertTreeToPullOptions,
	convertTreeToPushOptions,
} from 'src/modules/sync/lib/convert-tree-to-sync-options';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { syncOperationsThunks } from 'src/stores/sync';
import {
	connectedSitesActions,
	connectedSitesSelectors,
	useConnectSiteMutation,
	useDisconnectSiteMutation,
	useGetConnectedSitesForLocalSiteQuery,
} from 'src/stores/sync/connected-sites';
import { useGetWpComSitesQuery } from 'src/stores/sync/wpcom-sites';
import type {
	SelfHostedSshPullOptions,
	SelfHostedSshPushOptions,
	SelfHostedSshBackup,
	SelfHostedSshProgress,
	SelfHostedSshManagementStatus,
	SelfHostedSshMaintenanceAction,
	SelfHostedSshDebugLog,
	SelfHostedSshIncrementalPreview,
	SelfHostedSshAdvisory,
	SelfHostedServerStack,
	SelfHostedPhpVersions,
	SelfHostedHtaccess,
	SelfHostedSslStatus,
	SelfHostedProvisionRequest,
	SelfHostedConfigBackup,
	SyncConnection,
	SyncDeploymentRecord,
	SyncSite,
} from '@studio/common/types/sync';

type SelfHostedSyncConnection = Extract< SyncConnection, { siteUrl: string } >;
type SelfHostedSshConnection = Extract< SyncConnection, { provider: 'self-hosted-ssh' } >;
type ContentSelectionItem = Awaited<
	ReturnType< IpcApi[ 'listSelfHostedRestContent' ] >
>[ number ];
type ContentPushPreview = Awaited< ReturnType< IpcApi[ 'previewSelfHostedRestContentPush' ] > >;
type SelectedContentItem = { id: number; type: 'post' | 'page' };

function SiteSyncDescription( { children }: PropsWithChildren ) {
	const { __ } = useI18n();
	return (
		<div className="p-8 flex justify-between max-w-3xl gap-4 overflow-hidden">
			<div className="flex flex-col">
				<div className="flex items-center mb-1">
					<div className="a8c-subtitle text-pretty">
						{ __( 'Sync with WordPress.com or Pressable' ) }
					</div>
				</div>
				<div className="max-w-[40ch] text-frame-text-secondary a8c-body">
					{ __(
						'Launch your existing WordPress.com or Jetpack-activated Pressable sites, or import an existing one. Then, share your work with the world.'
					) }
				</div>
				<div className="mt-6">
					{ [
						__( 'Push and pull changes from your live site.' ),
						__( 'Supports staging and production sites.' ),
						__( 'Sync database and file changes.' ),
					].map( ( text ) => (
						<div key={ text } className="text-frame-text-secondary a8c-body flex items-center">
							<Icon className="fill-frame-theme me-2 shrink-0" icon={ check } />
							{ text }
						</div>
					) ) }
				</div>
				{ children }
			</div>
			<IllustrationGrid>
				<SyncTabImage />
			</IllustrationGrid>
		</div>
	);
}

function NoAuthSyncTab( { onConnectSite }: { onConnectSite: () => void } ) {
	const isOffline = useOffline();
	const { __ } = useI18n();
	const { authenticate } = useAuth();
	const offlineMessage = __( "You're currently offline." );

	return (
		<SiteSyncDescription>
			<div className="mt-8 flex flex-wrap gap-3">
				<Tooltip disabled={ ! isOffline } icon={ offlineIcon } text={ offlineMessage }>
					<Button
						aria-description={ isOffline ? offlineMessage : '' }
						aria-disabled={ isOffline }
						variant="primary"
						onClick={ () => {
							if ( isOffline ) {
								return;
							}
							authenticate();
						} }
					>
						{ __( 'Log in to WordPress.com' ) }
						<ArrowIcon />
					</Button>
				</Tooltip>
				<Tooltip disabled={ ! isOffline } icon={ offlineIcon } text={ offlineMessage }>
					<Button
						aria-description={ isOffline ? offlineMessage : '' }
						aria-disabled={ isOffline }
						variant="secondary"
						onClick={ () => {
							if ( isOffline ) {
								return;
							}
							onConnectSite();
						} }
					>
						{ __( 'Connect self-hosted site' ) }
					</Button>
				</Tooltip>
			</div>
			<div className="mt-3 text-frame-text-secondary a8c-body">
				<Tooltip
					disabled={ ! isOffline }
					icon={ offlineIcon }
					text={ offlineMessage }
					placement="bottom-start"
				>
					<span>
						{ __( 'New to WordPress.com?' ) }{ ' ' }
						<Button
							aria-description={ isOffline ? offlineMessage : '' }
							aria-disabled={ isOffline }
							className="!p-0 text-frame-theme hover:opacity-80 h-auto inline-flex items-center"
							onClick={ () => {
								if ( isOffline ) {
									return;
								}
								getIpcApi().authenticate( true );
							} }
						>
							{ __( 'Create a free account' ) }
							<ArrowIcon />
						</Button>
					</span>
				</Tooltip>
			</div>
		</SiteSyncDescription>
	);
}

function getSelfHostedConnectionLabel( connection: SyncConnection ): string {
	switch ( connection.provider ) {
		case 'self-hosted-rest':
			return 'REST API content sync';
		case 'self-hosted-ssh':
			return 'SSH + WP-CLI full sync';
		case 'self-hosted-connector':
			return 'Connector plugin full sync';
		case 'wpcom':
		default:
			return 'WordPress.com / Pressable';
	}
}

function SelfHostedConnectionsList( {
	connections,
	onDisconnect,
	onEdit,
	onChooseContent,
	onPullSshSite,
	onPushSshSite,
	onManageSshBackups,
	onManageSshSite,
	onProvisionSite,
	onViewDeployments,
	onPullConnectorSite,
	onPushConnectorSite,
	pushingConnectionId,
	preflightingConnectionId,
	pullingConnectionId,
	sshProgress,
}: {
	connections: SyncConnection[];
	onDisconnect: ( connectionId: string ) => void;
	onEdit: ( connection: SelfHostedSyncConnection ) => void;
	onChooseContent: ( connectionId: string ) => void;
	onPullSshSite: ( connection: SelfHostedSyncConnection ) => void;
	onPushSshSite: ( connection: SelfHostedSyncConnection ) => void;
	onManageSshBackups: ( connection: SelfHostedSyncConnection ) => void;
	onManageSshSite: ( connection: SelfHostedSyncConnection ) => void;
	onProvisionSite: ( connection: SelfHostedSyncConnection ) => void;
	onViewDeployments: ( connection: SelfHostedSyncConnection ) => void;
	onPullConnectorSite: ( connection: SelfHostedSyncConnection ) => void;
	onPushConnectorSite: ( connection: SelfHostedSyncConnection ) => void;
	pushingConnectionId: string | null;
	preflightingConnectionId: string | null;
	pullingConnectionId: string | null;
	sshProgress: Record< string, SelfHostedSshProgress >;
} ) {
	const { __ } = useI18n();
	const selfHostedConnections = connections.filter(
		( connection ): connection is SelfHostedSyncConnection => 'siteUrl' in connection
	);

	if ( selfHostedConnections.length === 0 ) {
		return null;
	}

	return (
		<div className="px-8 py-6 border-b border-frame-border">
			<h3 className="text-sm font-medium text-frame-text mb-3">
				{ __( 'Self-hosted connections' ) }
			</h3>
			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				{ selfHostedConnections.map( ( connection ) => (
					<div
						key={ connection.id }
						className="rounded-md border border-frame-border bg-frame-surface p-4"
					>
						<div className="flex items-start justify-between gap-4">
							<div className="min-w-0">
								<div className="text-sm font-medium text-frame-text truncate">
									{ connection.siteUrl.replace( /^https?:\/\//, '' ) }
								</div>
								<div className="text-xs text-frame-text-secondary mt-1">
									{ getSelfHostedConnectionLabel( connection ) }
								</div>
								<div className="text-xs text-frame-text-secondary mt-1 capitalize">
									{ connection.environmentType }
								</div>
							</div>
							<Button variant="link" onClick={ () => onDisconnect( String( connection.id ) ) }>
								{ __( 'Disconnect' ) }
							</Button>
						</div>
						<div className="mt-4 flex flex-wrap justify-end gap-3">
							<Button variant="secondary" onClick={ () => onEdit( connection ) }>
								{ __( 'Edit credentials' ) }
							</Button>
							<Button
								variant="secondary"
								disabled={
									connection.provider !== 'self-hosted-rest' ||
									pushingConnectionId === connection.id
								}
								onClick={ () => onChooseContent( connection.id ) }
							>
								{ pushingConnectionId === connection.id
									? __( 'Pushing…' )
									: __( 'Choose content' ) }
							</Button>
							<Button
								variant="secondary"
								disabled={
									connection.provider !== 'self-hosted-ssh' || pullingConnectionId === connection.id
								}
								onClick={ () => onPullSshSite( connection ) }
							>
								{ pullingConnectionId === connection.id ? __( 'Pulling…' ) : __( 'Pull to local' ) }
							</Button>
							{ connection.provider === 'self-hosted-connector' && (
								<>
									<Button
										variant="secondary"
										disabled={ pullingConnectionId === connection.id }
										onClick={ () => onPullConnectorSite( connection ) }
									>
										{ pullingConnectionId === connection.id
											? __( 'Pulling…' )
											: __( 'Pull to local' ) }
									</Button>
									<Button
										variant="secondary"
										disabled={
											connection.environmentType === 'production' ||
											pushingConnectionId === connection.id
										}
										onClick={ () => onPushConnectorSite( connection ) }
									>
										{ pushingConnectionId === connection.id
											? __( 'Pushing…' )
											: __( 'Push to remote' ) }
									</Button>
								</>
							) }
							<Button
								variant="secondary"
								disabled={
									connection.provider !== 'self-hosted-ssh' ||
									connection.environmentType === 'production' ||
									pushingConnectionId === connection.id ||
									preflightingConnectionId === connection.id
								}
								onClick={ () => onPushSshSite( connection ) }
							>
								{ preflightingConnectionId === connection.id
									? __( 'Preparing…' )
									: pushingConnectionId === connection.id
									? __( 'Pushing…' )
									: __( 'Push to remote' ) }
							</Button>
							<Button
								variant="secondary"
								disabled={ connection.provider !== 'self-hosted-ssh' }
								onClick={ () => onManageSshBackups( connection ) }
							>
								{ __( 'Backups' ) }
							</Button>
							<Button
								variant="secondary"
								disabled={ connection.provider !== 'self-hosted-ssh' }
								onClick={ () => onManageSshSite( connection ) }
							>
								{ __( 'Manage' ) }
							</Button>
							<Button
								variant="secondary"
								disabled={
									connection.provider !== 'self-hosted-ssh' ||
									connection.environmentType === 'production'
								}
								onClick={ () => onProvisionSite( connection ) }
							>
								{ __( 'Provision site' ) }
							</Button>
							<Button variant="secondary" onClick={ () => onViewDeployments( connection ) }>
								{ __( 'History' ) }
							</Button>
						</div>
						{ connection.provider === 'self-hosted-ssh' &&
							sshProgress[ connection.id ] &&
							sshProgress[ connection.id ].phase !== 'finished' && (
								<div className="mt-4">
									<div className="text-xs text-frame-text-secondary mb-2">
										{ sshProgress[ connection.id ].message }
									</div>
									<ProgressBar value={ sshProgress[ connection.id ].progress } maxValue={ 100 } />
								</div>
							) }
					</div>
				) ) }
			</div>
		</div>
	);
}

function SelfHostedDeploymentsModal( {
	connection,
	deployments,
	isLoading,
	onRequestClose,
}: {
	connection: SelfHostedSyncConnection;
	deployments: SyncDeploymentRecord[] | null;
	isLoading: boolean;
	onRequestClose: () => void;
} ) {
	const { __ } = useI18n();

	const statusLabel = ( status: SyncDeploymentRecord[ 'status' ] ): string => {
		switch ( status ) {
			case 'success':
				return __( 'Success' );
			case 'verified-with-warnings':
				return __( 'Completed with warnings' );
			case 'failed':
				return __( 'Failed' );
		}
	};

	const statusClass = ( status: SyncDeploymentRecord[ 'status' ] ): string => {
		if ( status === 'failed' ) {
			return 'text-frame-error';
		}
		if ( status === 'verified-with-warnings' ) {
			return 'text-amber-500';
		}
		return 'text-frame-text-secondary';
	};

	return (
		<Modal
			className="w-[90%] max-w-[760px] max-h-[86vh] [&>div]:!p-0"
			onRequestClose={ onRequestClose }
			title={ __( 'Deployment history' ) }
		>
			<div className="px-8 pb-6">
				<div className="text-frame-text-secondary text-sm mb-4">{ connection.siteUrl }</div>
				{ isLoading || ! deployments ? (
					<div className="flex items-center gap-2 py-8 text-frame-text-secondary">
						<Spinner className="!m-0 [&>circle]:stroke-frame-text-secondary" />
						{ __( 'Loading deployment history…' ) }
					</div>
				) : deployments.length === 0 ? (
					<div className="py-8 text-frame-text-secondary">
						{ __( 'No deployments have been recorded for this connection yet.' ) }
					</div>
				) : (
					<ul className="flex flex-col gap-3 m-0">
						{ deployments.map( ( record ) => (
							<li
								key={ record.id }
								className="border border-frame-border rounded-sm p-3 flex flex-col gap-1"
							>
								<div className="flex items-center justify-between gap-3">
									<span className="text-sm font-medium text-frame-text">{ record.operation }</span>
									<span className={ `text-xs font-medium ${ statusClass( record.status ) }` }>
										{ statusLabel( record.status ) }
									</span>
								</div>
								<div className="text-xs text-frame-text-secondary">
									{ format( new Date( record.startedAt ), 'MMM d, y, h:mm a' ) }
								</div>
								<div className="text-sm text-frame-text">{ record.detail }</div>
							</li>
						) ) }
					</ul>
				) }
			</div>
		</Modal>
	);
}

function SelfHostedProvisionModal( {
	connection,
	isProvisioning,
	onProvision,
	onRequestClose,
}: {
	connection: SelfHostedSshConnection;
	isProvisioning: boolean;
	onProvision: ( request: SelfHostedProvisionRequest ) => void;
	onRequestClose: () => void;
} ) {
	const { __ } = useI18n();
	const [ fields, setFields ] = useState< SelfHostedProvisionRequest >( {
		domain: '',
		docroot: '',
		dbName: '',
		dbUser: '',
		dbPassword: '',
		adminDbUser: 'root',
		adminDbPassword: '',
		siteTitle: '',
		wpAdminUser: 'admin',
		wpAdminPassword: '',
		wpAdminEmail: '',
	} );
	const [ confirmation, setConfirmation ] = useState( '' );

	const set = ( key: keyof SelfHostedProvisionRequest ) => ( value: string ) =>
		setFields( ( current ) => ( { ...current, [ key ]: value } ) );

	const requiredFilled =
		fields.domain.trim() &&
		fields.docroot.trim() &&
		fields.dbName.trim() &&
		fields.dbUser.trim() &&
		fields.dbPassword &&
		fields.adminDbUser.trim() &&
		fields.adminDbPassword &&
		fields.siteTitle.trim() &&
		fields.wpAdminUser.trim() &&
		fields.wpAdminPassword &&
		fields.wpAdminEmail.trim();
	const canSubmit =
		Boolean( requiredFilled ) && confirmation.trim() === 'PROVISION' && ! isProvisioning;

	return (
		<Modal
			className="w-[90%] max-w-[680px] max-h-[88vh] [&>div]:!p-0"
			onRequestClose={ onRequestClose }
			title={ __( 'Provision a new WordPress site' ) }
		>
			<div className="px-8 pb-6 flex flex-col gap-4">
				<Notice status="warning" isDismissible={ false }>
					{ sprintf(
						/* translators: %s is the remote server URL. */
						__(
							'This creates a database, virtual host, and a fresh WordPress install on %s. The server must already have a web server, PHP, and a database installed.'
						),
						connection.siteUrl
					) }
				</Notice>

				<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
					<TextControl
						label={ __( 'Domain' ) }
						value={ fields.domain }
						onChange={ set( 'domain' ) }
						placeholder="example.com"
					/>
					<TextControl
						label={ __( 'Document root' ) }
						value={ fields.docroot }
						onChange={ set( 'docroot' ) }
						placeholder="/var/www/example"
					/>
					<TextControl
						label={ __( 'Site title' ) }
						value={ fields.siteTitle }
						onChange={ set( 'siteTitle' ) }
					/>
					<TextControl
						type="email"
						label={ __( 'WordPress admin email' ) }
						value={ fields.wpAdminEmail }
						onChange={ set( 'wpAdminEmail' ) }
					/>
					<TextControl
						label={ __( 'Database name' ) }
						value={ fields.dbName }
						onChange={ set( 'dbName' ) }
					/>
					<TextControl
						label={ __( 'Database user' ) }
						value={ fields.dbUser }
						onChange={ set( 'dbUser' ) }
					/>
					<TextControl
						type="password"
						label={ __( 'Database password' ) }
						value={ fields.dbPassword }
						onChange={ set( 'dbPassword' ) }
					/>
					<TextControl
						label={ __( 'DB admin user' ) }
						value={ fields.adminDbUser }
						onChange={ set( 'adminDbUser' ) }
					/>
					<TextControl
						type="password"
						label={ __( 'DB admin password' ) }
						value={ fields.adminDbPassword }
						onChange={ set( 'adminDbPassword' ) }
					/>
					<TextControl
						label={ __( 'WordPress admin user' ) }
						value={ fields.wpAdminUser }
						onChange={ set( 'wpAdminUser' ) }
					/>
					<TextControl
						type="password"
						label={ __( 'WordPress admin password' ) }
						value={ fields.wpAdminPassword }
						onChange={ set( 'wpAdminPassword' ) }
					/>
				</div>

				<TextControl
					label={ __( 'Type PROVISION to confirm' ) }
					value={ confirmation }
					onChange={ setConfirmation }
				/>

				<div className="flex gap-4 justify-end">
					<Button variant="link" onClick={ onRequestClose } disabled={ isProvisioning }>
						{ __( 'Cancel' ) }
					</Button>
					<Button
						variant="primary"
						disabled={ ! canSubmit }
						onClick={ () => onProvision( fields ) }
					>
						{ isProvisioning ? __( 'Provisioning…' ) : __( 'Provision site' ) }
					</Button>
				</div>
			</div>
		</Modal>
	);
}

function SelfHostedServerPanel( {
	connection,
	serverStack,
	phpVersions,
	htaccess,
	sslStatus,
	configBackups,
	isLoading,
	isSavingHtaccess,
	isProvisioningSsl,
	isRestoringConfig,
	onSaveHtaccess,
	onReloadWebServer,
	onProvisionSsl,
	onRenewSsl,
	onRestoreConfigBackup,
}: {
	connection: SelfHostedSshConnection;
	serverStack: SelfHostedServerStack | null;
	phpVersions: SelfHostedPhpVersions | null;
	htaccess: SelfHostedHtaccess | null;
	sslStatus: SelfHostedSslStatus | null;
	configBackups: SelfHostedConfigBackup[];
	isLoading: boolean;
	isSavingHtaccess: boolean;
	isProvisioningSsl: boolean;
	isRestoringConfig: boolean;
	onSaveHtaccess: ( content: string ) => void;
	onReloadWebServer: () => void;
	onProvisionSsl: ( email: string ) => void;
	onRenewSsl: () => void;
	onRestoreConfigBackup: ( backupPath: string ) => void;
} ) {
	const { __ } = useI18n();
	const isProduction = connection.environmentType === 'production';
	const [ htaccessDraft, setHtaccessDraft ] = useState( '' );
	const [ sslEmail, setSslEmail ] = useState( '' );

	useEffect( () => {
		setHtaccessDraft( htaccess?.content ?? '' );
	}, [ htaccess ] );

	if ( isLoading ) {
		return (
			<div className="flex items-center gap-2 py-4 text-frame-text-secondary text-sm">
				<Spinner className="!m-0 [&>circle]:stroke-frame-text-secondary" />
				{ __( 'Detecting server configuration…' ) }
			</div>
		);
	}

	if ( ! serverStack ) {
		return null;
	}

	const isApache = serverStack.webServer === 'apache';

	return (
		<div className="flex flex-col gap-3" data-testid="self-hosted-server-panel">
			<div className="text-xs font-medium uppercase text-frame-text-secondary">
				{ __( 'Server' ) }
			</div>
			<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
				{ (
					[
						[ __( 'OS' ), serverStack.os ],
						[
							__( 'Web server' ),
							serverStack.webServer === 'unknown'
								? __( 'Unknown' )
								: `${ serverStack.webServer }${
										serverStack.webServerVersion ? ` ${ serverStack.webServerVersion }` : ''
								  }`,
						],
						[
							__( 'PHP' ),
							phpVersions?.current
								? `${ phpVersions.current }${
										phpVersions.available.length > 1
											? ` (${ phpVersions.available.join( ', ' ) })`
											: ''
								  }`
								: serverStack.phpVersion ?? __( 'Unknown' ),
						],
						[
							__( 'Database' ),
							serverStack.dbEngine
								? `${ serverStack.dbEngine }${
										serverStack.dbVersion ? ` ${ serverStack.dbVersion }` : ''
								  }`
								: __( 'Unknown' ),
						],
					] as const
				 ).map( ( [ label, value ] ) => (
					<div key={ label } className="border border-frame-border rounded-sm p-3">
						<div className="text-xs text-frame-text-secondary">{ label }</div>
						<div className="text-sm font-medium text-frame-text mt-1">{ value }</div>
					</div>
				) ) }
			</div>

			<div className="flex flex-wrap gap-3">
				<Button variant="secondary" disabled={ isProduction } onClick={ onReloadWebServer }>
					{ __( 'Validate & reload web server' ) }
				</Button>
			</div>

			{ isApache ? (
				<div className="flex flex-col gap-2">
					<div className="text-xs font-medium text-frame-text">
						{ htaccess?.exists ? __( 'Edit .htaccess' ) : __( 'Create .htaccess' ) }
					</div>
					<textarea
						className="w-full h-48 font-mono text-xs p-3 rounded-sm border border-frame-border bg-frame-surface text-frame-text"
						value={ htaccessDraft }
						disabled={ isProduction || isSavingHtaccess }
						onChange={ ( event ) => setHtaccessDraft( event.target.value ) }
						spellCheck={ false }
					/>
					{ isProduction ? (
						<Notice status="info" isDismissible={ false }>
							{ __( 'Editing .htaccess is disabled for production connections.' ) }
						</Notice>
					) : (
						<div className="flex justify-end">
							<Button
								variant="secondary"
								disabled={ isSavingHtaccess || htaccessDraft === ( htaccess?.content ?? '' ) }
								onClick={ () => onSaveHtaccess( htaccessDraft ) }
							>
								{ isSavingHtaccess ? __( 'Saving…' ) : __( 'Save .htaccess' ) }
							</Button>
						</div>
					) }
				</div>
			) : (
				<Notice status="info" isDismissible={ false }>
					{ __( 'This server runs nginx, which does not use .htaccess files.' ) }
				</Notice>
			) }

			<div className="flex flex-col gap-2 border-t border-frame-border pt-3">
				<div className="text-xs font-medium uppercase text-frame-text-secondary">
					{ __( 'SSL / TLS' ) }
				</div>
				{ ! sslStatus ? (
					<div className="text-sm text-frame-text-secondary">
						{ __( 'Certificate status unavailable.' ) }
					</div>
				) : sslStatus.hasCertificate ? (
					<div className="text-sm text-frame-text">
						{ sslStatus.isExpired
							? __( 'Certificate has expired.' )
							: sslStatus.daysUntilExpiry !== null
							? sprintf(
									/* translators: %1$s issuer, %2$d days until expiry. */
									__( 'Issued by %1$s · expires in %2$d days.' ),
									sslStatus.issuer ?? __( 'unknown' ),
									sslStatus.daysUntilExpiry
							  )
							: __( 'Certificate present.' ) }
						{ sslStatus.domains.length > 0 && (
							<div className="text-xs text-frame-text-secondary mt-1">
								{ sslStatus.domains.join( ', ' ) }
							</div>
						) }
					</div>
				) : (
					<div className="text-sm text-frame-text-secondary">
						{ __( 'No HTTPS certificate detected.' ) }
					</div>
				) }

				{ isProduction ? (
					<Notice status="info" isDismissible={ false }>
						{ __( 'SSL changes are disabled for production connections.' ) }
					</Notice>
				) : ! sslStatus?.certbotAvailable ? (
					<Notice status="info" isDismissible={ false }>
						{ __( 'Install certbot on the remote server to issue or renew certificates.' ) }
					</Notice>
				) : (
					<div className="flex flex-col gap-2">
						<TextControl
							type="email"
							label={ __( 'Contact email (for Let’s Encrypt)' ) }
							value={ sslEmail }
							onChange={ setSslEmail }
							disabled={ isProvisioningSsl }
						/>
						<div className="flex gap-3 justify-end">
							{ sslStatus?.hasCertificate && (
								<Button variant="secondary" disabled={ isProvisioningSsl } onClick={ onRenewSsl }>
									{ isProvisioningSsl ? __( 'Working…' ) : __( 'Renew certificate' ) }
								</Button>
							) }
							<Button
								variant="primary"
								disabled={ isProvisioningSsl || ! sslEmail.trim() }
								onClick={ () => onProvisionSsl( sslEmail.trim() ) }
							>
								{ isProvisioningSsl
									? __( 'Working…' )
									: sslStatus?.hasCertificate
									? __( 'Reissue & enable HTTPS' )
									: __( 'Enable HTTPS' ) }
							</Button>
						</div>
					</div>
				) }
			</div>

			{ configBackups.length > 0 && (
				<div className="flex flex-col gap-2 border-t border-frame-border pt-3">
					<div className="text-xs font-medium uppercase text-frame-text-secondary">
						{ __( 'Config backups' ) }
					</div>
					<div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
						{ configBackups.map( ( backup ) => (
							<div
								key={ backup.backupPath }
								className="flex items-center justify-between gap-3 text-sm"
							>
								<div className="min-w-0">
									<div className="truncate text-frame-text">{ backup.target }</div>
									<div className="text-xs text-frame-text-secondary">
										{ format( new Date( backup.timestamp ), 'MMM d, y, h:mm a' ) }
									</div>
								</div>
								<Button
									variant="link"
									disabled={ isProduction || isRestoringConfig }
									onClick={ () => onRestoreConfigBackup( backup.backupPath ) }
								>
									{ __( 'Restore' ) }
								</Button>
							</div>
						) ) }
					</div>
					{ isProduction && (
						<Notice status="info" isDismissible={ false }>
							{ __( 'Restoring server config is disabled for production connections.' ) }
						</Notice>
					) }
				</div>
			) }
		</div>
	);
}

function SelfHostedSshAdvisoriesPanel( {
	advisories,
	isLoading,
}: {
	advisories: SelfHostedSshAdvisory[] | null;
	isLoading: boolean;
} ) {
	const { __ } = useI18n();

	if ( isLoading ) {
		return (
			<div className="flex items-center gap-2 text-frame-text-secondary text-sm">
				<Spinner className="!m-0 [&>circle]:stroke-frame-text-secondary" />
				{ __( 'Checking plugins and themes for advisories…' ) }
			</div>
		);
	}

	if ( ! advisories ) {
		return null;
	}

	if ( advisories.length === 0 ) {
		return (
			<div className="flex items-center gap-1 text-sm text-frame-text-secondary">
				<Icon icon={ check } size={ 18 } />
				{ __( 'No plugin or theme advisories found.' ) }
			</div>
		);
	}

	const critical = advisories.filter( ( advisory ) => advisory.severity === 'critical' );
	const others = advisories.filter( ( advisory ) => advisory.severity !== 'critical' );

	return (
		<div className="flex flex-col gap-2" data-testid="self-hosted-advisories">
			<div className="text-xs font-medium uppercase text-frame-text-secondary">
				{ __( 'Security advisories' ) }
			</div>
			{ critical.length > 0 && (
				<Notice status="error" isDismissible={ false }>
					<ul className="m-0 list-disc ps-4">
						{ critical.map( ( advisory ) => (
							<li key={ `${ advisory.type }:${ advisory.slug }` }>{ advisory.detail }</li>
						) ) }
					</ul>
				</Notice>
			) }
			{ others.length > 0 && (
				<Notice status="warning" isDismissible={ false }>
					<ul className="m-0 list-disc ps-4">
						{ others.map( ( advisory ) => (
							<li key={ `${ advisory.type }:${ advisory.slug }` }>{ advisory.detail }</li>
						) ) }
					</ul>
				</Notice>
			) }
		</div>
	);
}

function SelfHostedSshManagementModal( {
	connection,
	status,
	advisories,
	isLoadingAdvisories,
	serverStack,
	phpVersions,
	htaccess,
	sslStatus,
	configBackups,
	isLoadingServer,
	isSavingHtaccess,
	isProvisioningSsl,
	isRestoringConfig,
	onSaveHtaccess,
	onReloadWebServer,
	onProvisionSsl,
	onRenewSsl,
	onRestoreConfigBackup,
	isLoading,
	runningAction,
	onRunAction,
	onViewDebugLog,
	onDownloadDebugLog,
	onCompareFiles,
	onRefresh,
	onRequestClose,
}: {
	connection: SelfHostedSshConnection;
	status: SelfHostedSshManagementStatus | null;
	advisories: SelfHostedSshAdvisory[] | null;
	isLoadingAdvisories: boolean;
	serverStack: SelfHostedServerStack | null;
	phpVersions: SelfHostedPhpVersions | null;
	htaccess: SelfHostedHtaccess | null;
	sslStatus: SelfHostedSslStatus | null;
	configBackups: SelfHostedConfigBackup[];
	isLoadingServer: boolean;
	isSavingHtaccess: boolean;
	isProvisioningSsl: boolean;
	isRestoringConfig: boolean;
	onSaveHtaccess: ( content: string ) => void;
	onReloadWebServer: () => void;
	onProvisionSsl: ( email: string ) => void;
	onRenewSsl: () => void;
	onRestoreConfigBackup: ( backupPath: string ) => void;
	isLoading: boolean;
	runningAction: string | null;
	onRunAction: ( action: SelfHostedSshMaintenanceAction ) => void;
	onViewDebugLog: () => void;
	onDownloadDebugLog: () => void;
	onCompareFiles: () => void;
	onRefresh: () => void;
	onRequestClose: () => void;
} ) {
	const { __ } = useI18n();
	const pluginUpdates = status?.plugins.filter( ( plugin ) => plugin.updateVersion ) ?? [];
	const themeUpdates = status?.themes.filter( ( theme ) => theme.updateVersion ) ?? [];
	const canUpdate = connection.environmentType !== 'production';
	const [ selectedPlugins, setSelectedPlugins ] = useState< Set< string > >( new Set() );
	const [ selectedThemes, setSelectedThemes ] = useState< Set< string > >( new Set() );
	const selectedUpdateCount = selectedPlugins.size + selectedThemes.size;

	useEffect( () => {
		setSelectedPlugins( new Set() );
		setSelectedThemes( new Set() );
	}, [ connection.id, status ] );

	return (
		<Modal
			className="w-[90%] max-w-[820px] max-h-[86vh] [&>div]:!p-0"
			onRequestClose={ onRequestClose }
			title={ __( 'Manage remote WordPress site' ) }
		>
			<div className="px-8 pb-6">
				{ ! canUpdate && (
					<Notice status="info" isDismissible={ false } className="mb-4">
						{ __(
							'Plugin and theme updates are disabled for production connections. Cache and cron actions remain available.'
						) }
					</Notice>
				) }
				{ isLoading || ! status ? (
					<div className="flex items-center gap-2 py-8 text-frame-text-secondary">
						<Spinner className="!m-0 [&>circle]:stroke-frame-text-secondary" />
						{ __( 'Loading remote site status…' ) }
					</div>
				) : (
					<div className="flex flex-col gap-6">
						<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
							{ [
								[ __( 'WordPress' ), status.coreVersion ],
								[ __( 'PHP' ), status.phpVersion ],
								[ __( 'Due cron events' ), String( status.dueCronEvents ) ],
								[
									__( 'Debug log' ),
									status.debugLogExists
										? formatBackupSize( status.debugLogSizeInBytes )
										: __( 'Not found' ),
								],
								[
									__( 'HTTP status' ),
									status.httpStatus ? String( status.httpStatus ) : __( 'Unavailable' ),
								],
								[
									__( 'Response time' ),
									status.httpResponseTimeMs !== null
										? `${ status.httpResponseTimeMs } ms`
										: __( 'Unavailable' ),
								],
								[ __( 'Site disk usage' ), formatBackupSize( status.wordpressDiskUsageInBytes ) ],
								[ __( 'Free disk space' ), formatBackupSize( status.availableDiskSpaceInBytes ) ],
							].map( ( [ label, value ] ) => (
								<div key={ label } className="border border-frame-border rounded-sm p-3">
									<div className="text-xs text-frame-text-secondary">{ label }</div>
									<div className="text-sm font-medium text-frame-text mt-1">{ value }</div>
								</div>
							) ) }
						</div>
						<SelfHostedSshAdvisoriesPanel
							advisories={ advisories }
							isLoading={ isLoadingAdvisories }
						/>
						<SelfHostedServerPanel
							connection={ connection }
							serverStack={ serverStack }
							phpVersions={ phpVersions }
							htaccess={ htaccess }
							sslStatus={ sslStatus }
							configBackups={ configBackups }
							isLoading={ isLoadingServer }
							isSavingHtaccess={ isSavingHtaccess }
							isProvisioningSsl={ isProvisioningSsl }
							isRestoringConfig={ isRestoringConfig }
							onSaveHtaccess={ onSaveHtaccess }
							onReloadWebServer={ onReloadWebServer }
							onProvisionSsl={ onProvisionSsl }
							onRenewSsl={ onRenewSsl }
							onRestoreConfigBackup={ onRestoreConfigBackup }
						/>
						<div className="flex flex-wrap gap-3">
							<Button
								variant="secondary"
								disabled={ Boolean( runningAction ) }
								onClick={ () => onRunAction( { action: 'flush-cache' } ) }
							>
								{ runningAction === 'flush-cache' ? __( 'Flushing…' ) : __( 'Flush cache' ) }
							</Button>
							<Button
								variant="secondary"
								disabled={ Boolean( runningAction ) || status.dueCronEvents === 0 }
								onClick={ () => onRunAction( { action: 'run-cron' } ) }
							>
								{ runningAction === 'run-cron' ? __( 'Running…' ) : __( 'Run due cron' ) }
							</Button>
							<Button
								variant="secondary"
								disabled={ Boolean( runningAction ) || ! status.debugLogExists }
								onClick={ onViewDebugLog }
							>
								{ status.recentFatalErrorCount > 0
									? sprintf( __( 'View debug log (%d fatal)' ), status.recentFatalErrorCount )
									: __( 'View debug log' ) }
							</Button>
							<Button
								variant="secondary"
								disabled={ Boolean( runningAction ) || ! status.debugLogExists }
								onClick={ onDownloadDebugLog }
							>
								{ __( 'Download log' ) }
							</Button>
							<Button
								variant="secondary"
								disabled={ Boolean( runningAction ) }
								onClick={ onRefresh }
							>
								{ __( 'Refresh' ) }
							</Button>
							<Button
								variant="secondary"
								disabled={ ! canUpdate || Boolean( runningAction ) }
								onClick={ onCompareFiles }
							>
								{ __( 'Compare files' ) }
							</Button>
							<Button
								variant="secondary"
								disabled={ ! canUpdate || Boolean( runningAction ) }
								onClick={ () => onRunAction( { action: 'update-core' } ) }
							>
								{ runningAction === 'update-core'
									? __( 'Updating core…' )
									: __( 'Update WordPress core' ) }
							</Button>
						</div>
						{ selectedUpdateCount > 0 && (
							<div className="flex items-center justify-between gap-4 border border-frame-border rounded-sm p-3">
								<div className="text-sm text-frame-text">
									{ sprintf( __( '%d updates selected' ), selectedUpdateCount ) }
								</div>
								<Button
									variant="primary"
									disabled={ ! canUpdate || Boolean( runningAction ) }
									onClick={ () =>
										onRunAction( {
											action: 'update-extensions',
											plugins: [ ...selectedPlugins ],
											themes: [ ...selectedThemes ],
										} )
									}
								>
									{ runningAction === 'update-extensions'
										? __( 'Updating selected…' )
										: __( 'Back up and update selected' ) }
								</Button>
							</div>
						) }
						<div>
							<h3 className="text-sm font-medium text-frame-text mb-2">
								{ sprintf( __( 'Plugin updates (%d)' ), pluginUpdates.length ) }
							</h3>
							<div className="border border-frame-border rounded-sm">
								{ pluginUpdates.length === 0 ? (
									<div className="p-3 text-sm text-frame-text-secondary">
										{ __( 'All plugins are up to date.' ) }
									</div>
								) : (
									pluginUpdates.map( ( plugin ) => (
										<div
											key={ plugin.name }
											className="flex items-center justify-between gap-3 border-b border-frame-border last:border-b-0 p-3"
										>
											<CheckboxControl
												checked={ selectedPlugins.has( plugin.name ) }
												disabled={ ! canUpdate || Boolean( runningAction ) }
												onChange={ ( checked ) =>
													setSelectedPlugins( ( current ) => {
														const next = new Set( current );
														if ( checked ) {
															next.add( plugin.name );
														} else {
															next.delete( plugin.name );
														}
														return next;
													} )
												}
												__nextHasNoMarginBottom
											/>
											<div className="min-w-0">
												<div className="text-sm text-frame-text truncate">{ plugin.title }</div>
												<div className="text-xs text-frame-text-secondary">
													{ plugin.version } to { plugin.updateVersion }
												</div>
											</div>
											<Button
												variant="secondary"
												disabled={ ! canUpdate || Boolean( runningAction ) }
												onClick={ () =>
													onRunAction( { action: 'update-plugin', name: plugin.name } )
												}
											>
												{ runningAction === `update-plugin:${ plugin.name }`
													? __( 'Updating…' )
													: __( 'Update' ) }
											</Button>
										</div>
									) )
								) }
							</div>
						</div>
						<div>
							<h3 className="text-sm font-medium text-frame-text mb-2">
								{ sprintf( __( 'Theme updates (%d)' ), themeUpdates.length ) }
							</h3>
							<div className="border border-frame-border rounded-sm">
								{ themeUpdates.length === 0 ? (
									<div className="p-3 text-sm text-frame-text-secondary">
										{ __( 'All themes are up to date.' ) }
									</div>
								) : (
									themeUpdates.map( ( theme ) => (
										<div
											key={ theme.name }
											className="flex items-center justify-between gap-3 border-b border-frame-border last:border-b-0 p-3"
										>
											<CheckboxControl
												checked={ selectedThemes.has( theme.name ) }
												disabled={ ! canUpdate || Boolean( runningAction ) }
												onChange={ ( checked ) =>
													setSelectedThemes( ( current ) => {
														const next = new Set( current );
														if ( checked ) {
															next.add( theme.name );
														} else {
															next.delete( theme.name );
														}
														return next;
													} )
												}
												__nextHasNoMarginBottom
											/>
											<div className="min-w-0">
												<div className="text-sm text-frame-text truncate">{ theme.title }</div>
												<div className="text-xs text-frame-text-secondary">
													{ theme.version } to { theme.updateVersion }
												</div>
											</div>
											<Button
												variant="secondary"
												disabled={ ! canUpdate || Boolean( runningAction ) }
												onClick={ () =>
													onRunAction( { action: 'update-theme', name: theme.name } )
												}
											>
												{ runningAction === `update-theme:${ theme.name }`
													? __( 'Updating…' )
													: __( 'Update' ) }
											</Button>
										</div>
									) )
								) }
							</div>
						</div>
					</div>
				) }
				<div className="flex justify-end mt-5">
					<Button variant="link" onClick={ onRequestClose } disabled={ Boolean( runningAction ) }>
						{ __( 'Close' ) }
					</Button>
				</div>
			</div>
		</Modal>
	);
}

function SelfHostedSshIncrementalSyncModal( {
	preview,
	isLoading,
	isApplying,
	onApply,
	onRequestClose,
}: {
	preview: SelfHostedSshIncrementalPreview | null;
	isLoading: boolean;
	isApplying: boolean;
	onApply: () => void;
	onRequestClose: () => void;
} ) {
	const { __ } = useI18n();
	const totalChanges = preview
		? preview.changed.length + preview.localOnly.length + preview.remoteOnly.length
		: 0;

	const renderPaths = ( title: string, paths: string[] ) => (
		<div>
			<h3 className="text-sm font-medium text-frame-text mb-2">
				{ title } ({ paths.length })
			</h3>
			<div className="max-h-36 overflow-y-auto border border-frame-border rounded-sm">
				{ paths.length === 0 ? (
					<div className="p-3 text-sm text-frame-text-secondary">{ __( 'None' ) }</div>
				) : (
					paths.map( ( filePath ) => (
						<div
							key={ filePath }
							className="px-3 py-2 border-b border-frame-border last:border-b-0 font-mono text-xs text-frame-text"
						>
							{ filePath }
						</div>
					) )
				) }
			</div>
		</div>
	);

	return (
		<Modal
			className="w-[90%] max-w-[820px] max-h-[86vh] [&>div]:!p-0"
			onRequestClose={ onRequestClose }
			title={ __( 'Incremental file sync' ) }
		>
			<div className="px-8 pb-6">
				<Notice status="warning" isDismissible={ false } className="mb-4">
					{ __(
						'Applying this comparison uploads changed and local-only files and deletes remote-only files. Studio creates a scoped backup first.'
					) }
				</Notice>
				{ isLoading || ! preview ? (
					<div className="flex items-center gap-2 py-8 text-frame-text-secondary">
						<Spinner className="!m-0 [&>circle]:stroke-frame-text-secondary" />
						{ __( 'Comparing local and remote file hashes…' ) }
					</div>
				) : (
					<div className="flex flex-col gap-5">
						<div className="text-sm text-frame-text-secondary">
							{ sprintf(
								__( '%1$d changes found; %2$d files are unchanged.' ),
								totalChanges,
								preview.unchangedCount
							) }
						</div>
						{ renderPaths( __( 'Changed files' ), preview.changed ) }
						{ renderPaths( __( 'Local-only files to upload' ), preview.localOnly ) }
						{ renderPaths( __( 'Remote-only files to delete' ), preview.remoteOnly ) }
					</div>
				) }
				<div className="flex justify-end gap-4 mt-5">
					<Button variant="link" onClick={ onRequestClose } disabled={ isApplying }>
						{ __( 'Close' ) }
					</Button>
					<Button
						variant="primary"
						disabled={ isLoading || isApplying || totalChanges === 0 }
						onClick={ onApply }
					>
						{ isApplying ? __( 'Applying…' ) : __( 'Back up and apply changes' ) }
					</Button>
				</div>
			</div>
		</Modal>
	);
}

function SelfHostedSshDebugLogModal( {
	log,
	isLoading,
	isClearing,
	onRefresh,
	onClear,
	onDownload,
	onRequestClose,
}: {
	log: SelfHostedSshDebugLog | null;
	isLoading: boolean;
	isClearing: boolean;
	onRefresh: () => void;
	onClear: () => void;
	onDownload: () => void;
	onRequestClose: () => void;
} ) {
	const { __ } = useI18n();
	const lines = log?.content.split( '\n' ) ?? [];

	return (
		<Modal
			className="w-[92%] max-w-[980px] h-full max-h-[86vh] [&>div]:!p-0 [&_[role=document]]:flex [&_[role=document]]:flex-col"
			onRequestClose={ onRequestClose }
			title={ __( 'Remote debug log' ) }
		>
			<div className="flex flex-col min-h-0 flex-1">
				<div className="flex items-center justify-between gap-4 px-8 py-4 border-b border-frame-border">
					<div className="text-sm text-frame-text-secondary">
						{ log
							? sprintf(
									__( '%1$d lines · %2$s · %3$d fatal errors' ),
									log.lines,
									formatBackupSize( log.sizeInBytes ),
									log.fatalErrorCount
							  )
							: __( 'Loading log details…' ) }
					</div>
					<div className="flex gap-3">
						<Button variant="secondary" disabled={ isLoading || isClearing } onClick={ onRefresh }>
							{ __( 'Refresh' ) }
						</Button>
						<Button
							variant="secondary"
							disabled={ isLoading || isClearing || ! log?.content }
							onClick={ onDownload }
						>
							{ __( 'Download' ) }
						</Button>
						<Button
							variant="secondary"
							disabled={ isLoading || isClearing || ! log?.content }
							onClick={ onClear }
						>
							{ isClearing ? __( 'Clearing…' ) : __( 'Clear log' ) }
						</Button>
					</div>
				</div>
				<div className="flex-1 min-h-0 overflow-auto bg-frame-surface p-5 font-mono text-xs leading-5">
					{ isLoading ? (
						<div className="flex items-center gap-2 text-frame-text-secondary">
							<Spinner className="!m-0 [&>circle]:stroke-frame-text-secondary" />
							{ __( 'Loading remote debug log…' ) }
						</div>
					) : lines.length === 0 || ! log?.content ? (
						<div className="text-frame-text-secondary">{ __( 'The debug log is empty.' ) }</div>
					) : (
						lines.map( ( line, index ) => {
							const isFatal = /PHP Fatal error|Uncaught Error|Uncaught Exception/i.test( line );
							return (
								<div
									key={ `${ index }:${ line.slice( 0, 30 ) }` }
									className={ isFatal ? 'text-frame-error' : 'text-frame-text' }
								>
									{ line || ' ' }
								</div>
							);
						} )
					) }
				</div>
				<div className="flex justify-end px-8 py-4 border-t border-frame-border">
					<Button variant="link" onClick={ onRequestClose } disabled={ isClearing }>
						{ __( 'Close' ) }
					</Button>
				</div>
			</div>
		</Modal>
	);
}

function formatBackupSize( bytes: number ): string {
	if ( bytes < 1024 * 1024 ) {
		return `${ Math.max( 1, Math.round( bytes / 1024 ) ) } KB`;
	}
	return `${ ( bytes / ( 1024 * 1024 ) ).toFixed( 1 ) } MB`;
}

function SelfHostedSshBackupsModal( {
	backups,
	isLoading,
	canRestore,
	restoringBackupId,
	deletingBackupId,
	onRestore,
	onDelete,
	onPrune,
	onRequestClose,
}: {
	backups: SelfHostedSshBackup[];
	isLoading: boolean;
	canRestore: boolean;
	restoringBackupId: string | null;
	deletingBackupId: string | null;
	onRestore: ( backup: SelfHostedSshBackup ) => void;
	onDelete: ( backup: SelfHostedSshBackup ) => void;
	onPrune: () => void;
	onRequestClose: () => void;
} ) {
	const { __ } = useI18n();

	return (
		<Modal
			className="w-[90%] max-w-[760px] max-h-[82vh] [&>div]:!p-0"
			onRequestClose={ onRequestClose }
			title={ __( 'Remote backups' ) }
		>
			<div className="px-8 pb-6">
				<Notice status="warning" isDismissible={ false } className="mb-4">
					{ __(
						'Restoring a backup modifies the remote site. Studio creates another safety backup before the restore begins.'
					) }
				</Notice>
				{ ! canRestore && (
					<Notice status="info" isDismissible={ false } className="mb-4">
						{ __( 'Backup restore is disabled for production connections.' ) }
					</Notice>
				) }
				{ isLoading ? (
					<div className="flex items-center gap-2 py-6 text-frame-text-secondary">
						<Spinner className="!m-0 [&>circle]:stroke-frame-text-secondary" />
						{ __( 'Loading backups…' ) }
					</div>
				) : backups.length === 0 ? (
					<div className="py-6 text-sm text-frame-text-secondary">
						{ __( 'No Studio SSH backups were found for this connection.' ) }
					</div>
				) : (
					<>
						{ backups.length > 5 && (
							<div className="flex justify-end mb-3">
								<Button
									variant="secondary"
									disabled={ Boolean( restoringBackupId || deletingBackupId ) }
									onClick={ onPrune }
								>
									{ __( 'Keep latest 5' ) }
								</Button>
							</div>
						) }
						<div className="max-h-[52vh] overflow-y-auto border border-frame-border rounded-sm">
							{ backups.map( ( backup ) => (
								<div
									key={ backup.id }
									className="flex items-center justify-between gap-4 border-b border-frame-border last:border-b-0 p-4"
								>
									<div className="min-w-0">
										<div className="text-sm font-medium text-frame-text">
											{ format( new Date( backup.createdAt ), 'MMM d, y, h:mm a' ) }
										</div>
										<div className="text-xs text-frame-text-secondary mt-1">
											{ backup.includeDatabase ? __( 'Database' ) : __( 'Files only' ) }
											{ backup.selectedPaths.length > 0
												? ` · ${ sprintf(
														__( '%d file selections' ),
														backup.selectedPaths.length
												  ) }`
												: '' }
											{ ` · ${ formatBackupSize( backup.sizeInBytes ) }` }
										</div>
										<div className="text-xs text-frame-text-secondary mt-1 truncate">
											{ backup.id }
										</div>
									</div>
									<div className="flex gap-3">
										<Button
											variant="secondary"
											disabled={ ! canRestore || Boolean( restoringBackupId || deletingBackupId ) }
											onClick={ () => onRestore( backup ) }
										>
											{ restoringBackupId === backup.id ? __( 'Restoring…' ) : __( 'Restore' ) }
										</Button>
										<Button
											variant="link"
											disabled={ Boolean( restoringBackupId || deletingBackupId ) }
											onClick={ () => onDelete( backup ) }
										>
											{ deletingBackupId === backup.id ? __( 'Deleting…' ) : __( 'Delete' ) }
										</Button>
									</div>
								</div>
							) ) }
						</div>
					</>
				) }
				<div className="flex justify-end mt-5">
					<Button
						variant="link"
						onClick={ onRequestClose }
						disabled={ Boolean( restoringBackupId || deletingBackupId ) }
					>
						{ __( 'Close' ) }
					</Button>
				</div>
			</div>
		</Modal>
	);
}

function ContentPushPickerModal( {
	items,
	isLoading,
	isPreviewing,
	isPushing,
	preview,
	onRequestClose,
	onPreview,
	onPush,
	isProduction,
}: {
	items: ContentSelectionItem[];
	isLoading: boolean;
	isPreviewing: boolean;
	isPushing: boolean;
	preview: ContentPushPreview | null;
	onRequestClose: () => void;
	onPreview: ( selectedItems: SelectedContentItem[] ) => void;
	onPush: (
		selectedItems: SelectedContentItem[],
		publish: boolean,
		approval?: string,
		scheduledDate?: string
	) => void;
	isProduction: boolean;
} ) {
	const { __ } = useI18n();
	const [ selectedKeys, setSelectedKeys ] = useState< Set< string > >( new Set() );
	const [ publish, setPublish ] = useState( false );
	const [ schedule, setSchedule ] = useState( false );
	const [ scheduledLocal, setScheduledLocal ] = useState( '' );
	const [ confirmation, setConfirmation ] = useState( '' );

	useEffect( () => {
		setSelectedKeys( new Set( items.map( ( item ) => `${ item.type }:${ item.id }` ) ) );
	}, [ items ] );

	const toggleItem = ( item: ContentSelectionItem ) => {
		const key = `${ item.type }:${ item.id }`;
		setSelectedKeys( ( current ) => {
			const next = new Set( current );
			if ( next.has( key ) ) {
				next.delete( key );
			} else {
				next.add( key );
			}
			return next;
		} );
	};

	const selectedItems = items
		.filter( ( item ) => selectedKeys.has( `${ item.type }:${ item.id }` ) )
		.map( ( item ) => ( { id: item.id, type: item.type } ) );
	const selectedKeyList = selectedItems
		.map( ( item ) => `${ item.type }:${ item.id }` )
		.join( ',' );
	const previewKeyList = preview?.items
		.map( ( item ) => `${ item.type }:${ item.id }` )
		.join( ',' );
	const hasPreviewForSelection = Boolean( preview ) && previewKeyList === selectedKeyList;
	const hasConflicts = hasPreviewForSelection && Boolean( preview?.summary.conflict );
	// A scheduled publish is a future publish, so it goes through the same production approval gate.
	const isPublishingOrScheduling = publish || schedule;
	const parsedScheduledTime = schedule && scheduledLocal ? Date.parse( scheduledLocal ) : NaN;
	const scheduledDateIso = Number.isNaN( parsedScheduledTime )
		? undefined
		: new Date( parsedScheduledTime ).toISOString();
	// Render-time validity only requires a parseable date; the "must be in the future" rule is
	// enforced authoritatively in the main process (calling Date.now() during render is disallowed).
	const isScheduleValid = ! schedule || Boolean( scheduledDateIso );
	const requiresPublishConfirmation = isProduction && isPublishingOrScheduling;
	const hasPublishConfirmation = ! requiresPublishConfirmation || confirmation.trim() === 'PUBLISH';

	const handlePreview = () => {
		onPreview( selectedItems );
	};

	return (
		<Modal
			className="w-[90%] max-w-[860px] h-full max-h-[82vh] [&>div]:!p-0 [&_[role=document]]:flex [&_[role=document]]:flex-col"
			onRequestClose={ onRequestClose }
			title={ __( 'Choose content to push' ) }
		>
			<div className="flex flex-col min-h-0 flex-1">
				<div className="px-8 py-4 border-b border-frame-border">
					<p className="text-sm text-frame-text-secondary">
						{ __(
							'Selected posts and pages will be pushed as drafts with their related categories, tags, featured images, and media URLs.'
						) }
					</p>
				</div>
				<div className="flex-1 min-h-0 overflow-y-auto px-8 py-4">
					{ isLoading ? (
						<div className="flex items-center gap-2 text-sm text-frame-text-secondary">
							<Spinner className="!mt-0 [&>circle]:stroke-frame-text-secondary" />
							{ __( 'Loading content…' ) }
						</div>
					) : items.length === 0 ? (
						<div className="text-sm text-frame-text-secondary">
							{ __( 'No posts or pages were found.' ) }
						</div>
					) : (
						<div className="flex flex-col gap-2">
							{ items.map( ( item ) => {
								const key = `${ item.type }:${ item.id }`;
								return (
									<div
										key={ key }
										className="flex items-start gap-3 rounded-sm border border-frame-border bg-frame-surface p-3"
									>
										<CheckboxControl
											checked={ selectedKeys.has( key ) }
											onChange={ () => toggleItem( item ) }
											__nextHasNoMarginBottom
											aria-label={ item.title }
										/>
										<span className="min-w-0">
											<span className="block text-sm font-medium text-frame-text truncate">
												{ item.title }
											</span>
											<span className="block text-xs text-frame-text-secondary">
												{ item.type === 'post' ? __( 'Post' ) : __( 'Page' ) } · { item.status } · /
												{ item.slug }
											</span>
											{ item.type === 'post' && (
												<span className="block text-xs text-frame-text-secondary">
													{ sprintf(
														__( '%1$d categories, %2$d tags%3$s' ),
														item.categories,
														item.tags,
														item.hasFeaturedImage ? __( ', featured image' ) : ''
													) }
												</span>
											) }
										</span>
									</div>
								);
							} ) }
						</div>
					) }
				</div>
				{ preview && hasPreviewForSelection && (
					<div className="px-8 py-4 border-t border-frame-border">
						<Notice
							status={ hasConflicts ? 'warning' : 'info' }
							isDismissible={ false }
							className="mb-3"
						>
							{ hasConflicts
								? __(
										'Resolve slug conflicts before pushing. Studio will not overwrite unmapped remote content.'
								  )
								: sprintf(
										__( '%1$d will be created and %2$d will be updated.' ),
										preview.summary.create,
										preview.summary.update
								  ) }
						</Notice>
						<div className="max-h-36 overflow-y-auto rounded-sm border border-frame-border">
							{ preview.items.map( ( item ) => (
								<div
									key={ `${ item.type }:${ item.id }` }
									className="flex items-center justify-between gap-3 border-b border-frame-border last:border-b-0 px-3 py-2"
								>
									<div className="min-w-0">
										<div className="text-sm text-frame-text truncate">{ item.title }</div>
										<div className="text-xs text-frame-text-secondary">/{ item.slug }</div>
										{ item.reason && (
											<div className="text-xs text-frame-text-secondary">{ item.reason }</div>
										) }
									</div>
									<span className="text-xs text-frame-text-secondary shrink-0 capitalize">
										{ item.action }
									</span>
								</div>
							) ) }
						</div>
					</div>
				) }
				<div className="px-8 py-4 border-t border-frame-border">
					<CheckboxControl
						label={ __( 'Publish selected content immediately' ) }
						checked={ publish }
						disabled={ schedule }
						onChange={ setPublish }
						__nextHasNoMarginBottom
					/>
					<div className="mt-3">
						<CheckboxControl
							label={ __( 'Schedule publication for a future date' ) }
							checked={ schedule }
							disabled={ publish }
							onChange={ setSchedule }
							__nextHasNoMarginBottom
						/>
						{ schedule && (
							<div className="mt-2">
								<TextControl
									type="datetime-local"
									label={ __( 'Publish date and time' ) }
									value={ scheduledLocal }
									onChange={ setScheduledLocal }
								/>
								<div className="mt-1 text-xs text-frame-text-secondary">
									{ __( 'Must be a future date and time.' ) }
								</div>
							</div>
						) }
					</div>
					{ requiresPublishConfirmation && (
						<div className="mt-3">
							<Notice status="warning" isDismissible={ false } className="mb-3">
								{ schedule
									? __(
											'Scheduling changes production content for a future date. Type PUBLISH to confirm.'
									  )
									: __(
											'Publishing changes production content immediately. Type PUBLISH to confirm.'
									  ) }
							</Notice>
							<TextControl
								label={ __( 'Confirmation' ) }
								value={ confirmation }
								onChange={ setConfirmation }
							/>
						</div>
					) }
				</div>
				<div className="flex items-center justify-between px-8 py-4 border-t border-frame-border">
					<div className="text-sm text-frame-text-secondary">
						{ sprintf( __( '%d selected' ), selectedItems.length ) }
					</div>
					<div className="flex gap-4">
						<Button variant="link" onClick={ onRequestClose }>
							{ __( 'Cancel' ) }
						</Button>
						<Button
							variant="primary"
							disabled={
								isPreviewing ||
								isPushing ||
								selectedItems.length === 0 ||
								hasConflicts ||
								! hasPublishConfirmation ||
								! isScheduleValid
							}
							onClick={ () =>
								hasPreviewForSelection
									? onPush(
											selectedItems,
											publish,
											requiresPublishConfirmation ? confirmation.trim() : undefined,
											scheduledDateIso
									  )
									: handlePreview()
							}
						>
							{ isPushing
								? __( 'Pushing…' )
								: isPreviewing
								? __( 'Previewing…' )
								: hasPreviewForSelection
								? schedule
									? __( 'Schedule selected content' )
									: publish
									? __( 'Publish selected content' )
									: __( 'Push selected content as drafts' )
								: __( 'Preview selected content' ) }
						</Button>
					</div>
				</div>
			</div>
		</Modal>
	);
}

export function ContentTabSync( { selectedSite }: { selectedSite: SiteDetails } ) {
	const { __ } = useI18n();
	const dispatch = useAppDispatch();
	const isModalOpen = useRootSelector( connectedSitesSelectors.selectIsModalOpen );
	const reduxModalMode = useRootSelector( connectedSitesSelectors.selectModalMode );
	const selectedRemoteSiteId = useRootSelector(
		connectedSitesSelectors.selectSelectedRemoteSiteId
	);
	const selectedLocalSiteId = useRootSelector( connectedSitesSelectors.selectSelectedLocalSiteId );
	const { isAuthenticated, user, client } = useAuth();
	const { data: connectedSites = [], isLoading: isLoadingConnectedSites } =
		useGetConnectedSitesForLocalSiteQuery( {
			localSiteId: selectedSite.id,
			userId: user?.id,
		} );
	const [ connectSite ] = useConnectSiteMutation();
	const [ disconnectSite ] = useDisconnectSiteMutation();
	const [ syncConnections, setSyncConnections ] = useState< SyncConnection[] >( [] );
	const [ pushingConnectionId, setPushingConnectionId ] = useState< string | null >( null );
	const [ pullingConnectionId, setPullingConnectionId ] = useState< string | null >( null );
	const [ pickingConnectionId, setPickingConnectionId ] = useState< string | null >( null );
	const [ contentSelectionItems, setContentSelectionItems ] = useState< ContentSelectionItem[] >(
		[]
	);
	const [ isLoadingContentSelection, setIsLoadingContentSelection ] = useState( false );
	const [ contentPushPreview, setContentPushPreview ] = useState< ContentPushPreview | null >(
		null
	);
	const [ isPreviewingContentPush, setIsPreviewingContentPush ] = useState( false );
	const [ editingSelfHostedConnection, setEditingSelfHostedConnection ] =
		useState< SelfHostedSyncConnection | null >( null );
	const [ sshSyncConnection, setSshSyncConnection ] = useState< SelfHostedSshConnection | null >(
		null
	);
	const [ sshSyncType, setSshSyncType ] = useState< 'pull' | 'push' >( 'pull' );
	const [ backupConnection, setBackupConnection ] = useState< SelfHostedSshConnection | null >(
		null
	);
	const [ sshBackups, setSshBackups ] = useState< SelfHostedSshBackup[] >( [] );
	const [ isLoadingSshBackups, setIsLoadingSshBackups ] = useState( false );
	const [ restoringBackupId, setRestoringBackupId ] = useState< string | null >( null );
	const [ deletingBackupId, setDeletingBackupId ] = useState< string | null >( null );
	const [ preflightingConnectionId, setPreflightingConnectionId ] = useState< string | null >(
		null
	);
	const [ sshProgress, setSshProgress ] = useState< Record< string, SelfHostedSshProgress > >( {} );
	const [ managementConnection, setManagementConnection ] =
		useState< SelfHostedSshConnection | null >( null );
	const [ managementStatus, setManagementStatus ] =
		useState< SelfHostedSshManagementStatus | null >( null );
	const [ isLoadingManagementStatus, setIsLoadingManagementStatus ] = useState( false );
	const [ advisories, setAdvisories ] = useState< SelfHostedSshAdvisory[] | null >( null );
	const [ isLoadingAdvisories, setIsLoadingAdvisories ] = useState( false );
	const [ serverStack, setServerStack ] = useState< SelfHostedServerStack | null >( null );
	const [ phpVersions, setPhpVersions ] = useState< SelfHostedPhpVersions | null >( null );
	const [ htaccess, setHtaccess ] = useState< SelfHostedHtaccess | null >( null );
	const [ sslStatus, setSslStatus ] = useState< SelfHostedSslStatus | null >( null );
	const [ isLoadingServer, setIsLoadingServer ] = useState( false );
	const [ isSavingHtaccess, setIsSavingHtaccess ] = useState( false );
	const [ isProvisioningSsl, setIsProvisioningSsl ] = useState( false );
	const [ configBackups, setConfigBackups ] = useState< SelfHostedConfigBackup[] >( [] );
	const [ isRestoringConfig, setIsRestoringConfig ] = useState( false );
	const [ provisionConnection, setProvisionConnection ] =
		useState< SelfHostedSshConnection | null >( null );
	const [ isProvisioningSite, setIsProvisioningSite ] = useState( false );
	const [ deploymentsConnection, setDeploymentsConnection ] =
		useState< SelfHostedSyncConnection | null >( null );
	const [ deployments, setDeployments ] = useState< SyncDeploymentRecord[] | null >( null );
	const [ isLoadingDeployments, setIsLoadingDeployments ] = useState( false );
	const [ runningMaintenanceAction, setRunningMaintenanceAction ] = useState< string | null >(
		null
	);
	const [ debugLogConnection, setDebugLogConnection ] = useState< SelfHostedSshConnection | null >(
		null
	);
	const [ debugLog, setDebugLog ] = useState< SelfHostedSshDebugLog | null >( null );
	const [ isLoadingDebugLog, setIsLoadingDebugLog ] = useState( false );
	const [ isClearingDebugLog, setIsClearingDebugLog ] = useState( false );
	const [ incrementalConnection, setIncrementalConnection ] =
		useState< SelfHostedSshConnection | null >( null );
	const [ incrementalPreview, setIncrementalPreview ] =
		useState< SelfHostedSshIncrementalPreview | null >( null );
	const [ isLoadingIncrementalPreview, setIsLoadingIncrementalPreview ] = useState( false );
	const [ isApplyingIncrementalSync, setIsApplyingIncrementalSync ] = useState( false );

	const connectedSiteIds = connectedSites.map( ( { id } ) => id );
	// Subscribe to /me/sites so reconcileConnectedSites runs on page load to
	// refresh stored connection metadata. The list itself isn't rendered here —
	// the connect modal has its own subscription with a larger page size.
	const { data: wpcomSitesData } = useGetWpComSitesQuery( {
		connectedSiteIds,
		userId: user?.id,
	} );
	const _syncSites = wpcomSitesData?.sites ?? [];

	const [ selectedRemoteSite, setSelectedRemoteSite ] = useState< SyncSite | null >( null );

	useEffect( () => {
		let isMounted = true;
		void getIpcApi()
			.getSyncConnections( selectedSite.id )
			.then( ( connections ) => {
				if ( isMounted ) {
					setSyncConnections( connections );
				}
			} );
		return () => {
			isMounted = false;
		};
	}, [ selectedSite.id ] );

	useEffect( () => {
		return window.ipcListener.subscribe( 'self-hosted-ssh-progress', ( _event, progress ) => {
			if ( progress.localSiteId !== selectedSite.id ) {
				return;
			}
			setSshProgress( ( current ) => ( {
				...current,
				[ progress.connectionId ]: progress,
			} ) );
		} );
	}, [ selectedSite.id ] );

	// Derived inline from Redux + connectedSites (storage) rather than stored in local state.
	// Local state would reset on remount — SiteContentTabs causes a second TabPanel remount
	// on programmatic tab changes, which would lose the value before the dialog could open.
	// connectedSites is used instead of syncSites because the /me/sites?filter=atomic,wpcom
	// endpoint excludes some site types (e.g. Pressable) that can still be connected.
	const deepLinkRemoteSite =
		selectedRemoteSiteId && selectedLocalSiteId === selectedSite.id
			? connectedSites.find( ( site ) => site.id === selectedRemoteSiteId ) ?? null
			: null;

	const effectiveRemoteSite = deepLinkRemoteSite || selectedRemoteSite;

	const handleConnect = async ( newConnectedSite: SyncSite ) => {
		try {
			await connectSite( { site: newConnectedSite, localSiteId: selectedSite.id } );
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to connect to site' ),
				message: __( 'Please try again.' ),
			} );
		}
	};

	const handleDisconnectSelfHosted = async ( connectionId: string ) => {
		const connections = await getIpcApi().deleteSyncConnection( selectedSite.id, connectionId );
		setSyncConnections( connections );
	};

	const handleChooseSelfHostedRestContent = async ( connectionId: string ) => {
		setPickingConnectionId( connectionId );
		setIsLoadingContentSelection( true );
		setContentPushPreview( null );
		try {
			const items = await getIpcApi().listSelfHostedRestContent( selectedSite.id );
			setContentSelectionItems( items );
		} catch ( error ) {
			setPickingConnectionId( null );
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to load content' ),
				message: error instanceof Error ? error.message : __( 'Please try again.' ),
			} );
		} finally {
			setIsLoadingContentSelection( false );
		}
	};

	const handlePreviewSelfHostedRestContentPush = async (
		connectionId: string,
		selectedItems: SelectedContentItem[]
	) => {
		setIsPreviewingContentPush( true );
		try {
			const preview = await getIpcApi().previewSelfHostedRestContentPush(
				selectedSite.id,
				connectionId,
				{ selectedItems }
			);
			setContentPushPreview( preview );
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to preview content push' ),
				message: error instanceof Error ? error.message : __( 'Please try again.' ),
			} );
		} finally {
			setIsPreviewingContentPush( false );
		}
	};

	const handlePushSelfHostedRestContent = async (
		connectionId: string,
		selectedItems: SelectedContentItem[],
		publish: boolean,
		approval?: string,
		scheduledDate?: string
	) => {
		setPushingConnectionId( connectionId );
		try {
			const summary = await getIpcApi().pushSelfHostedRestContent( selectedSite.id, connectionId, {
				publish,
				selectedItems,
				approval,
				scheduledDate,
			} );
			const notificationTemplate = scheduledDate
				? __(
						'Scheduled %1$d posts, %2$d pages, %3$d media items, %4$d categories, and %5$d tags.'
				  )
				: publish
				? __(
						'Published %1$d posts, %2$d pages, %3$d media items, %4$d categories, and %5$d tags.'
				  )
				: __(
						'Pushed %1$d posts, %2$d pages, %3$d media items, %4$d categories, and %5$d tags as drafts.'
				  );
			getIpcApi().showNotification( {
				title: __( 'Content pushed' ),
				body: sprintf(
					notificationTemplate,
					summary.posts,
					summary.pages,
					summary.media,
					summary.categories,
					summary.tags
				),
			} );
			setPickingConnectionId( null );
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to push content' ),
				message: error instanceof Error ? error.message : __( 'Please try again.' ),
			} );
		} finally {
			setPushingConnectionId( null );
		}
	};

	const handlePullSelfHostedSshSite = async (
		connection: SelfHostedSshConnection,
		options: SelfHostedSshPullOptions
	) => {
		const CANCEL_BUTTON_INDEX = 1;
		const PULL_BUTTON_INDEX = 0;
		const isFullPull = options.optionsToSync.includes( 'all' );
		const includesDatabase = isFullPull || options.optionsToSync.includes( 'sqls' );

		// Best-effort size estimate before the (potentially large) download. A failure to estimate
		// must not block the pull, so fall back to no size line.
		let estimateLine = '';
		try {
			const estimate = await getIpcApi().previewSelfHostedSshPull(
				selectedSite.id,
				connection.id,
				options
			);
			estimateLine = sprintf(
				/* translators: %s is a human-readable size, e.g. "120 MB". */
				__( ' Estimated download: about %s.' ),
				formatBackupSize( estimate.estimatedSourceSizeInBytes )
			);
		} catch {
			estimateLine = '';
		}

		const baseDetail = isFullPull
			? __(
					'This full pull replaces local synced content and the local database with data from the configured WordPress path.'
			  )
			: includesDatabase
			? __(
					'Selected wp-content files will be merged into the local site, and the local database will be replaced.'
			  )
			: __(
					'Selected wp-content files will be merged into the local site. Unselected local files will remain unchanged.'
			  );

		const { response } = await getIpcApi().showMessageBox( {
			message: __( 'Pull selected remote data into Studio?' ),
			detail: baseDetail + estimateLine,
			buttons: [ __( 'Pull to local' ), __( 'Cancel' ) ],
			cancelId: CANCEL_BUTTON_INDEX,
		} );

		if ( response !== PULL_BUTTON_INDEX ) {
			return;
		}

		setPullingConnectionId( connection.id );
		try {
			await getIpcApi().pullSelfHostedSshSite( selectedSite.id, connection.id, options );
			getIpcApi().showNotification( {
				title: __( 'Site pulled' ),
				body: __( 'The selected remote data was imported into this local Studio site.' ),
			} );
			setSshSyncConnection( null );
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to pull site' ),
				message: error instanceof Error ? error.message : __( 'Please try again.' ),
			} );
		} finally {
			setPullingConnectionId( null );
		}
	};

	const handlePushSelfHostedSshSite = async (
		connection: SelfHostedSshConnection,
		options: SelfHostedSshPushOptions
	) => {
		const CANCEL_BUTTON_INDEX = 1;
		const PUSH_BUTTON_INDEX = 0;
		setPreflightingConnectionId( connection.id );
		let preflight;
		try {
			preflight = await getIpcApi().previewSelfHostedSshPush(
				selectedSite.id,
				connection.id,
				options
			);
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to prepare push' ),
				message: error instanceof Error ? error.message : __( 'Please try again.' ),
			} );
			return;
		} finally {
			setPreflightingConnectionId( null );
		}

		if ( ! preflight.hasEnoughDiskSpace ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Not enough remote disk space' ),
				message: sprintf(
					__( 'This push requires approximately %1$s, but the server has %2$s available.' ),
					formatBackupSize( preflight.requiredDiskSpaceInBytes ),
					formatBackupSize( preflight.availableDiskSpaceInBytes )
				),
			} );
			return;
		}

		const selectionDescription = preflight.selectedPaths.includes( '' )
			? __( 'all wp-content files' )
			: sprintf( __( '%d selected wp-content paths' ), preflight.selectedPaths.length );
		const { response } = await getIpcApi().showMessageBox( {
			message: __( 'Push selected local data to the remote site?' ),
			detail: sprintf(
				__(
					'Archive: %1$s. Remote backup estimate: %2$s. Available disk space: %3$s. Selection: %4$s%5$s. Studio will create a backup before restoring.'
				),
				formatBackupSize( preflight.archiveSizeInBytes ),
				formatBackupSize( preflight.estimatedBackupSizeInBytes ),
				formatBackupSize( preflight.availableDiskSpaceInBytes ),
				selectionDescription,
				preflight.includeDatabase ? __( ' and database' ) : ''
			),
			buttons: [ __( 'Back up and push' ), __( 'Cancel' ) ],
			cancelId: CANCEL_BUTTON_INDEX,
		} );

		if ( response !== PUSH_BUTTON_INDEX ) {
			return;
		}

		setPushingConnectionId( connection.id );
		try {
			const { backupPath, verification } = await getIpcApi().pushSelfHostedSshSite(
				selectedSite.id,
				connection.id,
				options
			);
			if ( verification.ok ) {
				getIpcApi().showNotification( {
					title: __( 'Site pushed and verified' ),
					body: sprintf(
						__( 'WordPress %1$s is healthy with %2$d active plugins. Backup: %3$s.' ),
						verification.coreVersion,
						verification.activePluginCount,
						backupPath
					),
				} );
			} else {
				getIpcApi().showErrorMessageBox( {
					title: __( 'Push completed with verification warnings' ),
					message: sprintf(
						__(
							'Database check: %1$s. URL check: %2$s. Remote site URL: %3$s. Backup retained at %4$s.'
						),
						verification.databaseOk ? __( 'passed' ) : __( 'failed' ),
						verification.urlMatchesConnection ? __( 'passed' ) : __( 'failed' ),
						verification.siteUrl,
						backupPath
					),
				} );
			}
			setSshSyncConnection( null );
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to push site' ),
				message: error instanceof Error ? error.message : __( 'Please try again.' ),
			} );
		} finally {
			setPushingConnectionId( null );
		}
	};

	const handlePullSelfHostedConnectorSite = async ( connection: SelfHostedSyncConnection ) => {
		const CANCEL_BUTTON_INDEX = 1;
		const PULL_BUTTON_INDEX = 0;
		const { response } = await getIpcApi().showMessageBox( {
			message: __( 'Pull the connector site into Studio?' ),
			detail: __(
				'The connector will export the remote database and wp-content, then Studio will import them into this local site.'
			),
			buttons: [ __( 'Pull to local' ), __( 'Cancel' ) ],
			cancelId: CANCEL_BUTTON_INDEX,
		} );
		if ( response !== PULL_BUTTON_INDEX ) {
			return;
		}
		setPullingConnectionId( connection.id );
		try {
			await getIpcApi().pullSelfHostedConnectorSite( selectedSite.id, connection.id );
			getIpcApi().showNotification( {
				title: __( 'Connector site pulled' ),
				body: __( 'The remote connector archive was imported into Studio.' ),
			} );
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Connector pull failed' ),
				message: error instanceof Error ? error.message : __( 'Please try again.' ),
			} );
		} finally {
			setPullingConnectionId( null );
		}
	};

	const handlePushSelfHostedConnectorSite = async ( connection: SelfHostedSyncConnection ) => {
		const CANCEL_BUTTON_INDEX = 1;
		const PUSH_BUTTON_INDEX = 0;
		const { response } = await getIpcApi().showMessageBox( {
			message: __( 'Back up and push this Studio site through the connector?' ),
			detail: __(
				'Studio will upload a full archive. The connector must create a remote backup before restoring it. Production connector push is disabled.'
			),
			buttons: [ __( 'Back up and push' ), __( 'Cancel' ) ],
			cancelId: CANCEL_BUTTON_INDEX,
		} );
		if ( response !== PUSH_BUTTON_INDEX ) {
			return;
		}
		setPushingConnectionId( connection.id );
		try {
			const result = await getIpcApi().pushSelfHostedConnectorSite(
				selectedSite.id,
				connection.id
			);
			getIpcApi().showNotification( {
				title: __( 'Connector site pushed' ),
				body: result.backupId
					? sprintf( __( 'Remote backup created: %s.' ), result.backupId )
					: __( 'The remote connector restore completed.' ),
			} );
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Connector push failed' ),
				message: error instanceof Error ? error.message : __( 'Please try again.' ),
			} );
		} finally {
			setPushingConnectionId( null );
		}
	};

	const deleteSelfHostedSshBackups = async (
		connection: SelfHostedSshConnection,
		backups: SelfHostedSshBackup[]
	) => {
		for ( const backup of backups ) {
			setDeletingBackupId( backup.id );
			await getIpcApi().deleteSelfHostedSshBackup( selectedSite.id, connection.id, backup.id );
		}
		setSshBackups( await getIpcApi().listSelfHostedSshBackups( selectedSite.id, connection.id ) );
	};

	const handleDeleteSelfHostedSshBackup = async (
		connection: SelfHostedSshConnection,
		backup: SelfHostedSshBackup
	) => {
		const CANCEL_BUTTON_INDEX = 1;
		const DELETE_BUTTON_INDEX = 0;
		const { response } = await getIpcApi().showMessageBox( {
			message: __( 'Delete this remote backup?' ),
			detail: __( 'The archive and its manifest will be permanently removed from the server.' ),
			buttons: [ __( 'Delete backup' ), __( 'Cancel' ) ],
			cancelId: CANCEL_BUTTON_INDEX,
		} );
		if ( response !== DELETE_BUTTON_INDEX ) {
			return;
		}
		try {
			await deleteSelfHostedSshBackups( connection, [ backup ] );
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to delete backup' ),
				message: error instanceof Error ? error.message : __( 'Please try again.' ),
			} );
		} finally {
			setDeletingBackupId( null );
		}
	};

	const handlePruneSelfHostedSshBackups = async ( connection: SelfHostedSshConnection ) => {
		const backupsToDelete = sshBackups.slice( 5 );
		const CANCEL_BUTTON_INDEX = 1;
		const DELETE_BUTTON_INDEX = 0;
		const { response } = await getIpcApi().showMessageBox( {
			message: sprintf( __( 'Delete %d older backups?' ), backupsToDelete.length ),
			detail: __( 'Studio will keep the five newest backups and permanently remove the rest.' ),
			buttons: [ __( 'Delete older backups' ), __( 'Cancel' ) ],
			cancelId: CANCEL_BUTTON_INDEX,
		} );
		if ( response !== DELETE_BUTTON_INDEX ) {
			return;
		}
		try {
			// Use the authoritative server-side retention policy: keep the five newest push backups.
			// The main process guarantees the newest backup is never deleted and leaves pre-restore
			// safety backups untouched.
			await getIpcApi().applySelfHostedSshBackupRetention( selectedSite.id, connection.id, {
				maxCount: 5,
			} );
			await handleManageSelfHostedSshBackups( connection );
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to delete older backups' ),
				message: error instanceof Error ? error.message : __( 'Please try again.' ),
			} );
		} finally {
			setDeletingBackupId( null );
		}
	};

	const handleManageSelfHostedSshBackups = async ( connection: SelfHostedSshConnection ) => {
		setBackupConnection( connection );
		setIsLoadingSshBackups( true );
		try {
			setSshBackups( await getIpcApi().listSelfHostedSshBackups( selectedSite.id, connection.id ) );
		} catch ( error ) {
			setBackupConnection( null );
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to load backups' ),
				message: error instanceof Error ? error.message : __( 'Please try again.' ),
			} );
		} finally {
			setIsLoadingSshBackups( false );
		}
	};

	const loadSelfHostedSshManagementStatus = async ( connection: SelfHostedSshConnection ) => {
		setIsLoadingManagementStatus( true );
		try {
			setManagementStatus(
				await getIpcApi().getSelfHostedSshManagementStatus( selectedSite.id, connection.id )
			);
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to load remote site status' ),
				message: error instanceof Error ? error.message : __( 'Please try again.' ),
			} );
		} finally {
			setIsLoadingManagementStatus( false );
		}
	};

	const loadSelfHostedSshAdvisories = async ( connection: SelfHostedSshConnection ) => {
		setIsLoadingAdvisories( true );
		try {
			setAdvisories(
				await getIpcApi().getSelfHostedSshAdvisories( selectedSite.id, connection.id )
			);
		} catch {
			// Advisories are best-effort (they depend on the WordPress.org directory). Failing to load
			// them must not block the management dashboard, so show none rather than an error modal.
			setAdvisories( [] );
		} finally {
			setIsLoadingAdvisories( false );
		}
	};

	const loadSelfHostedServerPanel = async ( connection: SelfHostedSshConnection ) => {
		setIsLoadingServer( true );
		// Show cached capabilities instantly (if any) while the fresh probe runs.
		const cached = await getIpcApi()
			.getCachedSelfHostedServerStack( selectedSite.id, connection.id )
			.catch( () => null );
		if ( cached ) {
			setServerStack( cached.stack );
		}
		try {
			const [ stack, php, htaccessResult, ssl ] = await Promise.all( [
				getIpcApi().detectSelfHostedServerStack( selectedSite.id, connection.id ),
				getIpcApi().getSelfHostedPhpVersions( selectedSite.id, connection.id ),
				getIpcApi().getSelfHostedHtaccess( selectedSite.id, connection.id ),
				getIpcApi()
					.getSelfHostedSslStatus( selectedSite.id, connection.id )
					.catch( () => null ),
			] );
			setServerStack( stack );
			setPhpVersions( php );
			setHtaccess( htaccessResult );
			setSslStatus( ssl );
			setConfigBackups(
				await getIpcApi()
					.listSelfHostedConfigBackups( selectedSite.id, connection.id )
					.catch( () => [] )
			);
		} catch {
			// Server-config detection is best-effort and must not block the management dashboard.
			setServerStack( null );
		} finally {
			setIsLoadingServer( false );
		}
	};

	const handleRestoreSelfHostedConfigBackup = async (
		connection: SelfHostedSshConnection,
		backupPath: string
	) => {
		setIsRestoringConfig( true );
		try {
			await getIpcApi().restoreSelfHostedConfigBackup( selectedSite.id, connection.id, backupPath );
			await loadSelfHostedServerPanel( connection );
			getIpcApi().showNotification( {
				title: __( 'Config restored' ),
				body: __( 'The config file was restored, validated, and the web server reloaded.' ),
			} );
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to restore config' ),
				message: error instanceof Error ? error.message : __( 'Please try again.' ),
			} );
		} finally {
			setIsRestoringConfig( false );
		}
	};

	const handleProvisionSelfHostedSsl = async (
		connection: SelfHostedSshConnection,
		email: string
	) => {
		setIsProvisioningSsl( true );
		try {
			const result = await getIpcApi().provisionSelfHostedSsl( selectedSite.id, connection.id, {
				email,
				redirect: true,
			} );
			setSslStatus( result.ssl );
			getIpcApi().showNotification( {
				title: result.covered ? __( 'HTTPS enabled' ) : __( 'Certificate issued with warnings' ),
				body: result.covered
					? __( 'A Let’s Encrypt certificate was installed and HTTPS redirect configured.' )
					: __( 'The certificate was issued but may not cover all requested domains.' ),
			} );
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to enable HTTPS' ),
				message: error instanceof Error ? error.message : __( 'Please try again.' ),
			} );
		} finally {
			setIsProvisioningSsl( false );
		}
	};

	const handleRenewSelfHostedSsl = async ( connection: SelfHostedSshConnection ) => {
		setIsProvisioningSsl( true );
		try {
			setSslStatus( await getIpcApi().renewSelfHostedSsl( selectedSite.id, connection.id ) );
			getIpcApi().showNotification( {
				title: __( 'Certificate renewed' ),
				body: __( 'Near-expiry certificates were renewed and the web server reloaded.' ),
			} );
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to renew certificate' ),
				message: error instanceof Error ? error.message : __( 'Please try again.' ),
			} );
		} finally {
			setIsProvisioningSsl( false );
		}
	};

	const handleSaveSelfHostedHtaccess = async (
		connection: SelfHostedSshConnection,
		content: string
	) => {
		setIsSavingHtaccess( true );
		try {
			await getIpcApi().updateSelfHostedHtaccess( selectedSite.id, connection.id, content );
			setHtaccess( await getIpcApi().getSelfHostedHtaccess( selectedSite.id, connection.id ) );
			getIpcApi().showNotification( {
				title: __( '.htaccess updated' ),
				body: __( 'The remote .htaccess was validated and saved (a backup was kept).' ),
			} );
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to update .htaccess' ),
				message: error instanceof Error ? error.message : __( 'Please try again.' ),
			} );
		} finally {
			setIsSavingHtaccess( false );
		}
	};

	const handleReloadSelfHostedWebServer = async ( connection: SelfHostedSshConnection ) => {
		try {
			const result = await getIpcApi().reloadSelfHostedWebServer( selectedSite.id, connection.id, {
				reloadPhpFpm: true,
			} );
			getIpcApi().showNotification( {
				title: __( 'Web server reloaded' ),
				body: sprintf( __( 'Validated and reloaded %s.' ), result.webServer ),
			} );
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to reload the web server' ),
				message: error instanceof Error ? error.message : __( 'Please try again.' ),
			} );
		}
	};

	const handleProvisionSelfHostedSite = async (
		connection: SelfHostedSshConnection,
		request: SelfHostedProvisionRequest
	) => {
		setIsProvisioningSite( true );
		try {
			const result = await getIpcApi().provisionSelfHostedSite(
				selectedSite.id,
				connection.id,
				request,
				'PROVISION'
			);
			setProvisionConnection( null );
			getIpcApi().showNotification( {
				title: __( 'Site provisioned' ),
				body: sprintf(
					/* translators: %1$s site URL, %2$s WordPress version. */
					__( 'WordPress %2$s is now installed at %1$s.' ),
					result.url,
					result.wpVersion
				),
			} );
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to provision site' ),
				message: error instanceof Error ? error.message : __( 'Please try again.' ),
			} );
		} finally {
			setIsProvisioningSite( false );
		}
	};

	const handleManageSelfHostedSshSite = ( connection: SelfHostedSshConnection ) => {
		setManagementConnection( connection );
		setManagementStatus( null );
		setAdvisories( null );
		setServerStack( null );
		setPhpVersions( null );
		setHtaccess( null );
		setSslStatus( null );
		setConfigBackups( [] );
		void loadSelfHostedSshManagementStatus( connection );
		void loadSelfHostedSshAdvisories( connection );
		void loadSelfHostedServerPanel( connection );
	};

	const handleViewSelfHostedDeployments = async ( connection: SelfHostedSyncConnection ) => {
		setDeploymentsConnection( connection );
		setDeployments( null );
		setIsLoadingDeployments( true );
		try {
			setDeployments( await getIpcApi().getSyncDeployments( selectedSite.id, connection.id ) );
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to load deployment history' ),
				message: error instanceof Error ? error.message : __( 'Please try again.' ),
			} );
			setDeploymentsConnection( null );
		} finally {
			setIsLoadingDeployments( false );
		}
	};

	const getMaintenanceActionKey = ( action: SelfHostedSshMaintenanceAction ): string => {
		if ( action.action === 'update-plugin' || action.action === 'update-theme' ) {
			return `${ action.action }:${ action.name }`;
		}
		return action.action;
	};

	const handleSelfHostedSshMaintenanceAction = async (
		connection: SelfHostedSshConnection,
		action: SelfHostedSshMaintenanceAction
	) => {
		const CANCEL_BUTTON_INDEX = 1;
		const RUN_BUTTON_INDEX = 0;
		const isUpdate = action.action === 'update-plugin' || action.action === 'update-theme';
		const { response } = await getIpcApi().showMessageBox( {
			message: isUpdate
				? __( 'Back up and update this remote component?' )
				: action.action === 'flush-cache'
				? __( 'Flush the remote object cache?' )
				: __( 'Run all due remote cron events?' ),
			detail: isUpdate
				? __(
						'Studio will back up the remote database and selected component before running the update.'
				  )
				: __( 'This maintenance action runs through WP-CLI on the configured WordPress path.' ),
			buttons: [ isUpdate ? __( 'Back up and update' ) : __( 'Run action' ), __( 'Cancel' ) ],
			cancelId: CANCEL_BUTTON_INDEX,
		} );
		if ( response !== RUN_BUTTON_INDEX ) {
			return;
		}

		setRunningMaintenanceAction( getMaintenanceActionKey( action ) );
		try {
			const result = await getIpcApi().runSelfHostedSshMaintenanceAction(
				selectedSite.id,
				connection.id,
				action
			);
			getIpcApi().showNotification( {
				title: __( 'Remote maintenance completed' ),
				body: result.backupPath
					? sprintf( __( '%1$s Backup: %2$s.' ), result.message, result.backupPath )
					: result.message,
			} );
			await loadSelfHostedSshManagementStatus( connection );
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Remote maintenance failed' ),
				message: error instanceof Error ? error.message : __( 'Please try again.' ),
			} );
		} finally {
			setRunningMaintenanceAction( null );
		}
	};

	const loadSelfHostedSshDebugLog = async ( connection: SelfHostedSshConnection ) => {
		setIsLoadingDebugLog( true );
		try {
			setDebugLog( await getIpcApi().getSelfHostedSshDebugLog( selectedSite.id, connection.id ) );
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to load debug log' ),
				message: error instanceof Error ? error.message : __( 'Please try again.' ),
			} );
		} finally {
			setIsLoadingDebugLog( false );
		}
	};

	const handleViewSelfHostedSshDebugLog = ( connection: SelfHostedSshConnection ) => {
		setDebugLogConnection( connection );
		setDebugLog( null );
		void loadSelfHostedSshDebugLog( connection );
	};

	const handleDownloadSelfHostedSshDebugLog = async ( connection: SelfHostedSshConnection ) => {
		try {
			await getIpcApi().downloadSelfHostedSshDebugLog( selectedSite.id, connection.id );
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to download debug log' ),
				message: error instanceof Error ? error.message : __( 'Please try again.' ),
			} );
		}
	};

	const handleClearSelfHostedSshDebugLog = async ( connection: SelfHostedSshConnection ) => {
		const CANCEL_BUTTON_INDEX = 1;
		const CLEAR_BUTTON_INDEX = 0;
		const { response } = await getIpcApi().showMessageBox( {
			message: __( 'Clear the remote debug log?' ),
			detail: __( 'Download the log first if you need to retain it for diagnosis.' ),
			buttons: [ __( 'Clear log' ), __( 'Cancel' ) ],
			cancelId: CANCEL_BUTTON_INDEX,
		} );
		if ( response !== CLEAR_BUTTON_INDEX ) {
			return;
		}
		setIsClearingDebugLog( true );
		try {
			await getIpcApi().runSelfHostedSshMaintenanceAction( selectedSite.id, connection.id, {
				action: 'clear-debug-log',
			} );
			await Promise.all( [
				loadSelfHostedSshDebugLog( connection ),
				loadSelfHostedSshManagementStatus( connection ),
			] );
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to clear debug log' ),
				message: error instanceof Error ? error.message : __( 'Please try again.' ),
			} );
		} finally {
			setIsClearingDebugLog( false );
		}
	};

	const handleCompareSelfHostedSshFiles = async ( connection: SelfHostedSshConnection ) => {
		setIncrementalConnection( connection );
		setIncrementalPreview( null );
		setIsLoadingIncrementalPreview( true );
		try {
			setIncrementalPreview(
				await getIpcApi().previewSelfHostedSshIncrementalSync( selectedSite.id, connection.id )
			);
		} catch ( error ) {
			setIncrementalConnection( null );
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to compare files' ),
				message: error instanceof Error ? error.message : __( 'Please try again.' ),
			} );
		} finally {
			setIsLoadingIncrementalPreview( false );
		}
	};

	const handleApplySelfHostedSshIncrementalSync = async (
		connection: SelfHostedSshConnection,
		preview: SelfHostedSshIncrementalPreview
	) => {
		setIsApplyingIncrementalSync( true );
		try {
			const result = await getIpcApi().applySelfHostedSshIncrementalSync(
				selectedSite.id,
				connection.id,
				preview
			);
			getIpcApi().showNotification( {
				title: __( 'Incremental sync completed' ),
				body: sprintf( __( 'Remote backup retained at %s.' ), result.backupPath ),
			} );
			setIncrementalConnection( null );
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Incremental sync failed' ),
				message: error instanceof Error ? error.message : __( 'Please try again.' ),
			} );
		} finally {
			setIsApplyingIncrementalSync( false );
		}
	};

	const handleRestoreSelfHostedSshBackup = async (
		connection: SelfHostedSshConnection,
		backup: SelfHostedSshBackup
	) => {
		const CANCEL_BUTTON_INDEX = 1;
		const RESTORE_BUTTON_INDEX = 0;
		const { response } = await getIpcApi().showMessageBox( {
			message: __( 'Restore this remote backup?' ),
			detail: __(
				'Studio will create a new safety backup of the current remote data, then restore the selected database and file paths from this archive.'
			),
			buttons: [ __( 'Create safety backup and restore' ), __( 'Cancel' ) ],
			cancelId: CANCEL_BUTTON_INDEX,
		} );
		if ( response !== RESTORE_BUTTON_INDEX ) {
			return;
		}

		setRestoringBackupId( backup.id );
		try {
			const { safetyBackupPath, verification } = await getIpcApi().restoreSelfHostedSshBackup(
				selectedSite.id,
				connection.id,
				backup.id
			);
			if ( verification.ok ) {
				getIpcApi().showNotification( {
					title: __( 'Backup restored and verified' ),
					body: sprintf(
						__( 'WordPress %1$s is healthy. Safety backup: %2$s.' ),
						verification.coreVersion,
						safetyBackupPath
					),
				} );
			} else {
				getIpcApi().showErrorMessageBox( {
					title: __( 'Backup restored with verification warnings' ),
					message: sprintf(
						__( 'Database check: %1$s. URL check: %2$s. Safety backup retained at %3$s.' ),
						verification.databaseOk ? __( 'passed' ) : __( 'failed' ),
						verification.urlMatchesConnection ? __( 'passed' ) : __( 'failed' ),
						safetyBackupPath
					),
				} );
			}
			setSshBackups( await getIpcApi().listSelfHostedSshBackups( selectedSite.id, connection.id ) );
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to restore backup' ),
				message: error instanceof Error ? error.message : __( 'Please try again.' ),
			} );
		} finally {
			setRestoringBackupId( null );
		}
	};

	const handleSiteSelection = async ( selectedSiteFromList: SyncSite ) => {
		if ( reduxModalMode === 'push' || reduxModalMode === 'pull' ) {
			dispatch( connectedSitesActions.openModal( reduxModalMode ) );
			setSelectedRemoteSite( selectedSiteFromList );
		} else {
			await handleConnect( selectedSiteFromList );
			dispatch( connectedSitesActions.closeModal() );
		}
	};

	return (
		<div className="flex flex-col h-full overflow-y-auto">
			{ connectedSites.length > 0 || syncConnections.length > 0 ? (
				<div className="h-full relative">
					<div className="pb-24">
						{ connectedSites.length > 0 && (
							<SyncConnectedSites
								connectedSites={ connectedSites }
								selectedSite={ selectedSite }
								disconnectSite={ ( id ) =>
									disconnectSite( { siteId: id, localSiteId: selectedSite.id } )
								}
							/>
						) }
						<SelfHostedConnectionsList
							connections={ syncConnections }
							onDisconnect={ handleDisconnectSelfHosted }
							onEdit={ setEditingSelfHostedConnection }
							onChooseContent={ handleChooseSelfHostedRestContent }
							onPullSshSite={ ( connection ) => {
								if ( connection.provider === 'self-hosted-ssh' ) {
									setSshSyncType( 'pull' );
									setSshSyncConnection( connection );
								}
							} }
							onPushSshSite={ ( connection ) => {
								if (
									connection.provider === 'self-hosted-ssh' &&
									connection.environmentType !== 'production'
								) {
									setSshSyncType( 'push' );
									setSshSyncConnection( connection );
								}
							} }
							onManageSshBackups={ ( connection ) => {
								if ( connection.provider === 'self-hosted-ssh' ) {
									void handleManageSelfHostedSshBackups( connection );
								}
							} }
							onManageSshSite={ ( connection ) => {
								if ( connection.provider === 'self-hosted-ssh' ) {
									handleManageSelfHostedSshSite( connection );
								}
							} }
							onProvisionSite={ ( connection ) => {
								if ( connection.provider === 'self-hosted-ssh' ) {
									setProvisionConnection( connection );
								}
							} }
							onViewDeployments={ ( connection ) =>
								void handleViewSelfHostedDeployments( connection )
							}
							onPullConnectorSite={ ( connection ) =>
								void handlePullSelfHostedConnectorSite( connection )
							}
							onPushConnectorSite={ ( connection ) =>
								void handlePushSelfHostedConnectorSite( connection )
							}
							pushingConnectionId={ pushingConnectionId }
							preflightingConnectionId={ preflightingConnectionId }
							pullingConnectionId={ pullingConnectionId }
							sshProgress={ sshProgress }
						/>
					</div>
					<div className="sticky bottom-0 bg-frame/[0.8] backdrop-blur-sm w-full px-8 py-6 mt-auto">
						<ConnectButton
							variant="primary"
							connectSite={ () => dispatch( connectedSitesActions.openModal( 'connect' ) ) }
						>
							{ __( 'Connect another site' ) }
						</ConnectButton>
					</div>
				</div>
			) : isLoadingConnectedSites ? null : (
				<>
					{ isAuthenticated ? (
						<SiteSyncDescription>
							<div className="mt-8">
								<ConnectButton
									variant="primary"
									connectSite={ () => dispatch( connectedSitesActions.openModal( 'connect' ) ) }
								>
									{ __( 'Connect site' ) }
								</ConnectButton>
							</div>
						</SiteSyncDescription>
					) : (
						<NoAuthSyncTab
							onConnectSite={ () => dispatch( connectedSitesActions.openModal( 'connect' ) ) }
						/>
					) }
				</>
			) }

			{ isModalOpen && ! effectiveRemoteSite && (
				<SyncSitesModalSelector
					mode={ reduxModalMode || 'connect' }
					onRequestClose={ () => {
						dispatch( connectedSitesActions.closeModal() );
					} }
					onConnect={ async ( site: SyncSite ) => {
						await handleSiteSelection( site );
					} }
					onSelfHostedSaved={ setSyncConnections }
					selectedSite={ selectedSite }
					allowWpcom={ isAuthenticated }
				/>
			) }

			{ effectiveRemoteSite &&
				( deepLinkRemoteSite || ( reduxModalMode && reduxModalMode !== 'connect' ) ) && (
					<SyncDialog
						type={ deepLinkRemoteSite ? 'push' : ( reduxModalMode as 'push' | 'pull' ) }
						localSite={ selectedSite }
						remoteSite={ effectiveRemoteSite }
						onPush={ async ( tree ) => {
							await handleConnect( effectiveRemoteSite );
							const pushOptions = convertTreeToPushOptions( tree );
							void dispatch(
								syncOperationsThunks.pushSite( {
									connectedSite: effectiveRemoteSite,
									selectedSite,
									options: pushOptions,
								} )
							);
						} }
						onPull={ async ( tree ) => {
							if ( ! client ) {
								return;
							}
							await handleConnect( effectiveRemoteSite );
							const pullOptions = convertTreeToPullOptions( tree );
							void dispatch(
								syncOperationsThunks.pullSite( {
									client,
									connectedSite: effectiveRemoteSite,
									selectedSite,
									options: pullOptions,
								} )
							);
						} }
						onRequestClose={ () => {
							if ( deepLinkRemoteSite ) {
								dispatch( connectedSitesActions.clearSelectedRemoteSiteId() );
							} else {
								setSelectedRemoteSite( null );
								dispatch( connectedSitesActions.closeModal() );
							}
						} }
					/>
				) }

			{ pickingConnectionId && (
				<ContentPushPickerModal
					items={ contentSelectionItems }
					isLoading={ isLoadingContentSelection }
					isPreviewing={ isPreviewingContentPush }
					isPushing={ pushingConnectionId === pickingConnectionId }
					preview={ contentPushPreview }
					isProduction={
						syncConnections.find( ( connection ) => connection.id === pickingConnectionId )
							?.environmentType === 'production'
					}
					onRequestClose={ () => {
						if ( pushingConnectionId ) {
							return;
						}
						setPickingConnectionId( null );
					} }
					onPreview={ ( selectedItems ) =>
						handlePreviewSelfHostedRestContentPush( pickingConnectionId, selectedItems )
					}
					onPush={ ( selectedItems, publish, approval, scheduledDate ) =>
						handlePushSelfHostedRestContent(
							pickingConnectionId,
							selectedItems,
							publish,
							approval,
							scheduledDate
						)
					}
				/>
			) }

			{ sshSyncConnection && (
				<SelfHostedSshSyncDialog
					localSite={ selectedSite }
					connection={ sshSyncConnection }
					type={ sshSyncType }
					isSyncing={
						sshSyncType === 'pull'
							? pullingConnectionId === sshSyncConnection.id
							: pushingConnectionId === sshSyncConnection.id ||
							  preflightingConnectionId === sshSyncConnection.id
					}
					onRequestClose={ () => {
						if ( ! pullingConnectionId ) {
							setSshSyncConnection( null );
						}
					} }
					onPull={ ( options ) => handlePullSelfHostedSshSite( sshSyncConnection, options ) }
					onPush={ ( options ) => handlePushSelfHostedSshSite( sshSyncConnection, options ) }
				/>
			) }

			{ backupConnection && (
				<SelfHostedSshBackupsModal
					backups={ sshBackups }
					isLoading={ isLoadingSshBackups }
					canRestore={ backupConnection.environmentType !== 'production' }
					restoringBackupId={ restoringBackupId }
					deletingBackupId={ deletingBackupId }
					onRequestClose={ () => {
						if ( ! restoringBackupId && ! deletingBackupId ) {
							setBackupConnection( null );
						}
					} }
					onRestore={ ( backup ) => handleRestoreSelfHostedSshBackup( backupConnection, backup ) }
					onDelete={ ( backup ) => handleDeleteSelfHostedSshBackup( backupConnection, backup ) }
					onPrune={ () => handlePruneSelfHostedSshBackups( backupConnection ) }
				/>
			) }

			{ managementConnection && (
				<SelfHostedSshManagementModal
					connection={ managementConnection }
					status={ managementStatus }
					advisories={ advisories }
					isLoadingAdvisories={ isLoadingAdvisories }
					serverStack={ serverStack }
					phpVersions={ phpVersions }
					htaccess={ htaccess }
					sslStatus={ sslStatus }
					configBackups={ configBackups }
					isLoadingServer={ isLoadingServer }
					isSavingHtaccess={ isSavingHtaccess }
					isProvisioningSsl={ isProvisioningSsl }
					isRestoringConfig={ isRestoringConfig }
					onSaveHtaccess={ ( content ) =>
						void handleSaveSelfHostedHtaccess( managementConnection, content )
					}
					onReloadWebServer={ () => void handleReloadSelfHostedWebServer( managementConnection ) }
					onProvisionSsl={ ( email ) =>
						void handleProvisionSelfHostedSsl( managementConnection, email )
					}
					onRenewSsl={ () => void handleRenewSelfHostedSsl( managementConnection ) }
					onRestoreConfigBackup={ ( backupPath ) =>
						void handleRestoreSelfHostedConfigBackup( managementConnection, backupPath )
					}
					isLoading={ isLoadingManagementStatus }
					runningAction={ runningMaintenanceAction }
					onRequestClose={ () => {
						if ( ! runningMaintenanceAction ) {
							setManagementConnection( null );
						}
					} }
					onRefresh={ () => void loadSelfHostedSshManagementStatus( managementConnection ) }
					onViewDebugLog={ () => handleViewSelfHostedSshDebugLog( managementConnection ) }
					onDownloadDebugLog={ () =>
						void handleDownloadSelfHostedSshDebugLog( managementConnection )
					}
					onCompareFiles={ () => void handleCompareSelfHostedSshFiles( managementConnection ) }
					onRunAction={ ( action ) =>
						void handleSelfHostedSshMaintenanceAction( managementConnection, action )
					}
				/>
			) }

			{ deploymentsConnection && (
				<SelfHostedDeploymentsModal
					connection={ deploymentsConnection }
					deployments={ deployments }
					isLoading={ isLoadingDeployments }
					onRequestClose={ () => setDeploymentsConnection( null ) }
				/>
			) }

			{ provisionConnection && (
				<SelfHostedProvisionModal
					connection={ provisionConnection }
					isProvisioning={ isProvisioningSite }
					onProvision={ ( request ) =>
						void handleProvisionSelfHostedSite( provisionConnection, request )
					}
					onRequestClose={ () => {
						if ( ! isProvisioningSite ) {
							setProvisionConnection( null );
						}
					} }
				/>
			) }

			{ debugLogConnection && (
				<SelfHostedSshDebugLogModal
					log={ debugLog }
					isLoading={ isLoadingDebugLog }
					isClearing={ isClearingDebugLog }
					onRequestClose={ () => {
						if ( ! isClearingDebugLog ) {
							setDebugLogConnection( null );
						}
					} }
					onRefresh={ () => void loadSelfHostedSshDebugLog( debugLogConnection ) }
					onDownload={ () => void handleDownloadSelfHostedSshDebugLog( debugLogConnection ) }
					onClear={ () => void handleClearSelfHostedSshDebugLog( debugLogConnection ) }
				/>
			) }

			{ incrementalConnection && (
				<SelfHostedSshIncrementalSyncModal
					preview={ incrementalPreview }
					isLoading={ isLoadingIncrementalPreview }
					isApplying={ isApplyingIncrementalSync }
					onRequestClose={ () => {
						if ( ! isApplyingIncrementalSync ) {
							setIncrementalConnection( null );
						}
					} }
					onApply={ () => {
						if ( incrementalPreview ) {
							void handleApplySelfHostedSshIncrementalSync(
								incrementalConnection,
								incrementalPreview
							);
						}
					} }
				/>
			) }

			{ editingSelfHostedConnection && (
				<Modal
					className="sync-sites-modal w-[90%] max-w-[900px] h-full max-h-[90vh] [&>div]:!p-0 [&_[role=document]]:flex [&_[role=document]]:flex-col [&_[role=document]>div:last-child]:flex-1 [&_[role=document]>div:last-child]:min-h-0"
					onRequestClose={ () => setEditingSelfHostedConnection( null ) }
					title={ __( 'Edit self-hosted connection' ) }
				>
					<SelfHostedConnectionWizard
						selectedSite={ selectedSite }
						connection={ editingSelfHostedConnection }
						onBack={ () => setEditingSelfHostedConnection( null ) }
						onRequestClose={ () => setEditingSelfHostedConnection( null ) }
						onSaved={ ( connections ) => {
							setSyncConnections( connections );
							setEditingSelfHostedConnection( null );
						} }
					/>
				</Modal>
			) }
		</div>
	);
}
