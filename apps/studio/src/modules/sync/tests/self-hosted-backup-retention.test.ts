import { selectBackupsToPrune } from 'src/modules/sync/lib/self-hosted-backup-retention';
import type { SelfHostedSshBackup } from '@studio/common/types/sync';

const NOW = Date.parse( '2026-06-19T00:00:00.000Z' );

function backup( index: number, daysAgo: number, sizeInBytes: number ): SelfHostedSshBackup {
	const createdAt = new Date( NOW - daysAgo * 24 * 60 * 60 * 1000 ).toISOString();
	return {
		id: `studio-backup-${ index }.tar.gz`,
		createdAt,
		archivePath: `/var/www/html/.studio-backups/studio-backup-${ index }.tar.gz`,
		includeDatabase: true,
		selectedPaths: [],
		sizeInBytes,
	};
}

describe( 'selectBackupsToPrune', () => {
	it( 'prunes nothing when no limits are set', () => {
		const backups = [ backup( 1, 0, 100 ), backup( 2, 10, 100 ) ];
		expect( selectBackupsToPrune( backups, {}, NOW ) ).toEqual( [] );
	} );

	it( 'keeps only the N newest by count', () => {
		const backups = [ backup( 1, 0, 100 ), backup( 2, 1, 100 ), backup( 3, 2, 100 ) ];
		const pruned = selectBackupsToPrune( backups, { maxCount: 2 }, NOW ).map( ( b ) => b.id );
		expect( pruned ).toEqual( [ 'studio-backup-3.tar.gz' ] );
	} );

	it( 'prunes backups older than the age limit', () => {
		const backups = [ backup( 1, 0, 100 ), backup( 2, 5, 100 ), backup( 3, 40, 100 ) ];
		const pruned = selectBackupsToPrune( backups, { maxAgeInDays: 30 }, NOW ).map( ( b ) => b.id );
		expect( pruned ).toEqual( [ 'studio-backup-3.tar.gz' ] );
	} );

	it( 'prunes by cumulative total size, newest-first', () => {
		const backups = [ backup( 1, 0, 100 ), backup( 2, 1, 100 ), backup( 3, 2, 100 ) ];
		// Limit 250: keep #1 (100) + #2 (200) ; #3 would push to 300 > 250 → pruned.
		const pruned = selectBackupsToPrune( backups, { maxTotalSizeInBytes: 250 }, NOW ).map(
			( b ) => b.id
		);
		expect( pruned ).toEqual( [ 'studio-backup-3.tar.gz' ] );
	} );

	it( 'always keeps the newest backup even if it alone exceeds the size limit', () => {
		const backups = [ backup( 1, 0, 10_000 ), backup( 2, 1, 10 ) ];
		const pruned = selectBackupsToPrune( backups, { maxTotalSizeInBytes: 100 }, NOW ).map(
			( b ) => b.id
		);
		expect( pruned ).toEqual( [ 'studio-backup-2.tar.gz' ] );
	} );

	it( 'never prunes the newest backup even when it is past the age limit', () => {
		const backups = [ backup( 1, 100, 10 ) ];
		expect( selectBackupsToPrune( backups, { maxAgeInDays: 30 }, NOW ) ).toEqual( [] );
	} );

	it( 'combines count and age limits (any failing rule prunes)', () => {
		// Newest-first order: #1 (0d), #2 (1d), #3 (3d), #4 (40d, too old).
		const backups = [
			backup( 1, 0, 100 ),
			backup( 2, 1, 100 ),
			backup( 3, 3, 100 ),
			backup( 4, 40, 100 ),
		];
		// maxCount=2 prunes #3 and #4; maxAgeInDays=30 also flags #4. Union = {#3, #4}.
		const pruned = selectBackupsToPrune( backups, { maxCount: 2, maxAgeInDays: 30 }, NOW )
			.map( ( b ) => b.id )
			.sort();
		expect( pruned ).toEqual( [ 'studio-backup-3.tar.gz', 'studio-backup-4.tar.gz' ] );
	} );
} );
