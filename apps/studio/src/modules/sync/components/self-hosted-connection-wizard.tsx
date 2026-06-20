import { Notice, SelectControl, TextareaControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useMemo, useState } from 'react';
import Button from 'src/components/button';
import PasswordControl from 'src/components/password-control';
import TextControl from 'src/components/text-control';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type {
	SyncConnection,
	SyncConnectionCapabilities,
	SyncEnvironmentType,
	SyncMode,
} from '@studio/common/types/sync';

type SelfHostedMode = Exclude< SyncMode, 'wpcom' >;
type SelfHostedSyncConnection = Extract< SyncConnection, { siteUrl: string } >;

type ConnectionStatus = {
	type: 'idle' | 'success' | 'error';
	message: string;
};

const SELF_HOSTED_MODES: Array< {
	value: SelfHostedMode;
	label: string;
	description: string;
} > = [
	{
		value: 'rest-content',
		label: 'Content sync via WordPress REST API',
		description: 'Push posts, pages, and media without replacing the remote database.',
	},
	{
		value: 'ssh-wp-cli',
		label: 'Full sync via SSH + WP-CLI',
		description: 'Pull or push files and database through server access.',
	},
	{
		value: 'connector-plugin',
		label: 'Full sync via self-hosted connector plugin',
		description: 'Use a remote plugin for hosts where SSH is unavailable.',
	},
];

const ENVIRONMENT_TYPES: Array< { value: SyncEnvironmentType; label: string } > = [
	{ value: 'production', label: 'Production' },
	{ value: 'staging', label: 'Staging' },
	{ value: 'development', label: 'Development' },
];

function getCapabilitiesForMode( syncMode: SelfHostedMode ): SyncConnectionCapabilities {
	switch ( syncMode ) {
		case 'rest-content':
			return {
				canPull: false,
				canPush: true,
				canPushToProduction: true,
				canSyncContent: true,
				canSyncDatabase: false,
				canSyncFiles: false,
				requiresBackupBeforePush: false,
				requiresDryRunBeforeProductionPush: false,
			};
		case 'ssh-wp-cli':
		case 'connector-plugin':
			return {
				canPull: true,
				canPush: true,
				canPushToProduction: false,
				canSyncContent: true,
				canSyncDatabase: true,
				canSyncFiles: true,
				requiresBackupBeforePush: true,
				requiresDryRunBeforeProductionPush: true,
			};
	}
}

function normalizeSiteUrl( siteUrl: string ): string {
	const trimmed = siteUrl.trim();
	if ( ! trimmed ) {
		return trimmed;
	}
	return /^https?:\/\//i.test( trimmed ) ? trimmed : `https://${ trimmed }`;
}

function getConnectionId(): string {
	return globalThis.crypto?.randomUUID?.() ?? `sync-${ Date.now() }`;
}

export function SelfHostedConnectionWizard( {
	selectedSite,
	connection,
	onBack,
	onRequestClose,
	onSaved,
}: {
	selectedSite: SiteDetails;
	connection?: SelfHostedSyncConnection;
	onBack: () => void;
	onRequestClose: () => void;
	onSaved: ( connections: SyncConnection[] ) => void;
} ) {
	const { __ } = useI18n();
	const [ connectionId ] = useState( () => connection?.id ?? getConnectionId() );
	const [ createdAt ] = useState( () => connection?.createdAt ?? new Date().toISOString() );
	const [ siteUrl, setSiteUrl ] = useState( connection?.siteUrl ?? '' );
	const [ environmentType, setEnvironmentType ] = useState< SyncEnvironmentType >(
		connection?.environmentType ?? 'production'
	);
	const [ syncMode, setSyncMode ] = useState< SelfHostedMode >(
		connection?.syncMode ?? 'rest-content'
	);
	const [ username, setUsername ] = useState(
		connection?.provider === 'self-hosted-rest' ? connection.auth?.username ?? '' : ''
	);
	const [ applicationPassword, setApplicationPassword ] = useState(
		connection?.provider === 'self-hosted-rest' ? connection.auth?.applicationPassword ?? '' : ''
	);
	const [ sshHost, setSshHost ] = useState(
		connection?.provider === 'self-hosted-ssh' ? connection.auth?.host ?? '' : ''
	);
	const [ sshPort, setSshPort ] = useState(
		connection?.provider === 'self-hosted-ssh' ? String( connection.auth?.port ?? 22 ) : '22'
	);
	const [ sshUsername, setSshUsername ] = useState(
		connection?.provider === 'self-hosted-ssh' ? connection.auth?.username ?? '' : ''
	);
	const [ sshPassword, setSshPassword ] = useState(
		connection?.provider === 'self-hosted-ssh' ? connection.auth?.password ?? '' : ''
	);
	const [ privateKeyPath, setPrivateKeyPath ] = useState(
		connection?.provider === 'self-hosted-ssh' ? connection.auth?.privateKeyPath ?? '' : ''
	);
	const [ privateKeyText, setPrivateKeyText ] = useState(
		connection?.provider === 'self-hosted-ssh' ? connection.auth?.privateKeyText ?? '' : ''
	);
	const [ remoteWordPressPath, setRemoteWordPressPath ] = useState(
		connection?.provider === 'self-hosted-ssh' ? connection.auth?.remoteWordPressPath ?? '' : ''
	);
	const [ wpCliPath, setWpCliPath ] = useState(
		connection?.provider === 'self-hosted-ssh' ? connection.auth?.wpCliPath ?? '' : ''
	);
	const [ connectorToken, setConnectorToken ] = useState(
		connection?.provider === 'self-hosted-connector' ? connection.auth?.token ?? '' : ''
	);
	const [ status, setStatus ] = useState< ConnectionStatus >( { type: 'idle', message: '' } );
	const [ isTesting, setIsTesting ] = useState( false );
	const [ isSaving, setIsSaving ] = useState( false );
	const isEditing = Boolean( connection );

	const selectedMode = useMemo(
		() => SELF_HOSTED_MODES.find( ( mode ) => mode.value === syncMode ),
		[ syncMode ]
	);

	const normalizedUrl = normalizeSiteUrl( siteUrl );
	const canKeepSavedCredentials = isEditing && syncMode === connection?.syncMode;
	const hasRestCredentials = Boolean( username.trim() && applicationPassword );
	const hasSshCredentials = Boolean(
		sshHost.trim() &&
			sshUsername.trim() &&
			remoteWordPressPath.trim() &&
			( sshPassword || privateKeyPath.trim() || privateKeyText )
	);
	const hasConnectorCredentials = Boolean( connectorToken );
	const hasCredentialsForMode =
		( syncMode === 'rest-content' && hasRestCredentials ) ||
		( syncMode === 'ssh-wp-cli' && hasSshCredentials ) ||
		( syncMode === 'connector-plugin' && hasConnectorCredentials );
	const canSave = Boolean( normalizedUrl && ( hasCredentialsForMode || canKeepSavedCredentials ) );
	const canTest = Boolean( normalizedUrl ) && canSave;

	const buildConnection = (): SyncConnection => {
		const now = new Date().toISOString();
		const base = {
			id: connectionId,
			localSiteId: selectedSite.id,
			siteUrl: normalizedUrl,
			environmentType,
			lastPullTimestamp: connection?.lastPullTimestamp ?? null,
			lastPushTimestamp: connection?.lastPushTimestamp ?? null,
			capabilities: getCapabilitiesForMode( syncMode ),
			createdAt,
			updatedAt: now,
		};

		switch ( syncMode ) {
			case 'rest-content': {
				const auth =
					username.trim() || applicationPassword
						? {
								username: username.trim(),
								applicationPassword,
						  }
						: undefined;
				return {
					...base,
					provider: 'self-hosted-rest',
					syncMode,
					auth,
				};
			}
			case 'ssh-wp-cli': {
				const auth =
					sshHost.trim() ||
					sshUsername.trim() ||
					sshPassword ||
					privateKeyPath.trim() ||
					privateKeyText ||
					remoteWordPressPath.trim() ||
					wpCliPath.trim()
						? {
								host: sshHost.trim(),
								port: Number.parseInt( sshPort, 10 ) || 22,
								username: sshUsername.trim(),
								password: sshPassword || undefined,
								privateKeyPath: privateKeyPath.trim() || undefined,
								privateKeyText: privateKeyText || undefined,
								remoteWordPressPath: remoteWordPressPath.trim(),
								wpCliPath: wpCliPath.trim() || undefined,
						  }
						: undefined;
				return {
					...base,
					provider: 'self-hosted-ssh',
					syncMode,
					auth,
				};
			}
			case 'connector-plugin': {
				const auth = connectorToken ? { token: connectorToken } : undefined;
				return {
					...base,
					provider: 'self-hosted-connector',
					syncMode,
					auth,
				};
			}
		}
	};

	const handleTestConnection = async () => {
		setIsTesting( true );
		setStatus( { type: 'idle', message: '' } );
		try {
			const result = await getIpcApi().testSyncConnection( buildConnection() );
			setStatus( {
				type: result.ok ? 'success' : 'error',
				message:
					result.message ||
					( result.ok ? __( 'Connection successful.' ) : __( 'Connection failed.' ) ),
			} );
		} catch ( error ) {
			setStatus( {
				type: 'error',
				message: error instanceof Error ? error.message : __( 'Connection failed.' ),
			} );
		} finally {
			setIsTesting( false );
		}
	};

	const handleSaveConnection = async () => {
		setIsSaving( true );
		setStatus( { type: 'idle', message: '' } );
		try {
			const connections = await getIpcApi().saveSyncConnection(
				selectedSite.id,
				buildConnection()
			);
			onSaved( connections );
			onRequestClose();
		} catch ( error ) {
			setStatus( {
				type: 'error',
				message: error instanceof Error ? error.message : __( 'Failed to save connection.' ),
			} );
		} finally {
			setIsSaving( false );
		}
	};

	return (
		<div className="flex flex-col h-full">
			<div className="flex-1 overflow-y-auto px-8 py-6">
				<div className="max-w-2xl mx-auto flex flex-col gap-5">
					<div>
						<h3 className="text-base font-medium text-frame-text">
							{ isEditing ? __( 'Edit self-hosted connection' ) : __( 'Self-hosted WordPress' ) }
						</h3>
						<p className="text-sm text-frame-text-secondary mt-1">
							{ isEditing
								? __(
										'Update the saved site details or enter replacement credentials for this connection.'
								  )
								: __(
										'Connect a WordPress site by URL and choose how Studio should sync with it.'
								  ) }
						</p>
					</div>

					<TextControl
						label={ __( 'Site URL' ) }
						value={ siteUrl }
						onChange={ setSiteUrl }
						placeholder="https://example.com"
					/>

					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<SelectControl< SyncEnvironmentType >
							label={ __( 'Environment type' ) }
							value={ environmentType }
							onChange={ setEnvironmentType }
							options={ ENVIRONMENT_TYPES }
							__next40pxDefaultSize
							__nextHasNoMarginBottom
						/>

						<SelectControl< SelfHostedMode >
							label={ __( 'Sync mode' ) }
							value={ syncMode }
							onChange={ ( value ) => {
								setSyncMode( value );
								setStatus( { type: 'idle', message: '' } );
							} }
							options={ SELF_HOSTED_MODES.map( ( mode ) => ( {
								label: mode.label,
								value: mode.value,
							} ) ) }
							__next40pxDefaultSize
							__nextHasNoMarginBottom
						/>
					</div>

					{ selectedMode && (
						<p className="text-sm text-frame-text-secondary">{ selectedMode.description }</p>
					) }

					{ syncMode === 'rest-content' && (
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<TextControl
								label={ __( 'WordPress username' ) }
								value={ username }
								onChange={ setUsername }
							/>
							<label className="flex flex-col gap-2 text-sm font-medium text-frame-text">
								{ __( 'Application Password' ) }
								<PasswordControl
									value={ applicationPassword }
									onChange={ setApplicationPassword }
									placeholder={ __( 'xxxx xxxx xxxx xxxx xxxx xxxx' ) }
								/>
							</label>
						</div>
					) }

					{ isEditing && syncMode === connection?.syncMode && (
						<Notice status="info" isDismissible={ false }>
							{ __(
								'Leave credential fields blank to keep the encrypted credentials already saved for this connection.'
							) }
						</Notice>
					) }

					{ syncMode === 'ssh-wp-cli' && (
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<TextControl label={ __( 'SSH host' ) } value={ sshHost } onChange={ setSshHost } />
							<TextControl label={ __( 'SSH port' ) } value={ sshPort } onChange={ setSshPort } />
							<TextControl
								label={ __( 'SSH username' ) }
								value={ sshUsername }
								onChange={ setSshUsername }
							/>
							<label className="flex flex-col gap-2 text-sm font-medium text-frame-text">
								{ __( 'SSH password' ) }
								<PasswordControl
									value={ sshPassword }
									onChange={ setSshPassword }
									placeholder={ __( 'Optional if using a private key' ) }
								/>
							</label>
							<TextControl
								label={ __( 'Private key path' ) }
								value={ privateKeyPath }
								onChange={ setPrivateKeyPath }
							/>
							<TextControl
								label={ __( 'Remote WordPress path' ) }
								value={ remoteWordPressPath }
								onChange={ setRemoteWordPressPath }
							/>
							<TextControl
								label={ __( 'WP-CLI path' ) }
								value={ wpCliPath }
								onChange={ setWpCliPath }
							/>
							<TextareaControl
								label={ __( 'Private key text' ) }
								value={ privateKeyText }
								onChange={ setPrivateKeyText }
								className="md:col-span-2"
								__nextHasNoMarginBottom
							/>
							<Notice status="info" isDismissible={ false } className="md:col-span-2">
								{ __( 'Studio will only run SSH commands inside the WordPress path you provide.' ) }
							</Notice>
						</div>
					) }

					{ syncMode === 'connector-plugin' && (
						<label className="flex flex-col gap-2 text-sm font-medium text-frame-text">
							{ __( 'Connector token/API key' ) }
							<PasswordControl value={ connectorToken } onChange={ setConnectorToken } />
						</label>
					) }

					{ syncMode === 'connector-plugin' && (
						<Notice status="info" isDismissible={ false }>
							{ __(
								'The remote site must expose the Studio Connector REST API at /wp-json/studio-connector/v1/.'
							) }
						</Notice>
					) }

					{ status.message && (
						<Notice
							status={ status.type === 'success' ? 'success' : 'error' }
							isDismissible={ false }
						>
							{ status.message }
						</Notice>
					) }
				</div>
			</div>

			<div className="flex px-8 py-4 justify-between items-center border-t border-frame-border">
				<Button variant="link" onClick={ onBack }>
					{ __( 'Back' ) }
				</Button>
				<div className="flex gap-4">
					<Button variant="link" onClick={ onRequestClose }>
						{ __( 'Cancel' ) }
					</Button>
					<Button
						variant="secondary"
						disabled={ ! canTest || isTesting }
						onClick={ handleTestConnection }
					>
						{ isTesting ? __( 'Testing…' ) : __( 'Test connection' ) }
					</Button>
					<Button
						variant="primary"
						disabled={ isSaving || ! canSave }
						onClick={ handleSaveConnection }
					>
						{ isSaving
							? __( 'Saving…' )
							: isEditing
							? __( 'Save changes' )
							: __( 'Save connection' ) }
					</Button>
				</div>
			</div>
		</div>
	);
}
