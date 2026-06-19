import type {
	SelfHostedSshAdvisory,
	SelfHostedSshManagedExtension,
} from '@studio/common/types/sync';

export type DirectoryLookupResult = {
	// True when the slug exists in the wordpress.org directory but has been closed/removed. Removed
	// plugins are frequently pulled for security reasons, so this is treated as a strong signal.
	removed: boolean;
	// False when the slug is not in the directory at all (custom/premium extension) — not a signal.
	known: boolean;
};

export type DirectoryLookup = (
	type: 'plugin' | 'theme',
	slug: string
) => Promise< DirectoryLookupResult >;

/**
 * Build a list of security/maintenance advisories from a plugin/theme inventory.
 *
 * Two signals are derived without any paid vulnerability feed:
 * - `removed`: the extension is closed/removed from the wordpress.org directory (critical — often a
 *   security removal). Only flagged for slugs the directory recognizes.
 * - `outdated`: WP-CLI reports an available update (warning — running behind on security patches).
 *
 * The directory lookup is injected so this is fully unit-testable and so failures degrade to
 * `unknown` rather than throwing. Active extensions are checked before inactive ones.
 */
export async function buildExtensionAdvisories(
	type: 'plugin' | 'theme',
	extensions: SelfHostedSshManagedExtension[],
	lookup: DirectoryLookup
): Promise< SelfHostedSshAdvisory[] > {
	const advisories: SelfHostedSshAdvisory[] = [];

	for ( const extension of extensions ) {
		let directory: DirectoryLookupResult = { removed: false, known: false };
		try {
			directory = await lookup( type, extension.name );
		} catch {
			// Network/lookup failure: fall through and emit an `unknown` advisory only if outdated.
		}

		if ( directory.known && directory.removed ) {
			advisories.push( {
				type,
				slug: extension.name,
				title: extension.title,
				severity: 'critical',
				kind: 'removed',
				installedVersion: extension.version,
				availableVersion: null,
				detail: `${ extension.title } has been removed from the WordPress.org directory, which often indicates a security removal. Review and replace it.`,
			} );
			continue;
		}

		if ( extension.updateVersion ) {
			advisories.push( {
				type,
				slug: extension.name,
				title: extension.title,
				severity: 'warning',
				kind: 'outdated',
				installedVersion: extension.version,
				availableVersion: extension.updateVersion,
				detail: `${ extension.title } is outdated (${ extension.version } → ${ extension.updateVersion }). Update to receive the latest security fixes.`,
			} );
		}
	}

	return advisories;
}
