import {
	buildMediaUrlReplacementMap,
	getMediaUrls,
	getUsedMediaIdsFromContent,
	mergeMediaUrlReplacementMaps,
	replaceMediaUrls,
} from 'src/modules/sync/lib/self-hosted-media-sync';

describe( 'self-hosted media sync helpers', () => {
	const localMedia = {
		id: 10,
		source_url: 'https://local.test/wp-content/uploads/2026/hero.jpg',
		link: 'https://local.test/hero/',
		guid: {
			rendered: 'https://local.test/wp-content/uploads/2026/hero.jpg',
		},
		media_details: {
			sizes: {
				medium: {
					source_url: 'https://local.test/wp-content/uploads/2026/hero-300x200.jpg',
				},
				large: {
					source_url: 'https://local.test/wp-content/uploads/2026/hero-1024x682.jpg',
				},
			},
		},
	};

	const remoteMedia = {
		id: 20,
		source_url: 'https://remote.test/wp-content/uploads/2026/hero.jpg',
		link: 'https://remote.test/hero/',
		media_details: {
			sizes: {
				medium: {
					source_url: 'https://remote.test/wp-content/uploads/2026/hero-300x200.jpg',
				},
				large: {
					source_url: 'https://remote.test/wp-content/uploads/2026/hero-1024x682.jpg',
				},
			},
		},
	};

	it( 'collects original, generated size, attachment, and guid URLs', () => {
		expect( getMediaUrls( localMedia ) ).toEqual( [
			'https://local.test/wp-content/uploads/2026/hero-1024x682.jpg',
			'https://local.test/wp-content/uploads/2026/hero-300x200.jpg',
			'https://local.test/wp-content/uploads/2026/hero.jpg',
			'https://local.test/hero/',
		] );
	} );

	it( 'detects media used through generated size URLs', () => {
		const usedMediaIds = getUsedMediaIdsFromContent(
			[ '<img src="https://local.test/wp-content/uploads/2026/hero-300x200.jpg" />' ],
			[ localMedia ],
			[]
		);

		expect( usedMediaIds ).toEqual( new Set( [ 10 ] ) );
	} );

	it( 'always includes featured media ids', () => {
		const usedMediaIds = getUsedMediaIdsFromContent( [ '' ], [ localMedia ], [ 10 ] );

		expect( usedMediaIds ).toEqual( new Set( [ 10 ] ) );
	} );

	it( 'maps local generated size URLs to matching remote generated size URLs', () => {
		const replacements = buildMediaUrlReplacementMap( localMedia, remoteMedia );

		expect( replacements.get( 'https://local.test/wp-content/uploads/2026/hero.jpg' ) ).toBe(
			'https://remote.test/wp-content/uploads/2026/hero.jpg'
		);
		expect(
			replacements.get( 'https://local.test/wp-content/uploads/2026/hero-300x200.jpg' )
		).toBe( 'https://remote.test/wp-content/uploads/2026/hero-300x200.jpg' );
		expect( replacements.get( 'https://local.test/hero/' ) ).toBe( 'https://remote.test/hero/' );
	} );

	it( 'replaces longer generated URLs before base URLs', () => {
		const replacements = mergeMediaUrlReplacementMaps( [
			buildMediaUrlReplacementMap( localMedia, remoteMedia ),
		] );

		expect(
			replaceMediaUrls(
				[
					'https://local.test/wp-content/uploads/2026/hero-300x200.jpg',
					'https://local.test/wp-content/uploads/2026/hero.jpg',
				].join( ' ' ),
				replacements
			)
		).toBe(
			[
				'https://remote.test/wp-content/uploads/2026/hero-300x200.jpg',
				'https://remote.test/wp-content/uploads/2026/hero.jpg',
			].join( ' ' )
		);
	} );
} );
