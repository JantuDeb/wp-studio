import { buildExtensionAdvisories } from 'src/modules/sync/lib/self-hosted-advisories';
import type { SelfHostedSshManagedExtension } from '@studio/common/types/sync';

function extension(
	overrides: Partial< SelfHostedSshManagedExtension > = {}
): SelfHostedSshManagedExtension {
	return {
		name: 'akismet',
		title: 'Akismet',
		status: 'active',
		version: '5.0',
		updateVersion: null,
		...overrides,
	};
}

describe( 'buildExtensionAdvisories', () => {
	it( 'flags an extension removed from the directory as critical', async () => {
		const advisories = await buildExtensionAdvisories(
			'plugin',
			[ extension( { name: 'evil-plugin', title: 'Evil' } ) ],
			async () => ( { removed: true, known: true } )
		);

		expect( advisories ).toHaveLength( 1 );
		expect( advisories[ 0 ] ).toMatchObject( {
			severity: 'critical',
			kind: 'removed',
			slug: 'evil-plugin',
		} );
	} );

	it( 'flags an outdated extension as a warning', async () => {
		const advisories = await buildExtensionAdvisories(
			'plugin',
			[ extension( { updateVersion: '5.1' } ) ],
			async () => ( { removed: false, known: true } )
		);

		expect( advisories[ 0 ] ).toMatchObject( {
			severity: 'warning',
			kind: 'outdated',
			installedVersion: '5.0',
			availableVersion: '5.1',
		} );
	} );

	it( 'prefers the removed signal over the outdated signal', async () => {
		const advisories = await buildExtensionAdvisories(
			'plugin',
			[ extension( { updateVersion: '5.1' } ) ],
			async () => ( { removed: true, known: true } )
		);

		expect( advisories ).toHaveLength( 1 );
		expect( advisories[ 0 ].kind ).toBe( 'removed' );
	} );

	it( 'does not flag a known, current extension', async () => {
		const advisories = await buildExtensionAdvisories( 'plugin', [ extension() ], async () => ( {
			removed: false,
			known: true,
		} ) );

		expect( advisories ).toEqual( [] );
	} );

	it( 'does not treat an unknown (custom/premium) extension as removed', async () => {
		const advisories = await buildExtensionAdvisories(
			'plugin',
			[ extension( { name: 'my-custom-plugin', updateVersion: null } ) ],
			async () => ( { removed: false, known: false } )
		);

		expect( advisories ).toEqual( [] );
	} );

	it( 'still reports outdated when the directory lookup throws', async () => {
		const advisories = await buildExtensionAdvisories(
			'theme',
			[ extension( { name: 'twentytwentyfour', updateVersion: '1.2' } ) ],
			async () => {
				throw new Error( 'network down' );
			}
		);

		expect( advisories[ 0 ] ).toMatchObject( { kind: 'outdated', type: 'theme' } );
	} );
} );
