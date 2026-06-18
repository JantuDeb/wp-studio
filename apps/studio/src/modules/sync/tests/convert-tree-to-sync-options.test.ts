import {
	selfHostedSshBackupSchema,
	selfHostedSshPushPreflightSchema,
	selfHostedSshVerificationSchema,
} from '@studio/common/types/sync';
import { describe, expect, it } from 'vitest';
import { TreeNode } from 'src/components/tree-view';
import {
	convertTreeToSelfHostedSshPullOptions,
	convertTreeToSelfHostedSshPushOptions,
} from 'src/modules/sync/lib/convert-tree-to-sync-options';

const createTree = ( {
	database = false,
	files = false,
	children = [],
}: {
	database?: boolean;
	files?: boolean;
	children?: TreeNode[];
} ): TreeNode[] => [
	{
		id: 'filesAndFolders',
		name: 'filesAndFolders',
		label: 'Files and folders',
		checked: files,
		children: [
			{
				id: 'wp-content',
				name: 'wp-content',
				label: 'wp-content',
				checked: files,
				path: 'wp-content',
				children,
			},
		],
	},
	{
		id: 'sqls',
		name: 'sqls',
		label: 'Database',
		checked: database,
	},
];

describe( 'convertTreeToSelfHostedSshPullOptions', () => {
	it( 'uses a full pull when database and all files are selected', () => {
		expect(
			convertTreeToSelfHostedSshPullOptions(
				createTree( {
					database: true,
					files: true,
				} )
			)
		).toEqual( { optionsToSync: [ 'all' ] } );
	} );

	it( 'supports database-only pulls', () => {
		expect(
			convertTreeToSelfHostedSshPullOptions(
				createTree( {
					database: true,
				} )
			)
		).toEqual( { optionsToSync: [ 'sqls' ], specificSelectionPaths: undefined } );
	} );

	it( 'converts checked wp-content nodes to relative SSH paths', () => {
		expect(
			convertTreeToSelfHostedSshPullOptions(
				createTree( {
					children: [
						{
							id: 'plugins/example',
							name: 'example',
							label: 'example',
							checked: true,
							path: 'wp-content/plugins/example',
							pathId: 'wp-content/plugins/example',
						},
						{
							id: 'uploads',
							name: 'uploads',
							label: 'uploads',
							checked: false,
							indeterminate: true,
							path: 'wp-content/uploads',
							children: [
								{
									id: 'uploads/2026',
									name: '2026',
									label: '2026',
									checked: true,
									path: 'wp-content/uploads/2026',
									pathId: 'wp-content/uploads/2026',
								},
							],
						},
					],
				} )
			)
		).toEqual( {
			optionsToSync: [ 'paths' ],
			specificSelectionPaths: [ 'plugins/example', 'uploads/2026' ],
		} );
	} );

	it( 'represents a files-only full wp-content pull as a merge selection', () => {
		expect(
			convertTreeToSelfHostedSshPullOptions(
				createTree( {
					files: true,
				} )
			)
		).toEqual( {
			optionsToSync: [ 'paths' ],
			specificSelectionPaths: [ '' ],
		} );
	} );
} );

describe( 'convertTreeToSelfHostedSshPushOptions', () => {
	it( 'uses the shared full push option', () => {
		expect(
			convertTreeToSelfHostedSshPushOptions(
				createTree( {
					database: true,
					files: true,
				} )
			)
		).toEqual( { optionsToSync: [ 'all' ] } );
	} );

	it( 'preserves selected local wp-content paths', () => {
		expect(
			convertTreeToSelfHostedSshPushOptions(
				createTree( {
					children: [
						{
							id: 'plugins/example',
							name: 'example',
							label: 'example',
							checked: true,
							path: 'wp-content/plugins/example',
							pathId: 'wp-content/plugins/example',
						},
					],
				} )
			)
		).toEqual( {
			optionsToSync: [ 'plugins' ],
			specificSelectionPaths: [ 'plugins/example' ],
		} );
	} );
} );

describe( 'selfHostedSshBackupSchema', () => {
	it( 'accepts a scoped SSH backup manifest', () => {
		expect(
			selfHostedSshBackupSchema.parse( {
				id: 'studio-backup-1718700000000.tar.gz',
				createdAt: '2026-06-18T10:00:00.000Z',
				archivePath: '/var/www/example/.studio-backups/studio-backup-1718700000000.tar.gz',
				includeDatabase: true,
				selectedPaths: [ 'plugins/example', 'uploads/2026' ],
				sizeInBytes: 1024,
			} )
		).toMatchObject( {
			includeDatabase: true,
			selectedPaths: [ 'plugins/example', 'uploads/2026' ],
		} );
	} );

	it( 'rejects invalid backup sizes', () => {
		expect( () =>
			selfHostedSshBackupSchema.parse( {
				id: 'studio-backup-1718700000000.tar.gz',
				createdAt: '2026-06-18T10:00:00.000Z',
				archivePath: '/var/www/example/.studio-backups/studio-backup-1718700000000.tar.gz',
				includeDatabase: false,
				selectedPaths: [ 'themes/example' ],
				sizeInBytes: -1,
			} )
		).toThrow();
	} );
} );

describe( 'selfHostedSshPushPreflightSchema', () => {
	it( 'accepts a successful disk-space preflight', () => {
		expect(
			selfHostedSshPushPreflightSchema.parse( {
				archiveSizeInBytes: 100,
				estimatedBackupSizeInBytes: 200,
				availableDiskSpaceInBytes: 1000,
				requiredDiskSpaceInBytes: 400,
				hasEnoughDiskSpace: true,
				includeDatabase: true,
				selectedPaths: [ 'plugins/example' ],
			} )
		).toMatchObject( {
			hasEnoughDiskSpace: true,
			includeDatabase: true,
		} );
	} );
} );

describe( 'selfHostedSshVerificationSchema', () => {
	it( 'accepts a healthy remote WordPress verification report', () => {
		expect(
			selfHostedSshVerificationSchema.parse( {
				ok: true,
				coreVersion: '6.8.1',
				databaseOk: true,
				siteUrl: 'https://staging.example.com',
				homeUrl: 'https://staging.example.com',
				activePluginCount: 8,
				urlMatchesConnection: true,
			} )
		).toMatchObject( {
			ok: true,
			databaseOk: true,
			activePluginCount: 8,
		} );
	} );
} );
