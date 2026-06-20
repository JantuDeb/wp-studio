# Studio Connector (WordPress plugin)

A separately deployable WordPress plugin that lets **WordPress Studio** sync self-hosted sites that
do **not** expose SSH/WP-CLI. It implements the desktop side's documented connector transport at
`/wp-json/studio-connector/v1/`.

> ⚠️ This plugin exposes site **export** and **restore** over HTTP. Use it only over HTTPS,
> authenticated with a strong bearer token, and preferably against staging/development sites.
> Production database/file restore is blocked by default (see _Production safety_ below).

## Installation

1. Copy the `studio-connector` directory into the remote site's `wp-content/plugins/`.
2. Activate **Studio Connector** in **Plugins**.
3. Go to **Settings → Studio Connector**, click **Generate token**, and copy the token shown once.
4. In WordPress Studio, add a **Connector** connection for the site and paste the token.

## REST contract

All endpoints require an `Authorization: Bearer <token>` header. The raw token is never stored —
only its SHA-256 hash is kept in the `studio_connector_token_hash` option.

| Method & path | Purpose | Response |
| --- | --- | --- |
| `GET /wp-json/studio-connector/v1/status` | Versions + capabilities | `plugin_version`, `wordpress_version`, `can_export`, `can_restore`, … |
| `POST /wp-json/studio-connector/v1/exports` | Build a `.tar.gz` of the DB dump + `wp-content` | `archive_id`, `download_url`, `size` |
| `GET  /wp-json/studio-connector/v1/download/{file}` | Stream then delete a created export | binary `application/gzip` |
| `POST /wp-json/studio-connector/v1/archives` | Accept an `application/gzip` upload | `archive_id`, `size` |
| `POST /wp-json/studio-connector/v1/archives/{archive_id}/restore` | Back up, then restore requested parts | `success`, `backup_id` |

Request bodies (JSON) accept `database` and `wp_content` booleans; `restore` also accepts
`create_backup`, `source_url`, and `target_url` (for a best-effort URL search-replace after import).

Archive layout matches Studio's interchange format: a gzipped tarball containing `sql/database.sql`
and a `wp-content/` tree.

## Production safety

`can_restore` and the restore endpoint are disabled when `wp_get_environment_type()` is
`production`. A site owner who has reviewed the implications can opt in:

```php
add_filter( 'studio_connector_allow_production_restore', '__return_true' );
```

## Implementation notes & limitations

- Database export prefers the `mysqldump` binary and falls back to a pure-PHP `$wpdb` dump when
  `exec` is unavailable.
- Archiving uses `PharData` (gzip tarballs).
- URL search-replace covers canonical option/post URLs only; it is **not** serialized-data aware.
  For deep replacement, prefer a WP-CLI workflow.
- Export/upload archives live under `wp-content/uploads/studio-connector/`, protected from direct
  web access by `.htaccess`; downloads are served only through the authenticated endpoint and the
  archive is deleted after a successful download/restore.

This plugin is a reference implementation of the contract Studio expects and should undergo a
security review before any production use.
