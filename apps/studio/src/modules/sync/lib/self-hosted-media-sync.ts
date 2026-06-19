type MediaSize = {
	source_url?: string;
};

export type SyncMediaItem = {
	id: number;
	source_url?: string;
	link?: string;
	guid?: {
		rendered?: string;
		raw?: string;
	};
	media_details?: {
		file?: string;
		sizes?: Record< string, MediaSize >;
	};
};

function isUrl( value: string | undefined ): value is string {
	return typeof value === 'string' && /^https?:\/\//i.test( value );
}

export function getMediaUrls( media: SyncMediaItem ): string[] {
	const urls = new Set< string >();

	for ( const value of [
		media.source_url,
		media.link,
		media.guid?.rendered,
		media.guid?.raw,
		...Object.values( media.media_details?.sizes ?? {} ).map( ( size ) => size.source_url ),
	] ) {
		if ( isUrl( value ) ) {
			urls.add( value );
		}
	}

	return [ ...urls ].sort( ( a, b ) => b.length - a.length );
}

/**
 * Extract attachment IDs that are referenced by ID rather than by URL.
 *
 * WordPress stores attachment references by numeric ID in several places that contain no usable
 * local URL: block-editor JSON attributes (`<!-- wp:image {"id":42} -->`, gallery `"ids":[1,2]`),
 * classic gallery/caption shortcodes (`[gallery ids="1,2,3"]`, `[caption id="attachment_5"]`), and
 * `wp-image-N` / `wp-att-N` class names. Detecting these lets us upload the media even when its
 * URL never appears verbatim in the content (e.g. galleries render their own markup at display
 * time).
 */
export function getMediaIdsReferencedById( content: string ): Set< number > {
	const ids = new Set< number >();

	const add = ( raw: string | number | undefined ): void => {
		const value = Number.parseInt( String( raw ?? '' ), 10 );
		if ( Number.isInteger( value ) && value > 0 ) {
			ids.add( value );
		}
	};

	// Block JSON: "id":42 and "ids":[1,2,3] (galleries, columns, cover, media-text, etc.).
	for ( const match of content.matchAll( /"id"\s*:\s*(\d+)/g ) ) {
		add( match[ 1 ] );
	}
	for ( const match of content.matchAll( /"ids"\s*:\s*\[([\d,\s]*)\]/g ) ) {
		for ( const part of match[ 1 ].split( ',' ) ) {
			add( part.trim() );
		}
	}

	// Shortcodes: [gallery ids="1,2,3"], [playlist ids="4,5"], [caption id="attachment_6"].
	for ( const match of content.matchAll( /\bids\s*=\s*["']([\d,\s]+)["']/g ) ) {
		for ( const part of match[ 1 ].split( ',' ) ) {
			add( part.trim() );
		}
	}
	for ( const match of content.matchAll( /\bid\s*=\s*["'](?:attachment_)?(\d+)["']/g ) ) {
		add( match[ 1 ] );
	}

	// Class names: wp-image-42, wp-att-42 (classic editor / TinyMCE output).
	for ( const match of content.matchAll( /\bwp-(?:image|att)-(\d+)\b/g ) ) {
		add( match[ 1 ] );
	}

	return ids;
}

export function getUsedMediaIdsFromContent< TMedia extends SyncMediaItem >(
	contentValues: string[],
	mediaItems: TMedia[],
	featuredMediaIds: number[]
): Set< number > {
	const usedMediaIds = new Set< number >( featuredMediaIds.filter( Boolean ) );
	const contentBlob = contentValues.join( '\n' );
	const knownMediaIds = new Set( mediaItems.map( ( media ) => media.id ) );

	for ( const media of mediaItems ) {
		if ( getMediaUrls( media ).some( ( url ) => contentBlob.includes( url ) ) ) {
			usedMediaIds.add( media.id );
		}
	}

	for ( const referencedId of getMediaIdsReferencedById( contentBlob ) ) {
		if ( knownMediaIds.has( referencedId ) ) {
			usedMediaIds.add( referencedId );
		}
	}

	return usedMediaIds;
}

/**
 * Rewrite local attachment IDs to their uploaded remote IDs inside content.
 *
 * URL replacement alone is not enough: block JSON (`"id":42`, `"ids":[1,2]`) and `wp-image-N`
 * classes embed the numeric attachment ID, and a stale local ID on the remote site points at the
 * wrong (or a missing) attachment. We rewrite the structured references that WordPress actually
 * reads back when editing — block `id`/`ids` attributes and `wp-image-N` classes — leaving free
 * text untouched.
 */
export function rewriteMediaIdReferences(
	content: string,
	remoteIdByLocalId: Map< number, number >
): string {
	if ( remoteIdByLocalId.size === 0 ) {
		return content;
	}

	const remap = ( raw: string ): string => {
		const localId = Number.parseInt( raw, 10 );
		const remoteId = remoteIdByLocalId.get( localId );
		return remoteId ? String( remoteId ) : raw;
	};

	return (
		content
			// Block JSON single id: "id":42
			.replace( /("id"\s*:\s*)(\d+)/g, ( _full, prefix, id ) => `${ prefix }${ remap( id ) }` )
			// Block JSON / shortcode id list: "ids":[1,2,3] and ids="1,2,3"
			.replace(
				/("ids"\s*:\s*\[)([\d,\s]*)(\])/g,
				( _full, open, list, close ) =>
					`${ open }${ list.replace( /\d+/g, ( id: string ) => remap( id ) ) }${ close }`
			)
			.replace(
				/(\bids\s*=\s*["'])([\d,\s]+)(["'])/g,
				( _full, open, list, close ) =>
					`${ open }${ list.replace( /\d+/g, ( id: string ) => remap( id ) ) }${ close }`
			)
			// Shortcode single id: id="attachment_5" or id="5"
			.replace(
				/(\bid\s*=\s*["'])(attachment_)?(\d+)(["'])/g,
				( _full, open, prefix, id, close ) => `${ open }${ prefix ?? '' }${ remap( id ) }${ close }`
			)
			// Class names: wp-image-42, wp-att-42
			.replace(
				/\bwp-(image|att)-(\d+)\b/g,
				( _full, kind, id ) => `wp-${ kind }-${ remap( id ) }`
			)
	);
}

export function buildMediaUrlReplacementMap(
	localMedia: SyncMediaItem,
	remoteMedia: SyncMediaItem
): Map< string, string > {
	const replacements = new Map< string, string >();

	if ( localMedia.source_url && remoteMedia.source_url ) {
		replacements.set( localMedia.source_url, remoteMedia.source_url );
	}

	for ( const [ sizeName, localSize ] of Object.entries( localMedia.media_details?.sizes ?? {} ) ) {
		const remoteSizeUrl = remoteMedia.media_details?.sizes?.[ sizeName ]?.source_url;
		if ( localSize.source_url && remoteSizeUrl ) {
			replacements.set( localSize.source_url, remoteSizeUrl );
		}
	}

	if ( localMedia.link && remoteMedia.link ) {
		replacements.set( localMedia.link, remoteMedia.link );
	}

	return new Map( [ ...replacements.entries() ].sort( ( [ a ], [ b ] ) => b.length - a.length ) );
}

export function mergeMediaUrlReplacementMaps(
	maps: Array< Map< string, string > >
): Map< string, string > {
	return new Map(
		maps.flatMap( ( map ) => [ ...map.entries() ] ).sort( ( [ a ], [ b ] ) => b.length - a.length )
	);
}

export function replaceMediaUrls( value: string, replacements: Map< string, string > ): string {
	let nextValue = value;
	for ( const [ localUrl, remoteUrl ] of replacements ) {
		nextValue = nextValue.split( localUrl ).join( remoteUrl );
	}
	return nextValue;
}
