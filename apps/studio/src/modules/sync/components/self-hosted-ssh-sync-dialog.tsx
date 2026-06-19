import { Notice, SelectControl, Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useState } from 'react';
import Button from 'src/components/button';
import { TreeView, TreeNode, updateNodeById } from 'src/components/tree-view';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { SyncDialogShell } from 'src/modules/sync/components/sync-dialog-shell';
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
		<SyncDialogShell
			title={
				type === 'pull' ? __( 'Pull from self-hosted site' ) : __( 'Push to self-hosted site' )
			}
			description={
				<span className="text-frame-text-secondary">
					{ type === 'pull'
						? __( 'Choose the remote database and wp-content files to pull into this Studio site.' )
						: __(
								'Choose the local database and wp-content files to push. Studio will back up the selected remote data before restoring it.'
						  ) }
				</span>
			}
			sourceName={ sourceName }
			destinationName={ destinationName }
			sourceNameText={ sourceName }
			destinationNameText={ destinationName }
			selectionHeading={
				type === 'pull' ? __( 'Select data to pull' ) : __( 'Select data to push' )
			}
			bottomPadding="6rem"
			onRequestClose={ onRequestClose }
			footer={
				<>
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
				</>
			}
		>
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
		</SyncDialogShell>
	);
}
