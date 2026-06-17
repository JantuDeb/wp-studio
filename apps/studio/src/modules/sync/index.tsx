import { CheckboxControl, Notice, Spinner } from '@wordpress/components';
import { sprintf } from '@wordpress/i18n';
import { check, Icon } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren, useEffect, useState } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { IllustrationGrid } from 'src/components/illustration-grid';
import Modal from 'src/components/modal';
import offlineIcon from 'src/components/offline-icon';
import { Tooltip } from 'src/components/tooltip';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { ConnectButton } from 'src/modules/sync/components/connect-button';
import { SelfHostedConnectionWizard } from 'src/modules/sync/components/self-hosted-connection-wizard';
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
import type { SyncConnection, SyncSite } from '@studio/common/types/sync';

type SelfHostedSyncConnection = Extract< SyncConnection, { siteUrl: string } >;
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
	pushingConnectionId,
}: {
	connections: SyncConnection[];
	onDisconnect: ( connectionId: string ) => void;
	onEdit: ( connection: SelfHostedSyncConnection ) => void;
	onChooseContent: ( connectionId: string ) => void;
	pushingConnectionId: string | null;
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
						<div className="mt-4 flex justify-end gap-3">
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
						</div>
					</div>
				) ) }
			</div>
		</div>
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
}: {
	items: ContentSelectionItem[];
	isLoading: boolean;
	isPreviewing: boolean;
	isPushing: boolean;
	preview: ContentPushPreview | null;
	onRequestClose: () => void;
	onPreview: ( selectedItems: SelectedContentItem[] ) => void;
	onPush: ( selectedItems: SelectedContentItem[] ) => void;
} ) {
	const { __ } = useI18n();
	const [ selectedKeys, setSelectedKeys ] = useState< Set< string > >( new Set() );

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
							disabled={ isPreviewing || isPushing || selectedItems.length === 0 || hasConflicts }
							onClick={ () =>
								hasPreviewForSelection ? onPush( selectedItems ) : handlePreview()
							}
						>
							{ isPushing
								? __( 'Pushing…' )
								: isPreviewing
								? __( 'Previewing…' )
								: hasPreviewForSelection
								? __( 'Push selected content' )
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
		selectedItems: SelectedContentItem[]
	) => {
		setPushingConnectionId( connectionId );
		try {
			const summary = await getIpcApi().pushSelfHostedRestContent( selectedSite.id, connectionId, {
				publish: false,
				selectedItems,
			} );
			getIpcApi().showNotification( {
				title: __( 'Content pushed' ),
				body: sprintf(
					__(
						'Pushed %1$d posts, %2$d pages, %3$d media items, %4$d categories, and %5$d tags as drafts.'
					),
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
							pushingConnectionId={ pushingConnectionId }
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
					onRequestClose={ () => {
						if ( pushingConnectionId ) {
							return;
						}
						setPickingConnectionId( null );
					} }
					onPreview={ ( selectedItems ) =>
						handlePreviewSelfHostedRestContentPush( pickingConnectionId, selectedItems )
					}
					onPush={ ( selectedItems ) =>
						handlePushSelfHostedRestContent( pickingConnectionId, selectedItems )
					}
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
