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

export function getUsedMediaIdsFromContent< TMedia extends SyncMediaItem >(
	contentValues: string[],
	mediaItems: TMedia[],
	featuredMediaIds: number[]
): Set< number > {
	const usedMediaIds = new Set< number >( featuredMediaIds.filter( Boolean ) );
	const contentBlob = contentValues.join( '\n' );

	for ( const media of mediaItems ) {
		if ( getMediaUrls( media ).some( ( url ) => contentBlob.includes( url ) ) ) {
			usedMediaIds.add( media.id );
		}
	}

	return usedMediaIds;
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
