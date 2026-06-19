import type {
	SelfHostedSshBackup,
	SelfHostedSshBackupRetentionPolicy,
} from '@studio/common/types/sync';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Decide which backups to prune under a retention policy.
 *
 * Rules, applied to backups newest-first:
 * - The single newest backup is always retained, even if it alone violates a size/age limit, so a
 *   push never deletes the backup it just created.
 * - `maxAgeInDays`: backups created before the cutoff are pruned.
 * - `maxCount`: only the N newest backups are retained.
 * - `maxTotalSizeInBytes`: walking newest-first, once the cumulative retained size would exceed the
 *   limit, the remaining (older) backups are pruned.
 *
 * A backup is pruned if it fails any enforced rule. The `now` timestamp is injected so the result is
 * deterministic and testable.
 */
export function selectBackupsToPrune(
	backups: SelfHostedSshBackup[],
	policy: SelfHostedSshBackupRetentionPolicy,
	now: number
): SelfHostedSshBackup[] {
	const ordered = [ ...backups ].sort( ( a, b ) => b.createdAt.localeCompare( a.createdAt ) );
	const ageCutoff =
		policy.maxAgeInDays !== undefined ? now - policy.maxAgeInDays * MILLISECONDS_PER_DAY : null;

	const toPrune: SelfHostedSshBackup[] = [];
	let retainedCount = 0;
	let retainedSize = 0;

	for ( let index = 0; index < ordered.length; index++ ) {
		const backup = ordered[ index ];

		// Always retain the newest backup.
		if ( index === 0 ) {
			retainedCount++;
			retainedSize += backup.sizeInBytes;
			continue;
		}

		const tooOld = ageCutoff !== null && Date.parse( backup.createdAt ) < ageCutoff;
		const overCount = policy.maxCount !== undefined && retainedCount >= policy.maxCount;
		const overSize =
			policy.maxTotalSizeInBytes !== undefined &&
			retainedSize + backup.sizeInBytes > policy.maxTotalSizeInBytes;

		if ( tooOld || overCount || overSize ) {
			toPrune.push( backup );
			continue;
		}

		retainedCount++;
		retainedSize += backup.sizeInBytes;
	}

	return toPrune;
}
