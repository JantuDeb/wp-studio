import {
	Notice,
	SelectControl,
	Spinner,
	__experimentalHeading as Heading,
} from '@wordpress/components';
import { sprintf, __ } from '@wordpress/i18n';
import { useCallback, useEffect, useState } from 'react';
import Button from 'src/components/button';
import Modal from 'src/components/modal';
import { TreeView, TreeNode, updateNodeById } from 'src/components/tree-view';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useTopLevelSyncTree } from 'src/modules/sync/hooks/use-top-level-sync-tree';
import {
	convertTreeToSelfHostedSshPullOptions,
	convertTreeToSelfHostedSshPushOptions,
} from 'src/modules/sync/lib/convert-tree-to-sync-options';
import { convertRawToTreeNodes } from 'src/modules/sync/lib/tree-utils';
import type {
	SelfHostedSshPullOptions,
	SelfHostedSshPushOptions,
	SyncConnection,
} from '@studio/common/types/sync';

type SelfHostedSshConnection = Extract< SyncConnection, { provider: 'self-hosted-ssh' } >;

type SelfHostedSshSyncDialogProps = {
	localSite: SiteDetails;
	connection: SelfHostedSshConnection;
	type: 'pull' | 'push';
	isSyncing: boolean;
	onPull: ( options: SelfHostedSshPullOptions ) => void;
	onPush: ( options: SelfHostedSshPushOptions ) => void;
	onRequestClose: () => void;
};

export function SelfHostedSshSyncDialog( {
	localSite,
	connection,
	type,
	isSyncing,
	onPull,
	onPush,
	onRequestClose,
}: SelfHostedSshSyncDialogProps ) {
	const defaultTree = useTopLevelSyncTree();
	const [ treeState, setTreeState ] = useState< TreeNode[] >( defaultTree );
	const [ showAllFiles, setShowAllFiles ] = useState( false );
	const [ isLoading, setIsLoading ] = useState( true );
	const [ loadError, setLoadError ] = useState< string | null >( null );
	const isSubmitDisabled = treeState.every( ( node ) => ! node.checked && ! node.indeterminate );

	const loadChildren = useCallback(
		async ( selectedPath: string ) => {
			const rawEntries =
				type === 'pull'
					? await getIpcApi().listSelfHostedSshFiles( localSite.id, connection.id, selectedPath )
					: await getIpcApi().listLocalFileTree( localSite.id, selectedPath || 'wp-content' );
			return convertRawToTreeNodes( rawEntries );
		},
		[ connection.id, localSite.id, type ]
	);

	useEffect( () => {
		let isCancelled = false;
		setIsLoading( true );
		setLoadError( null );
		void loadChildren( '' )
			.then( ( children ) => {
				if ( ! isCancelled ) {
					setTreeState( ( currentTree ) =>
						updateNodeById( currentTree, 'wp-content', { children } )
					);
				}
			} )
			.catch( ( error ) => {
				if ( ! isCancelled ) {
					setLoadError( error instanceof Error ? error.message : __( 'Unable to load files.' ) );
				}
			} )
			.finally( () => {
				if ( ! isCancelled ) {
					setIsLoading( false );
				}
			} );

		return () => {
			isCancelled = true;
		};
	}, [ loadChildren ] );

	const handleExpand = useCallback(
		async ( node: TreeNode ) => {
			if ( ! node.path || node.hideExpandButton || node.children?.length ) {
				return;
			}

			try {
				const children = await loadChildren( node.path );
				setTreeState( ( currentTree ) =>
					updateNodeById( currentTree, node.id, { children, hasError: false } )
				);
			} catch {
				setTreeState( ( currentTree ) =>
					updateNodeById( currentTree, node.id, { children: [], hasError: true } )
				);
			}
		},
		[ loadChildren ]
	);

	const handleFileSelectionModeChange = ( value: string ) => {
		const shouldShowAllFiles = value === 'specific';
		setShowAllFiles( shouldShowAllFiles );
		setTreeState( ( currentTree ) =>
			updateNodeById( currentTree, 'filesAndFolders', {
				expanded: shouldShowAllFiles,
			} )
		);
	};

	const handleSubmit = () => {
		if ( type === 'pull' ) {
			onPull( convertTreeToSelfHostedSshPullOptions( treeState ) );
		} else {
			onPush( convertTreeToSelfHostedSshPushOptions( treeState ) );
		}
	};

	const sourceName = type === 'pull' ? connection.siteUrl : localSite.name;
	const destinationName = type === 'pull' ? localSite.name : connection.siteUrl;

	return (
		<Modal
			className="w-3/5 min-w-[550px] max-h-[84vh] [&>div]:!p-0"
			onRequestClose={ onRequestClose }
			title={
				type === 'pull' ? __( 'Pull from self-hosted site' ) : __( 'Push to self-hosted site' )
			}
		>
			<div className="pb-24">
				<div className="px-8 pb-6 pt-1 text-frame-text-secondary">
					{ type === 'pull'
						? __( 'Choose the remote database and wp-content files to pull into this Studio site.' )
						: __(
								'Choose the local database and wp-content files to push. Studio will back up the selected remote data before restoring it.'
						  ) }
				</div>
				<div className="px-8 pb-6 border-b border-frame-border">
					<div className="text-sm text-frame-text">
						{ sprintf(
							/* translators: %1$s is the source site and %2$s is the destination site. */
							__( 'From %1$s to %2$s' ),
							sourceName,
							destinationName
						) }
					</div>
				</div>
				<Heading
					level={ 2 }
					lineHeight="28px"
					size={ 11 }
					weight={ 500 }
					upperCase
					className="px-8 pt-5 pb-3"
				>
					{ type === 'pull' ? __( 'Select data to pull' ) : __( 'Select data to push' ) }
				</Heading>
				<div className="px-8 pb-4 relative">
					<div className="absolute end-6 z-10 top-[6px]">
						<SelectControl
							value={ showAllFiles ? 'specific' : 'all' }
							variant="minimal"
							options={ [
								{ label: __( 'All files and folders' ), value: 'all' },
								{ label: __( 'Specific files and folders' ), value: 'specific' },
							] }
							onChange={ handleFileSelectionModeChange }
							disabled={ isLoading || Boolean( loadError ) }
							__next40pxDefaultSize
							__nextHasNoMarginBottom
							aria-label={ __( 'Select files and folders to sync' ) }
							className="h-9 select-minimal"
						/>
					</div>
					{ isLoading ? (
						<div className="flex items-center gap-2 py-4 text-frame-text-secondary">
							<Spinner className="!m-0 [&>circle]:stroke-frame-text-secondary" />
							{ type === 'pull' ? __( 'Loading remote files…' ) : __( 'Loading local files…' ) }
						</div>
					) : loadError ? (
						<Notice status="error" isDismissible={ false }>
							{ loadError }
						</Notice>
					) : (
						<TreeView
							tree={ treeState }
							setTree={ setTreeState }
							onExpand={ handleExpand }
							renderEmptyContent={ ( _nodeId, node ) => (
								<div className="text-frame-text-secondary italic">
									{ node.hasError ? __( 'Unable to load this directory.' ) : __( 'Empty' ) }
								</div>
							) }
						/>
					) }
				</div>
				<div className="px-8 py-4 absolute left-0 right-0 bottom-0 bg-frame z-10 border-t border-frame-border">
					<Notice status="warning" isDismissible={ false } className="mb-4">
						{ type === 'pull'
							? __(
									'Database pulls replace the local database. Selected files are merged into local wp-content; a full pull replaces local synced content.'
							  )
							: __(
									'Database pushes replace the remote database. A backup is required and will be retained on the remote server.'
							  ) }
					</Notice>
					<div className="flex gap-4 justify-end">
						<Button variant="link" onClick={ onRequestClose } disabled={ isSyncing }>
							{ __( 'Cancel' ) }
						</Button>
						<Button
							variant="primary"
							onClick={ handleSubmit }
							disabled={ isSubmitDisabled || isLoading || Boolean( loadError ) || isSyncing }
						>
							{ isSyncing
								? type === 'pull'
									? __( 'Pulling…' )
									: __( 'Pushing…' )
								: type === 'pull'
								? __( 'Pull selected data' )
								: __( 'Push selected data' ) }
						</Button>
					</div>
				</div>
			</div>
		</Modal>
	);
}
