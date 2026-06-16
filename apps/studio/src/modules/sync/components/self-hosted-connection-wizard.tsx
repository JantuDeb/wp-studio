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
	onBack,
	onRequestClose,
	onSaved,
}: {
	selectedSite: SiteDetails;
	onBack: () => void;
	onRequestClose: () => void;
	onSaved: ( connections: SyncConnection[] ) => void;
} ) {
	const { __ } = useI18n();
	const [ siteUrl, setSiteUrl ] = useState( '' );
	const [ environmentType, setEnvironmentType ] = useState< SyncEnvironmentType >( 'production' );
	const [ syncMode, setSyncMode ] = useState< SelfHostedMode >( 'rest-content' );
	const [ username, setUsername ] = useState( '' );
	const [ applicationPassword, setApplicationPassword ] = useState( '' );
	const [ sshHost, setSshHost ] = useState( '' );
	const [ sshPort, setSshPort ] = useState( '22' );
	const [ sshUsername, setSshUsername ] = useState( '' );
	const [ privateKeyPath, setPrivateKeyPath ] = useState( '' );
	const [ privateKeyText, setPrivateKeyText ] = useState( '' );
	const [ remoteWordPressPath, setRemoteWordPressPath ] = useState( '' );
	const [ wpCliPath, setWpCliPath ] = useState( '' );
	const [ connectorToken, setConnectorToken ] = useState( '' );
	const [ status, setStatus ] = useState< ConnectionStatus >( { type: 'idle', message: '' } );
	const [ isTesting, setIsTesting ] = useState( false );
	const [ isSaving, setIsSaving ] = useState( false );

	const selectedMode = useMemo(
		() => SELF_HOSTED_MODES.find( ( mode ) => mode.value === syncMode ),
		[ syncMode ]
	);

	const canTest = syncMode === 'rest-content';
	const normalizedUrl = normalizeSiteUrl( siteUrl );

	const buildConnection = (): SyncConnection => {
		const now = new Date().toISOString();
		const base = {
			id: getConnectionId(),
			localSiteId: selectedSite.id,
			siteUrl: normalizedUrl,
			environmentType,
			lastPullTimestamp: null,
			lastPushTimestamp: null,
			capabilities: getCapabilitiesForMode( syncMode ),
			createdAt: now,
			updatedAt: now,
		};

		switch ( syncMode ) {
			case 'rest-content':
				return {
					...base,
					provider: 'self-hosted-rest',
					syncMode,
					auth: {
						username: username.trim(),
						applicationPassword,
					},
				};
			case 'ssh-wp-cli':
				return {
					...base,
					provider: 'self-hosted-ssh',
					syncMode,
					auth: {
						host: sshHost.trim(),
						port: Number.parseInt( sshPort, 10 ) || 22,
						username: sshUsername.trim(),
						privateKeyPath: privateKeyPath.trim() || undefined,
						privateKeyText: privateKeyText || undefined,
						remoteWordPressPath: remoteWordPressPath.trim(),
						wpCliPath: wpCliPath.trim() || undefined,
					},
				};
			case 'connector-plugin':
				return {
					...base,
					provider: 'self-hosted-connector',
					syncMode,
					auth: {
						token: connectorToken,
					},
				};
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
							{ __( 'Self-hosted WordPress' ) }
						</h3>
						<p className="text-sm text-frame-text-secondary mt-1">
							{ __( 'Connect a WordPress site by URL and choose how Studio should sync with it.' ) }
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

					{ syncMode === 'ssh-wp-cli' && (
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<TextControl label={ __( 'SSH host' ) } value={ sshHost } onChange={ setSshHost } />
							<TextControl label={ __( 'SSH port' ) } value={ sshPort } onChange={ setSshPort } />
							<TextControl
								label={ __( 'SSH username' ) }
								value={ sshUsername }
								onChange={ setSshUsername }
							/>
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
						</div>
					) }

					{ syncMode === 'connector-plugin' && (
						<label className="flex flex-col gap-2 text-sm font-medium text-frame-text">
							{ __( 'Connector token/API key' ) }
							<PasswordControl value={ connectorToken } onChange={ setConnectorToken } />
						</label>
					) }

					{ syncMode !== 'rest-content' && (
						<Notice status="info" isDismissible={ false }>
							{ __(
								'Connection testing for this mode will be added with the full-sync implementation.'
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
						disabled={ ! canTest || isTesting || ! normalizedUrl }
						onClick={ handleTestConnection }
					>
						{ isTesting ? __( 'Testing…' ) : __( 'Test connection' ) }
					</Button>
					<Button
						variant="primary"
						disabled={ isSaving || ! normalizedUrl }
						onClick={ handleSaveConnection }
					>
						{ isSaving ? __( 'Saving…' ) : __( 'Save connection' ) }
					</Button>
				</div>
			</div>
		</div>
	);
}
