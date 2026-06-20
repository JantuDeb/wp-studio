<?php
/**
 * Plugin Name: Studio Connector
 * Description: Provides an authenticated REST transport so WordPress Studio can sync (export, upload, and restore) self-hosted sites that do not expose SSH/WP-CLI. Implements the /wp-json/studio-connector/v1/ contract.
 * Version: 1.0.0
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * Author: Automattic
 * License: GPLv2 or later
 *
 * SECURITY: This plugin exposes site export and restore over HTTP. It MUST only be used over HTTPS,
 * authenticated with a strong bearer token, and is intended for staging/development workflows.
 * Production database/file restore is intentionally gated and should be reviewed before enabling.
 *
 * @package StudioConnector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'STUDIO_CONNECTOR_VERSION', '1.0.0' );
define( 'STUDIO_CONNECTOR_NAMESPACE', 'studio-connector/v1' );
// Option holding the bearer token (a hash, never the raw token).
define( 'STUDIO_CONNECTOR_TOKEN_OPTION', 'studio_connector_token_hash' );
// Working directory for export/upload archives, under uploads/.
define( 'STUDIO_CONNECTOR_WORK_DIRNAME', 'studio-connector' );

/**
 * Resolve the connector working directory inside wp-content/uploads, creating it and protecting it
 * from direct web access.
 */
function studio_connector_work_dir() {
	$uploads = wp_upload_dir();
	$dir     = trailingslashit( $uploads['basedir'] ) . STUDIO_CONNECTOR_WORK_DIRNAME;
	if ( ! is_dir( $dir ) ) {
		wp_mkdir_p( $dir );
		// Block direct access to archives; downloads are served through the authenticated endpoint.
		@file_put_contents( $dir . '/.htaccess', "Require all denied\n" ); // phpcs:ignore
		@file_put_contents( $dir . '/index.php', "<?php\n// Silence is golden.\n" ); // phpcs:ignore
	}
	return $dir;
}

/**
 * Constant-time bearer-token check. The raw token is provided once during setup and only its hash is
 * stored; requests present the raw token, which we hash and compare.
 */
function studio_connector_authorize( WP_REST_Request $request ) {
	$stored_hash = get_option( STUDIO_CONNECTOR_TOKEN_OPTION, '' );
	if ( empty( $stored_hash ) ) {
		return new WP_Error(
			'studio_connector_not_configured',
			__( 'The Studio Connector token has not been configured.', 'studio-connector' ),
			array( 'status' => 503 )
		);
	}

	$header = $request->get_header( 'authorization' );
	if ( ! $header || stripos( $header, 'Bearer ' ) !== 0 ) {
		return new WP_Error(
			'studio_connector_unauthorized',
			__( 'Missing bearer token.', 'studio-connector' ),
			array( 'status' => 401 )
		);
	}

	$token = trim( substr( $header, 7 ) );
	if ( ! hash_equals( $stored_hash, hash( 'sha256', $token ) ) ) {
		return new WP_Error(
			'studio_connector_unauthorized',
			__( 'Invalid bearer token.', 'studio-connector' ),
			array( 'status' => 401 )
		);
	}

	return true;
}

/**
 * Whether destructive (database/file) restore is permitted for this environment. Production is
 * blocked by default; a site owner may opt in via the `studio_connector_allow_production_restore`
 * filter after their own review.
 */
function studio_connector_restore_allowed() {
	$env = function_exists( 'wp_get_environment_type' ) ? wp_get_environment_type() : 'production';
	$allowed = 'production' !== $env;
	/**
	 * Filter whether the connector may restore database/files.
	 *
	 * @param bool   $allowed Default: true for non-production environments.
	 * @param string $env     The detected environment type.
	 */
	return (bool) apply_filters( 'studio_connector_allow_production_restore', $allowed, $env );
}

add_action( 'rest_api_init', 'studio_connector_register_routes' );

/**
 * Register the connector REST routes.
 */
function studio_connector_register_routes() {
	register_rest_route(
		STUDIO_CONNECTOR_NAMESPACE,
		'/status',
		array(
			'methods'             => 'GET',
			'callback'            => 'studio_connector_status',
			'permission_callback' => 'studio_connector_authorize',
		)
	);

	register_rest_route(
		STUDIO_CONNECTOR_NAMESPACE,
		'/exports',
		array(
			'methods'             => 'POST',
			'callback'            => 'studio_connector_create_export',
			'permission_callback' => 'studio_connector_authorize',
		)
	);

	register_rest_route(
		STUDIO_CONNECTOR_NAMESPACE,
		'/download/(?P<file>[A-Za-z0-9._-]+)',
		array(
			'methods'             => 'GET',
			'callback'            => 'studio_connector_download_export',
			'permission_callback' => 'studio_connector_authorize',
		)
	);

	register_rest_route(
		STUDIO_CONNECTOR_NAMESPACE,
		'/archives',
		array(
			'methods'             => 'POST',
			'callback'            => 'studio_connector_upload_archive',
			'permission_callback' => 'studio_connector_authorize',
		)
	);

	register_rest_route(
		STUDIO_CONNECTOR_NAMESPACE,
		'/archives/(?P<archive_id>[A-Za-z0-9._-]+)/restore',
		array(
			'methods'             => 'POST',
			'callback'            => 'studio_connector_restore_archive',
			'permission_callback' => 'studio_connector_authorize',
		)
	);
}

/**
 * GET /status — report versions and capabilities.
 */
function studio_connector_status() {
	return new WP_REST_Response(
		array(
			'plugin_version'    => STUDIO_CONNECTOR_VERSION,
			'wordpress_version' => get_bloginfo( 'version' ),
			'php_version'       => PHP_VERSION,
			'site_url'          => site_url(),
			'home_url'          => home_url(),
			'can_export'        => true,
			'can_restore'       => studio_connector_restore_allowed(),
			'environment_type'  => function_exists( 'wp_get_environment_type' ) ? wp_get_environment_type() : 'production',
		),
		200
	);
}

/**
 * Validate that a candidate path stays inside the connector working directory (defense against
 * path traversal in the `archive_id`/`file` route segments).
 */
function studio_connector_path_in_workdir( $path ) {
	$work = studio_connector_work_dir();
	$real = realpath( $path );
	return $real && strpos( $real, realpath( $work ) ) === 0;
}

/**
 * POST /exports — build a .tar.gz containing the database dump and wp-content, return a download URL.
 */
function studio_connector_create_export( WP_REST_Request $request ) {
	$params       = $request->get_json_params();
	$include_db   = ! isset( $params['database'] ) || (bool) $params['database'];
	$include_wpc  = ! isset( $params['wp_content'] ) || (bool) $params['wp_content'];
	$work         = studio_connector_work_dir();
	$archive_id   = 'studio-export-' . gmdate( 'Ymd-His' ) . '-' . wp_generate_password( 8, false ) . '.tar.gz';
	$archive_path = $work . '/' . $archive_id;
	$staging      = $work . '/stage-' . wp_generate_password( 12, false );

	if ( ! wp_mkdir_p( $staging . '/sql' ) || ! wp_mkdir_p( $staging . '/wp-content' ) ) {
		return new WP_Error( 'studio_connector_export_failed', 'Could not create staging directory.', array( 'status' => 500 ) );
	}

	try {
		if ( $include_db ) {
			$sql = studio_connector_export_database();
			if ( is_wp_error( $sql ) ) {
				return $sql;
			}
			file_put_contents( $staging . '/sql/database.sql', $sql ); // phpcs:ignore
		}

		if ( $include_wpc ) {
			studio_connector_copy_tree( WP_CONTENT_DIR, $staging . '/wp-content' );
		}

		$result = studio_connector_make_targz( $staging, $archive_path );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
	} finally {
		studio_connector_rmtree( $staging );
	}

	$download_url = rest_url( STUDIO_CONNECTOR_NAMESPACE . '/download/' . rawurlencode( $archive_id ) );
	return new WP_REST_Response(
		array(
			'archive_id'   => $archive_id,
			'download_url' => $download_url,
			'size'         => filesize( $archive_path ),
		),
		200
	);
}

/**
 * GET /download/{file} — stream a previously created export archive, then delete it.
 */
function studio_connector_download_export( WP_REST_Request $request ) {
	$file = $request['file'];
	$path = studio_connector_work_dir() . '/' . $file;

	if ( ! preg_match( '/^studio-export-[A-Za-z0-9.-]+\.tar\.gz$/', $file ) || ! studio_connector_path_in_workdir( $path ) || ! file_exists( $path ) ) {
		return new WP_Error( 'studio_connector_not_found', 'Export not found.', array( 'status' => 404 ) );
	}

	nocache_headers();
	header( 'Content-Type: application/gzip' );
	header( 'Content-Length: ' . filesize( $path ) );
	header( 'Content-Disposition: attachment; filename="' . basename( $path ) . '"' );
	readfile( $path ); // phpcs:ignore
	wp_delete_file( $path );
	exit;
}

/**
 * POST /archives — accept an application/gzip body, store it, and return an archive_id.
 */
function studio_connector_upload_archive( WP_REST_Request $request ) {
	$body = $request->get_body();
	if ( empty( $body ) ) {
		return new WP_Error( 'studio_connector_empty_upload', 'No archive body received.', array( 'status' => 400 ) );
	}

	$archive_id   = 'studio-upload-' . gmdate( 'Ymd-His' ) . '-' . wp_generate_password( 8, false ) . '.tar.gz';
	$archive_path = studio_connector_work_dir() . '/' . $archive_id;

	if ( false === file_put_contents( $archive_path, $body ) ) { // phpcs:ignore
		return new WP_Error( 'studio_connector_upload_failed', 'Could not store the uploaded archive.', array( 'status' => 500 ) );
	}

	return new WP_REST_Response(
		array(
			'archive_id' => $archive_id,
			'size'       => filesize( $archive_path ),
		),
		200
	);
}

/**
 * POST /archives/{archive_id}/restore — back up, then restore the requested parts from an uploaded
 * archive. Blocked when restore is not allowed for this environment.
 */
function studio_connector_restore_archive( WP_REST_Request $request ) {
	if ( ! studio_connector_restore_allowed() ) {
		return new WP_Error(
			'studio_connector_restore_disabled',
			'Restore is disabled for this environment.',
			array( 'status' => 403 )
		);
	}

	$archive_id = $request['archive_id'];
	$path       = studio_connector_work_dir() . '/' . $archive_id;
	if ( ! preg_match( '/^studio-upload-[A-Za-z0-9.-]+\.tar\.gz$/', $archive_id ) || ! studio_connector_path_in_workdir( $path ) || ! file_exists( $path ) ) {
		return new WP_Error( 'studio_connector_not_found', 'Archive not found.', array( 'status' => 404 ) );
	}

	$params       = $request->get_json_params();
	$restore_db   = ! isset( $params['database'] ) || (bool) $params['database'];
	$restore_wpc  = ! isset( $params['wp_content'] ) || (bool) $params['wp_content'];
	$make_backup  = ! isset( $params['create_backup'] ) || (bool) $params['create_backup'];

	$backup_id = null;
	if ( $make_backup ) {
		$backup = studio_connector_create_export( $request );
		if ( is_wp_error( $backup ) ) {
			return $backup;
		}
		$backup_id = $backup->get_data()['archive_id'];
	}

	$extract = studio_connector_work_dir() . '/restore-' . wp_generate_password( 12, false );
	if ( ! wp_mkdir_p( $extract ) ) {
		return new WP_Error( 'studio_connector_restore_failed', 'Could not create extraction directory.', array( 'status' => 500 ) );
	}

	try {
		$extracted = studio_connector_extract_targz( $path, $extract );
		if ( is_wp_error( $extracted ) ) {
			return $extracted;
		}

		if ( $restore_db ) {
			$sql_file = studio_connector_find_first( $extract, 'database.sql' );
			if ( $sql_file ) {
				$imported = studio_connector_import_database(
					$sql_file,
					isset( $params['source_url'] ) ? (string) $params['source_url'] : '',
					isset( $params['target_url'] ) ? (string) $params['target_url'] : site_url()
				);
				if ( is_wp_error( $imported ) ) {
					return $imported;
				}
			}
		}

		if ( $restore_wpc ) {
			$wpc = studio_connector_find_dir( $extract, 'wp-content' );
			if ( $wpc ) {
				studio_connector_copy_tree( $wpc, WP_CONTENT_DIR );
			}
		}
	} finally {
		studio_connector_rmtree( $extract );
		wp_delete_file( $path );
	}

	return new WP_REST_Response(
		array(
			'success'   => true,
			'backup_id' => $backup_id,
		),
		200
	);
}

/* -------------------------------------------------------------------------- *
 * Helpers: database, archives, filesystem.
 * -------------------------------------------------------------------------- */

/**
 * Export the database to a SQL string. Prefers the `mysqldump` binary; falls back to a pure-PHP dump
 * via $wpdb when exec is unavailable.
 */
function studio_connector_export_database() {
	global $wpdb;

	if ( studio_connector_can_exec() ) {
		$tmp = tempnam( sys_get_temp_dir(), 'studio-db-' );
		$cmd = sprintf(
			'mysqldump --no-tablespaces --single-transaction --host=%s --user=%s --password=%s %s 2>/dev/null > %s',
			escapeshellarg( DB_HOST ),
			escapeshellarg( DB_USER ),
			escapeshellarg( DB_PASSWORD ),
			escapeshellarg( DB_NAME ),
			escapeshellarg( $tmp )
		);
		exec( $cmd, $out, $code ); // phpcs:ignore
		if ( 0 === $code && filesize( $tmp ) > 0 ) {
			$sql = file_get_contents( $tmp ); // phpcs:ignore
			wp_delete_file( $tmp );
			return $sql;
		}
		wp_delete_file( $tmp );
	}

	// Pure-PHP fallback: dump every table with CREATE + INSERT statements.
	$sql    = "-- Studio Connector PHP dump\nSET FOREIGN_KEY_CHECKS=0;\n";
	$tables = $wpdb->get_col( 'SHOW TABLES' ); // phpcs:ignore
	foreach ( $tables as $table ) {
		$create = $wpdb->get_row( "SHOW CREATE TABLE `{$table}`", ARRAY_N ); // phpcs:ignore
		$sql   .= "\nDROP TABLE IF EXISTS `{$table}`;\n" . $create[1] . ";\n";
		$rows   = $wpdb->get_results( "SELECT * FROM `{$table}`", ARRAY_A ); // phpcs:ignore
		foreach ( $rows as $row ) {
			$values = array_map(
				function ( $value ) use ( $wpdb ) {
					return null === $value ? 'NULL' : "'" . esc_sql( $value ) . "'";
				},
				array_values( $row )
			);
			$sql .= "INSERT INTO `{$table}` VALUES (" . implode( ',', $values ) . ");\n";
		}
	}
	$sql .= "SET FOREIGN_KEY_CHECKS=1;\n";
	return $sql;
}

/**
 * Import a SQL dump, optionally search-replacing the source URL with the target URL afterwards.
 */
function studio_connector_import_database( $sql_file, $source_url, $target_url ) {
	global $wpdb;
	$sql = file_get_contents( $sql_file ); // phpcs:ignore
	if ( false === $sql ) {
		return new WP_Error( 'studio_connector_restore_failed', 'Could not read the database dump.', array( 'status' => 500 ) );
	}

	// Execute statements. dbDelta is unsuitable for arbitrary dumps, so run them directly, split on
	// semicolons at line ends (sufficient for mysqldump output).
	foreach ( preg_split( '/;\s*\n/', $sql ) as $statement ) {
		$statement = trim( $statement );
		if ( '' === $statement || strpos( $statement, '--' ) === 0 ) {
			continue;
		}
		$wpdb->query( $statement ); // phpcs:ignore
	}

	if ( $source_url && $target_url && $source_url !== $target_url ) {
		studio_connector_search_replace_url( $source_url, $target_url );
	}

	wp_cache_flush();
	return true;
}

/**
 * Replace the source site URL with the target URL across the common WordPress option/content tables.
 * This is a best-effort, non-serialized-aware replacement for the canonical URLs; deep serialized
 * replacement is left to WP-CLI workflows.
 */
function studio_connector_search_replace_url( $source_url, $target_url ) {
	global $wpdb;
	$source = untrailingslashit( $source_url );
	$target = untrailingslashit( $target_url );

	$wpdb->query( $wpdb->prepare( "UPDATE {$wpdb->options} SET option_value = %s WHERE option_name IN ('siteurl','home')", $target ) ); // phpcs:ignore
	$wpdb->query( $wpdb->prepare( "UPDATE {$wpdb->posts} SET guid = REPLACE(guid, %s, %s)", $source, $target ) ); // phpcs:ignore
	$wpdb->query( $wpdb->prepare( "UPDATE {$wpdb->posts} SET post_content = REPLACE(post_content, %s, %s)", $source, $target ) ); // phpcs:ignore
}

/**
 * Whether shell exec functions are available and not disabled.
 */
function studio_connector_can_exec() {
	if ( ! function_exists( 'exec' ) ) {
		return false;
	}
	$disabled = array_map( 'trim', explode( ',', (string) ini_get( 'disable_functions' ) ) );
	return ! in_array( 'exec', $disabled, true );
}

/**
 * Create a gzipped tarball of $source_dir's contents at $archive_path. Uses PharData.
 */
function studio_connector_make_targz( $source_dir, $archive_path ) {
	if ( ! class_exists( 'PharData' ) ) {
		return new WP_Error( 'studio_connector_no_phar', 'PharData is not available on this host.', array( 'status' => 500 ) );
	}
	$tar = preg_replace( '/\.gz$/', '', $archive_path );
	try {
		$phar = new PharData( $tar );
		$phar->buildFromDirectory( $source_dir );
		$phar->compress( Phar::GZ );
		unset( $phar );
		if ( file_exists( $tar ) ) {
			wp_delete_file( $tar );
		}
	} catch ( Exception $e ) {
		return new WP_Error( 'studio_connector_archive_failed', $e->getMessage(), array( 'status' => 500 ) );
	}
	return true;
}

/**
 * Extract a .tar.gz into $dest. Uses PharData.
 */
function studio_connector_extract_targz( $archive_path, $dest ) {
	if ( ! class_exists( 'PharData' ) ) {
		return new WP_Error( 'studio_connector_no_phar', 'PharData is not available on this host.', array( 'status' => 500 ) );
	}
	try {
		$phar = new PharData( $archive_path );
		$phar->extractTo( $dest, null, true );
	} catch ( Exception $e ) {
		return new WP_Error( 'studio_connector_extract_failed', $e->getMessage(), array( 'status' => 500 ) );
	}
	return true;
}

/**
 * Recursively copy a directory tree.
 */
function studio_connector_copy_tree( $source, $dest ) {
	if ( ! is_dir( $source ) ) {
		return;
	}
	wp_mkdir_p( $dest );
	$items = new RecursiveIteratorIterator(
		new RecursiveDirectoryIterator( $source, FilesystemIterator::SKIP_DOTS ),
		RecursiveIteratorIterator::SELF_FIRST
	);
	foreach ( $items as $item ) {
		$target = $dest . '/' . $items->getSubPathName();
		if ( $item->isDir() ) {
			wp_mkdir_p( $target );
		} else {
			copy( $item->getPathname(), $target );
		}
	}
}

/**
 * Recursively remove a directory tree.
 */
function studio_connector_rmtree( $dir ) {
	if ( ! is_dir( $dir ) ) {
		return;
	}
	$items = new RecursiveIteratorIterator(
		new RecursiveDirectoryIterator( $dir, FilesystemIterator::SKIP_DOTS ),
		RecursiveIteratorIterator::CHILD_FIRST
	);
	foreach ( $items as $item ) {
		if ( $item->isDir() ) {
			rmdir( $item->getPathname() ); // phpcs:ignore
		} else {
			wp_delete_file( $item->getPathname() );
		}
	}
	rmdir( $dir ); // phpcs:ignore
}

/**
 * Find the first file with $name anywhere under $dir.
 */
function studio_connector_find_first( $dir, $name ) {
	$items = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $dir, FilesystemIterator::SKIP_DOTS ) );
	foreach ( $items as $item ) {
		if ( $item->isFile() && $item->getFilename() === $name ) {
			return $item->getPathname();
		}
	}
	return null;
}

/**
 * Find the first directory named $name under $dir.
 */
function studio_connector_find_dir( $dir, $name ) {
	$items = new RecursiveIteratorIterator(
		new RecursiveDirectoryIterator( $dir, FilesystemIterator::SKIP_DOTS ),
		RecursiveIteratorIterator::SELF_FIRST
	);
	foreach ( $items as $item ) {
		if ( $item->isDir() && $item->getFilename() === $name ) {
			return $item->getPathname();
		}
	}
	return null;
}

/* -------------------------------------------------------------------------- *
 * Admin: token management.
 * -------------------------------------------------------------------------- */

add_action( 'admin_menu', 'studio_connector_admin_menu' );

/**
 * Register the Settings → Studio Connector page.
 */
function studio_connector_admin_menu() {
	add_options_page(
		__( 'Studio Connector', 'studio-connector' ),
		__( 'Studio Connector', 'studio-connector' ),
		'manage_options',
		'studio-connector',
		'studio_connector_render_settings'
	);
}

/**
 * Render the settings page, generating a new token on demand. The raw token is shown once.
 */
function studio_connector_render_settings() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}

	$new_token = null;
	if ( isset( $_POST['studio_connector_generate'] ) && check_admin_referer( 'studio_connector_token' ) ) {
		$new_token = wp_generate_password( 48, false );
		update_option( STUDIO_CONNECTOR_TOKEN_OPTION, hash( 'sha256', $new_token ) );
	}
	if ( isset( $_POST['studio_connector_revoke'] ) && check_admin_referer( 'studio_connector_token' ) ) {
		delete_option( STUDIO_CONNECTOR_TOKEN_OPTION );
	}

	$configured = (bool) get_option( STUDIO_CONNECTOR_TOKEN_OPTION, '' );
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'Studio Connector', 'studio-connector' ); ?></h1>
		<p><?php esc_html_e( 'Generate a token and paste it into WordPress Studio when adding a connector connection. The token is shown only once.', 'studio-connector' ); ?></p>
		<?php if ( $new_token ) : ?>
			<div class="notice notice-success"><p>
				<strong><?php esc_html_e( 'New token (copy it now):', 'studio-connector' ); ?></strong>
				<code><?php echo esc_html( $new_token ); ?></code>
			</p></div>
		<?php endif; ?>
		<p><strong><?php esc_html_e( 'Status:', 'studio-connector' ); ?></strong>
			<?php echo $configured ? esc_html__( 'A token is configured.', 'studio-connector' ) : esc_html__( 'No token configured.', 'studio-connector' ); ?>
		</p>
		<form method="post">
			<?php wp_nonce_field( 'studio_connector_token' ); ?>
			<p>
				<button type="submit" name="studio_connector_generate" class="button button-primary">
					<?php echo $configured ? esc_html__( 'Regenerate token', 'studio-connector' ) : esc_html__( 'Generate token', 'studio-connector' ); ?>
				</button>
				<?php if ( $configured ) : ?>
					<button type="submit" name="studio_connector_revoke" class="button">
						<?php esc_html_e( 'Revoke token', 'studio-connector' ); ?>
					</button>
				<?php endif; ?>
			</p>
		</form>
	</div>
	<?php
}
