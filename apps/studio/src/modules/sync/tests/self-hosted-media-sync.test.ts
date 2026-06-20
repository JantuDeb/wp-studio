import {
	buildMediaUrlReplacementMap,
	getMediaIdsReferencedById,
	getMediaUrls,
	getUsedMediaIdsFromContent,
	mergeMediaUrlReplacementMaps,
	replaceMediaUrls,
	rewriteMediaIdReferences,
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

describe( 'attachment-id media references', () => {
	it( 'detects block JSON single id attributes', () => {
		expect( getMediaIdsReferencedById( '<!-- wp:image {"id":42,"sizeSlug":"large"} -->' ) ).toEqual(
			new Set( [ 42 ] )
		);
	} );

	it( 'detects block JSON id lists from galleries', () => {
		expect(
			getMediaIdsReferencedById( '<!-- wp:gallery {"ids":[1,2, 3],"columns":3} -->' )
		).toEqual( new Set( [ 1, 2, 3 ] ) );
	} );

	it( 'detects gallery and playlist shortcode id lists', () => {
		expect( getMediaIdsReferencedById( '[gallery ids="7,8,9"] [playlist ids="10"]' ) ).toEqual(
			new Set( [ 7, 8, 9, 10 ] )
		);
	} );

	it( 'detects caption shortcode attachment ids', () => {
		expect( getMediaIdsReferencedById( '[caption id="attachment_55" width="300"]' ) ).toEqual(
			new Set( [ 55 ] )
		);
	} );

	it( 'detects classic wp-image and wp-att class names', () => {
		expect(
			getMediaIdsReferencedById( '<img class="alignnone wp-image-12" /> <a class="wp-att-99">' )
		).toEqual( new Set( [ 12, 99 ] ) );
	} );

	it( 'adds id-referenced media that have no matching URL in content', () => {
		const galleryMedia = {
			id: 42,
			source_url: 'https://local.test/wp-content/uploads/2026/never-rendered.jpg',
		};

		const usedMediaIds = getUsedMediaIdsFromContent(
			[ '<!-- wp:image {"id":42} --><figure class="wp-image-42"></figure>' ],
			[ galleryMedia ],
			[]
		);

		expect( usedMediaIds ).toEqual( new Set( [ 42 ] ) );
	} );

	it( 'ignores referenced ids that are not known local media', () => {
		const usedMediaIds = getUsedMediaIdsFromContent(
			[ '<!-- wp:image {"id":999} -->' ],
			[ { id: 42, source_url: 'https://local.test/a.jpg' } ],
			[]
		);

		expect( usedMediaIds ).toEqual( new Set() );
	} );
} );

describe( 'rewriteMediaIdReferences', () => {
	const remap = new Map( [
		[ 42, 142 ],
		[ 7, 107 ],
		[ 8, 108 ],
	] );

	it( 'rewrites block JSON single ids', () => {
		expect( rewriteMediaIdReferences( '<!-- wp:image {"id":42} -->', remap ) ).toBe(
			'<!-- wp:image {"id":142} -->'
		);
	} );

	it( 'rewrites block JSON id lists', () => {
		expect( rewriteMediaIdReferences( '<!-- wp:gallery {"ids":[7,8]} -->', remap ) ).toBe(
			'<!-- wp:gallery {"ids":[107,108]} -->'
		);
	} );

	it( 'rewrites shortcode id lists', () => {
		expect( rewriteMediaIdReferences( '[gallery ids="7,8"]', remap ) ).toBe(
			'[gallery ids="107,108"]'
		);
	} );

	it( 'rewrites caption shortcode attachment ids', () => {
		expect( rewriteMediaIdReferences( '[caption id="attachment_42"]', remap ) ).toBe(
			'[caption id="attachment_142"]'
		);
	} );

	it( 'rewrites wp-image and wp-att class names', () => {
		expect( rewriteMediaIdReferences( '<img class="wp-image-42" />', remap ) ).toBe(
			'<img class="wp-image-142" />'
		);
	} );

	it( 'leaves unmapped ids untouched', () => {
		expect( rewriteMediaIdReferences( '<!-- wp:image {"id":999} -->', remap ) ).toBe(
			'<!-- wp:image {"id":999} -->'
		);
	} );

	it( 'is a no-op for an empty map', () => {
		expect( rewriteMediaIdReferences( '<!-- wp:image {"id":42} -->', new Map() ) ).toBe(
			'<!-- wp:image {"id":42} -->'
		);
	} );
} );
