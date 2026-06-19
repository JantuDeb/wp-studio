# Self-Hosted Sync Phase 2 Checklist

## Scope

Phase 2 adds a first-class self-hosted connection flow without enabling self-hosted sync operations yet. WordPress.com and Pressable sync remain available through the existing provider and UI path.

## Completed

- [x] Added generic `syncConnections` storage in `shared.json`, keyed by local site ID.
- [x] Kept existing `connectedWpcomSites` storage unchanged for WordPress.com and Pressable.
- [x] Added locked shared-config helpers for saving, listing, and deleting generic sync connections.
- [x] Added IPC handlers for:
  - [x] `getSyncConnections`
  - [x] `saveSyncConnection`
  - [x] `deleteSyncConnection`
  - [x] `testSyncConnection`
- [x] Added a connect-modal first screen for choosing:
  - [x] Self-hosted WordPress
  - [x] WordPress.com / Pressable
- [x] Added a self-hosted connection form with:
  - [x] Site URL
  - [x] Environment type
  - [x] Sync mode
  - [x] REST API username and Application Password fields
  - [x] SSH + WP-CLI fields
  - [x] Connector plugin token field
- [x] Added REST API connection testing using `/wp-json/`.
- [x] Added a simple self-hosted connections list in the Sync tab.
- [x] Allowed self-hosted connections without WordPress.com authentication.

## Not Implemented Yet

- [ ] REST content push for posts, pages, media, terms, and post meta.
- [ ] Connector plugin connection testing.
- [x] SSH/WP-CLI pull to local Studio site.
- [ ] Self-hosted push operations.
- [ ] Production database push.

## Guardrails

- [x] WordPress.com / Pressable behavior is preserved.
- [x] Full-sync providers still advertise `canPushToProduction: false`.
- [x] The UI states that connector testing is not available yet.
- [x] REST testing only verifies that the remote site exposes a WordPress REST API index.
- [x] Self-hosted auth fields are stripped from `shared.json` and stored in encrypted Studio app data.
- [x] Saved self-hosted connections can be edited to update site metadata or replace credentials.
- [x] SSH + WP-CLI connection testing verifies password or private-key SSH auth, the remote WordPress path, and `wp core version`.
- [x] SSH pull downloads database and `wp-content` from the configured WordPress path only.

## Follow-Up PRs

- [x] Add secure credential storage or encryption before production use.
- [x] Implement REST content-only push and default remote writes to draft.
- [x] Add SSH/WP-CLI preflight checks.
- [ ] Add connector plugin discovery and token validation.
- [ ] Reuse existing import/export archive code for full sync.
- [ ] Add production push dry-run, backup, and typed-confirmation requirements.

## Phase 3 Addendum

The REST content push MVP now pushes posts and pages from a local Studio site to a saved `self-hosted-rest` connection. Remote writes default to drafts.

Included:

- [x] Fetch local posts and pages through the local WordPress REST API.
- [x] Fetch local categories and tags.
- [x] Create or reuse remote categories and tags by slug.
- [x] Preserve category/tag descriptions and category parent hierarchy.
- [x] Detect media used as featured images or exact URLs in post/page content.
- [x] Detect media used through generated image size URLs from `srcset`.
- [x] Upload detected media to the remote site.
- [x] Replace local original, generated-size, and attachment-link URLs in content and excerpts with uploaded remote URLs.
- [x] Let users select which local posts/pages to push.
- [x] Preview whether selected posts/pages will create, update, or conflict before pushing.
- [x] Block pushes that would overwrite unmapped remote content with the same slug.
- [x] Create or update remote posts/pages by stored remote ID or slug.
- [x] Store remote post/page IDs in local post meta after a successful push.
- [x] Keep pushed posts/pages as drafts unless publish is explicitly requested by code.

Still pending:

- [ ] Rich media reference detection for galleries, block attributes, and attachment references that do not contain a known local media URL.
- [ ] Featured image metadata parity beyond title, alt text, caption, and description.
- [ ] Tests for the main-process content push pipeline.

## Credential Storage Addendum

Self-hosted connection metadata remains in `shared.json` so Studio and CLI-facing code can list saved connections without WordPress.com authentication. Sensitive auth metadata is not written there.

Included:

- [x] Made self-hosted connection auth optional for stored connection metadata.
- [x] Added explicit runtime connection schemas that require auth before remote operations.
- [x] Store REST Application Passwords, SSH private keys, and connector tokens in Studio app data.
- [x] Encrypt stored auth values with Electron `safeStorage`.
- [x] Use app config locking when writing credential records.
- [x] Hydrate credentials only in the main process for REST connection tests, push previews, and pushes.
- [x] Delete encrypted credentials when a sync connection is removed.

Still pending:

- [ ] CLI access to encrypted self-hosted credentials, if CLI-managed self-hosted sync becomes required.
- [x] Credential rotation/edit UI for saved self-hosted connections.

## SSH Preflight Addendum

SSH + WP-CLI sync still does not pull or push site data. The current preflight only validates that Studio can reach the remote server and run WP-CLI against the configured WordPress path.

Included:

- [x] Test SSH auth with host, port, username, password, private key path, or pasted private key text.
- [x] Use a Node SSH client so password auth does not require shell prompts or `sshpass`.
- [x] Run SSH with a connection timeout.
- [x] Verify the remote WordPress directory exists.
- [x] Run `wp core version` with the configured WP-CLI path or `wp`.
- [x] Keep preflight commands scoped to the user-provided WordPress path.

Still pending:

- [x] Pull remote database with `wp db export`.
- [x] Archive and download remote `wp-content` parts.
- [x] Reuse Studio import code to restore the archive locally.
- [ ] Staging push with backup and selected restore parts.

## SSH Pull Addendum

The first SSH sync operation pulls a remote site into an existing local Studio site. It does not push local files or database changes to the remote server.

Included:

- [x] Create the remote working directory under the configured WordPress path.
- [x] Export the remote database with `wp db export`.
- [x] Copy remote `wp-content` into a Local-compatible archive layout.
- [x] Download the archive over SFTP.
- [x] Remove the remote temporary working directory after download.
- [x] Import the downloaded archive with Studio's existing import flow.
- [x] Show a confirmation warning before replacing local site content.

Still pending:

- [x] Selective pull parts for database, plugins, themes, uploads, and other `wp-content` folders.
- [ ] Progress events for remote export, SFTP download, and import phases.
- [ ] Remote archive size estimate before download.
- [ ] Better remote cleanup reporting if cleanup fails.

## Shared Sync Selection Addendum

SSH pull now reuses the same top-level sync tree and file/folder tree primitives as the existing WordPress.com sync dialog.

Included:

- [x] Choose database independently from files and folders.
- [x] Browse the remote `wp-content` tree over SFTP.
- [x] Select a complete `wp-content` pull or specific files and directories.
- [x] Restrict listing and archive paths to the user-configured WordPress path and its `wp-content` directory.
- [x] Reject absolute/traversal selections before building remote commands.
- [x] Keep full pulls on the existing replacement import path.
- [x] Use the existing Jetpack merge importer for partial file pulls so unrelated local files are preserved.
- [x] Keep provider-specific execution behind SSH IPC handlers while sharing selection UI primitives.

Still pending:

- [ ] Extract the complete WP.com and SSH dialog shell into a provider-neutral sync dialog component.
- [x] Add SSH staging push using the same selection model, with mandatory backup.
- [ ] Disable database push for production until backup, dry-run, and typed confirmation exist.

## SSH Staging Push Addendum

SSH connections marked as staging or development can push selected local data. Production SSH push remains disabled.

Included:

- [x] Reuse Studio's existing export pipeline for full, database-only, files-only, and selected-path archives.
- [x] Reuse the shared database/files tree for SSH pull and push.
- [x] Upload the local archive over SFTP into a temporary directory under the configured WordPress path.
- [x] Create a remote backup before modifying selected files or the database.
- [x] Retain the backup under `<wordpress-path>/.studio-backups/`.
- [x] Replace selected remote paths while leaving unselected paths unchanged.
- [x] Reset and import the remote database only when database sync is selected.
- [x] Run local-to-remote URL search-replace after database import.
- [x] Flush the remote object cache when WP-CLI supports it.
- [x] Remove temporary remote and local push files after completion or failure.
- [x] Reject SSH push for production connections in both the renderer and main process.

Still pending:

- [x] Backup browser and one-click rollback.
- [x] Push dry-run with remote archive size and disk-space estimates.
- [ ] Progress events for export, upload, backup, restore, and search-replace.
- [ ] Production file push policy; production database push remains disabled.

## SSH Backup Restore Addendum

Studio can list and restore backups created by guarded SSH pushes for staging and development connections.

Included:

- [x] Write a JSON sidecar manifest for each new SSH push backup.
- [x] Record database inclusion and exact `wp-content` selection paths.
- [x] List valid backup/archive pairs from `<wordpress-path>/.studio-backups/`.
- [x] Show backup timestamp, scope, and archive size.
- [x] Allow production connections to browse backups while keeping restore disabled.
- [x] Restore only the database and paths recorded in the backup manifest.
- [x] Remove a selected path during rollback when it did not exist before the original push.
- [x] Create and retain a pre-restore safety backup before applying rollback.
- [x] Reject malformed backup identifiers, paths outside the backup directory, and production restores.

Limitations:

- Backups created before manifests were introduced are not shown.
- Individual deletion and keep-latest-five retention are supported; automatic age/size policy is not.
- Restore progress and automatic verification are still pending.

## SSH Push Preflight Addendum

Every SSH staging/development push now runs a preflight before confirmation.

Included:

- [x] Build the same local archive that will be used for the push and report its size.
- [x] Estimate the scoped remote backup using WP-CLI database size and selected-path disk usage.
- [x] Check available disk space on the remote WordPress filesystem.
- [x] Reserve an additional 100 MB working margin.
- [x] Block the push before upload when estimated required space exceeds available space.
- [x] Show archive size, backup estimate, available space, database inclusion, and selected path count.
- [x] Delete the temporary preview archive after preflight.
- [x] Delete individual backup archive/manifest pairs.
- [x] Keep the five newest backups and delete older pairs after confirmation.

Still pending:

- [ ] Automatic age- or size-based backup retention.
- [x] Transfer and remote command progress reporting.

## SSH Progress And Verification Addendum

SSH pull, push, and backup restore now report operation progress in the self-hosted connection card.

Included:

- [x] Provider-specific progress events keyed by local site and connection.
- [x] Pull phases for remote preparation, download, local import, completion, and failure.
- [x] Push phases for local export, upload percentage, remote backup/apply, verification, and failure.
- [x] Restore phases for preparation, safety backup, restore, verification, and failure.
- [x] Post-push and post-restore WordPress core version check.
- [x] Database integrity check through WP-CLI.
- [x] `siteurl` and `home` comparison with the configured connection URL.
- [x] Active plugin count reporting.
- [x] Explicit verification warnings instead of reporting unverified operations as fully successful.

Still pending:

- [x] Automatic rollback when post-push or component-update verification fails.
- [x] Plugin/theme update and maintenance management.
- [x] Remote cron, debug-log, and cache maintenance dashboard.
- [ ] Vulnerability data and remote uptime monitoring.

## SSH Site Management Addendum

SSH connections now include a remote WordPress management dashboard.

Included:

- [x] WordPress core and PHP version display.
- [x] Plugin and theme inventory with available update versions.
- [x] Due cron event count.
- [x] Remote debug-log presence and size.
- [x] Confirmed remote object-cache flush.
- [x] Confirmed execution of due WordPress cron events.
- [x] Individual plugin and theme updates for staging/development.
- [x] Database plus selected component backup before each plugin/theme update.
- [x] Backups use the existing manifest format and are available in the backup browser.
- [x] Post-update database verification.
- [x] Production plugin/theme updates blocked in both UI and main process.
- [x] Strict plugin/theme slug validation before shell command construction.
- [x] Automatic restoration of the pre-operation backup when verification fails.
- [x] Retain a failed-state safety backup before automatic rollback.

Still pending:

- [ ] Bulk update selection.
- [ ] WordPress core update workflow.
- [ ] Vulnerability/advisory integration.
- [ ] Debug-log viewer and clearing controls.
- [ ] Uptime and HTTP response monitoring.
- [ ] Automatic rollback for manually selected backup restores.

## SSH Integration Test Addendum

An opt-in Docker integration environment validates SSH transport and remote backup behavior against a real WordPress installation, MariaDB, OpenSSH, and WP-CLI.

Included:

- [x] Disposable WordPress and MariaDB Compose fixture.
- [x] Password-authenticated unprivileged SSH account.
- [x] Real WordPress database export and import through WP-CLI.
- [x] Selective plugin-directory backup and restore.
- [x] Verification that unrelated `wp-content` paths remain unchanged.
- [x] Verification that Studio temporary paths remain under the configured WordPress directory.
- [x] Automatic container and volume cleanup after the suite.

Run locally:

```bash
npm run test:ssh-integration
```

The regular unit-test suite skips this environment unless `RUN_SSH_INTEGRATION_TESTS=1` is set.

Still pending:

- [ ] Electron UI integration coverage for the complete connection wizard and sync dialogs.
- [ ] Public-key authentication fixture.
- [ ] Failure-injection cases for interrupted upload, disk exhaustion, and failed rollback.
