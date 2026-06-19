# Self-Hosted Sync Phase 2 Checklist

## Scope

This document started as the Phase 2 connection checklist and now tracks the complete self-hosted sync proof of concept. WordPress.com and Pressable sync remain available through the existing provider and UI path.

## Product Vision

**Manage the full lifecycle of WordPress production servers from Studio — without leaving the app.**

The workflow Studio should own end to end:

1. Develop a site locally in Studio.
2. Connect to a production server (SSH, connector plugin, or REST) — or provision a fresh one.
3. Push local → prod: full sync, database, files, or content in batches; safe backups + restore.
4. Author posts/pages locally and deploy them to prod in batches (drafts, publish, or scheduled).
5. Operate the remote site: update WordPress core, plugins, themes; manage PHP/DB versions;
   configure SSL, web server (Apache **and** nginx), and `.htaccess`/rewrite rules.

Sync, batched content deployment, backups/restore, and core/plugin/theme updates already work
(see sections 1–7 below). The next phase is **server lifecycle + provisioning** (Section 8).

Explicitly **deprioritized**: recurring HTTP health checks (was 4.4) and CLI credential access
(was 6.2). Both remain documented but are not on the near-term path.

## Next Up — Server Lifecycle & Provisioning (Section 8)

Concise checklist of what to build next, ordered by value. Each item follows the same Definition
of Done (main process + IPC + renderer, typecheck, lint, focused tests, doc update).

**Build order:** a shared foundation (8.0) first, then 8.1 → 8.2 → 8.3 layered on top, so stack
detection, the Apache/nginx adapter, and the safe-config-edit primitive are written once and reused.
Verification is unit tests (detection parsing + per-server command construction); live integration
is deferred. Fresh provisioning (8.3) assumes a **pre-installed** web server + PHP + DB (no OS
package installs).

### 8.0 Shared foundation (build first)
- [x] Stack detection over SSH → `{ os, webServer, webServerVersion, phpVersion, phpFpm, dbEngine,
      dbVersion, docroot, configPaths, canSudo }`. `getServerStackProbeCommand` +
      `parseServerStackProbe` (`self-hosted-server-stack.ts`) + `detectSelfHostedServerStack` IPC
      handler. Unit-tested (Apache/nginx/MySQL/MariaDB, both-present, none-present).
- [x] Web-server adapter (`getWebServerAdapter`) with Apache + nginx implementations sharing one
      interface (test config, reload, reload PHP-FPM), sudo-aware.
- [x] Safe-config-edit primitive (`getSafeConfigEditCommand`): backup → write (base64) → validate →
      restore-on-failure, deterministic (injected timestamp), unit-tested.
- [ ] Persist detected capabilities on the connection / app data for adaptive UI (pending; handler
      currently returns the stack on demand).

### 8.1 Remote environment management (existing servers) — done
- [x] Report remote PHP version + installed versions (`getSelfHostedPhpVersions`) and DB
      engine/version (stack detection). Surfaced in the Server panel.
- [x] Manage `.htaccess` (Apache): view (`getSelfHostedHtaccess`) and edit with backup + validate +
      auto-restore (`updateSelfHostedHtaccess`). Disabled for production and for nginx hosts.
- [x] Detect web server (Apache vs nginx) and adapt actions (8.0 adapter).
- [x] Validate & reload the web server + PHP-FPM (`reloadSelfHostedWebServer`): tests config first,
      aborts on failure, prod-gated.
- [x] Renderer UI: a "Server" panel in the management modal showing OS / web server / PHP / DB, a
      `.htaccess` editor (Apache; nginx notice otherwise), and the validate-&-reload button.
- [ ] Active PHP-version *switching* deferred — host-specific and risky; the panel reports installed
      versions but does not auto-switch yet.

### 8.2 SSL / TLS
- [ ] Detect current certificate (issuer, domains, expiry).
- [ ] Provision/renew Let's Encrypt certs (certbot) for Apache and nginx.
- [ ] Configure HTTP→HTTPS redirect; verify the chain after issuing.

### 8.3 Provision a new remote site (on a pre-installed stack)
- [ ] Connect over SSH and detect the stack; require web server + PHP + DB already present
      (installing OS packages is out of scope for now).
- [ ] Create a new site: vhost/server block, document root, database + user, `wp-config`, install
      WordPress via WP-CLI.
- [ ] Add the new remote site as a sync target, then push a local Studio site into it.

### 8.4 Add-site & connection UX
- [ ] "Add remote site" flow that distinguishes "connect existing" vs "provision new".
- [ ] Persist server capabilities (web server, PHP, DB, SSL) on the connection for adaptive UI.

### 8.5 Safety & guardrails (applies across 8.x)
- [ ] Back up any config file before editing; one-click restore.
- [ ] Validate config before reload; auto-rollback on failed reload/verification.
- [ ] Keep destructive server changes behind typed confirmation and the existing prod gates.

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

## Current Capability Status

- [x] REST content push for posts, pages, media, terms, and remote-ID post meta.
- [x] Connector plugin connection testing and desktop transport protocol.
- [x] SSH/WP-CLI pull to local Studio site.
- [x] Self-hosted staging/development push operations.
- [x] Production REST content push with draft defaults and typed publish confirmation.
- [ ] Production database/file push. This remains intentionally disabled.

## Guardrails

- [x] WordPress.com / Pressable behavior is preserved.
- [x] Full-sync providers still advertise `canPushToProduction: false`.
- [x] Connector capability testing validates the authenticated connector REST API.
- [x] REST testing only verifies that the remote site exposes a WordPress REST API index.
- [x] Self-hosted auth fields are stripped from `shared.json` and stored in encrypted Studio app data.
- [x] Saved self-hosted connections can be edited to update site metadata or replace credentials.
- [x] SSH + WP-CLI connection testing verifies password or private-key SSH auth, the remote WordPress path, and `wp core version`.
- [x] SSH pull downloads database and `wp-content` from the configured WordPress path only.

## Follow-Up PRs

- [x] Add secure credential storage or encryption before production use.
- [x] Implement REST content-only push and default remote writes to draft.
- [x] Add SSH/WP-CLI preflight checks.
- [x] Add connector plugin discovery and token validation.
- [x] Reuse existing import/export archive code for full sync.
- [x] Add dry-run, backup, and typed-confirmation guardrails where remote writes are enabled.

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
- [x] Staging push with backup and selected restore parts.

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
- [x] Progress events for remote preparation, SFTP download, and import phases.
- [ ] Remote pull archive size estimate before download.
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
- [x] Keep database/file push disabled for production.

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
- [x] Progress events for export, upload/download, backup, restore, and verification.
- [x] Production file/database push policy: disabled; production uses REST content sync.

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
- Restore progress and automatic verification are implemented.

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
- [x] HTTP availability and response-time monitoring.
- [ ] Vulnerability/advisory data integration.

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

- [x] Bulk update selection.
- [x] WordPress core update workflow.
- [ ] Vulnerability/advisory integration.
- [x] Debug-log viewer, download, fatal highlighting, and clearing controls.
- [x] HTTP availability and response-time monitoring.
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

## Extended Site Management Addendum

The SSH management surface now covers logs, monitoring, bulk maintenance, core updates, and incremental files.

Included:

- [x] View the latest 500 remote debug-log lines.
- [x] Highlight fatal PHP errors and show total log size/line/fatal counts.
- [x] Download the complete remote debug log.
- [x] Clear the log after explicit confirmation.
- [x] HTTP status and response-time monitoring.
- [x] WordPress directory usage and available filesystem space.
- [x] Bulk plugin/theme selection with one scoped pre-update backup.
- [x] Sequential component updates with verification and automatic rollback.
- [x] Guarded WordPress core update and database upgrade for staging/development.
- [x] Restore the previous core/database state when verification fails.
- [x] Hash-based local/remote `wp-content` comparison.
- [x] Preview changed, local-only, remote-only, and unchanged files.
- [x] Upload changed files and delete remote-only files after a scoped backup.
- [x] Exclude Studio database integration, caches, logs, Git data, and dependencies from incremental sync.
- [x] Production incremental file sync remains disabled.

## Connector Plugin Protocol Addendum

Studio now implements the desktop side of a connector-plugin transport for shared hosts without SSH.

Required authenticated endpoints under `/wp-json/studio-connector/v1/`:

- `GET status` returns plugin/WordPress versions and export/restore capabilities.
- `POST exports` creates an archive and returns `download_url`.
- `POST archives` accepts an `application/gzip` archive and returns `archive_id`.
- `POST archives/{archive_id}/restore` creates a remote backup and restores requested parts.

Included:

- [x] Bearer-token connection testing and capability discovery.
- [x] Remote full archive export/download and local Studio import.
- [x] Local full export, connector upload, backup-required restore, and URL metadata.
- [x] Staging/development connector push.
- [x] Production connector full-site push blocked in the main process and UI.

The WordPress connector plugin itself remains a separately deployable component and must implement this contract securely.

## Production Content Deployment Addendum

Production deployment remains content-first.

Included:

- [x] REST posts/pages/media/terms are the only production push path.
- [x] Production content pushes default to drafts.
- [x] Existing conflict preview remains mandatory before writing.
- [x] Immediate production publishing requires typing `PUBLISH`.
- [x] SSH and connector database/file pushes remain disabled for production.

Still pending:

- [ ] Scheduled production publishing.
- [ ] Editorial approval roles and deployment audit history.

## Production-Readiness Implementation Plan

This is the live tracker for finishing self-hosted sync. Items are ordered from **most
significant to least** so we can implement and verify them one at a time. The earlier phase
checklists above are kept for implementation history; this section supersedes the previous
"Consolidated Next Features" list.

### Definition Of Done (per feature)

A feature is checked off here only when:

- [ ] Implementation is complete end-to-end (main process + IPC + renderer where applicable).
- [ ] `npm run typecheck` is clean.
- [ ] `npx eslint --fix` on modified files is clean.
- [ ] Focused unit tests are added/updated and passing.
- [ ] This checklist and any relevant addendum above are updated.

---

### 1. Sync Fidelity — Content Detection (highest value)

The current REST push only detects media referenced by an exact local URL substring. Sites that
use the block editor, galleries, or shortcodes lose images on push. This is the most valuable gap.

- [x] 1.1 Detect attachment references by ID: `wp:image {"id":N}`, `[gallery ids="..."]`,
      `[caption id="attachment_N"]`, classic `class="wp-image-N"`.
- [x] 1.2 Detect media in gallery blocks and block JSON attributes (`wp:gallery`, nested
      `wp:image` inside columns/cover/media-text). Covered by the block-JSON `"id"`/`"ids"`
      scanners, which match nested blocks regardless of container.
- [x] 1.3 Detect media in shortcodes (`[gallery]`, `[playlist]`, `[audio]`, `[video]`) via the
      `ids="..."` / `id="..."` shortcode-attribute scanners.
- [x] 1.4 Rewrite block JSON `id`/`ids` attributes, shortcode ids, and `wp-image-N`/`wp-att-N`
      classes to the remote attachment ID after upload, not just URLs
      (`rewriteMediaIdReferences`). Only uploaded media IDs are remapped, so unrelated block IDs
      are left untouched.
- [x] 1.5 Unit tests for every detection and rewrite path (extended
      `self-hosted-media-sync.test.ts`: 14 new cases).

Implementation: `getMediaIdsReferencedById` and `rewriteMediaIdReferences` in
`apps/studio/src/modules/sync/lib/self-hosted-media-sync.ts`, wired into
`pushSelfHostedRestContent` so id-referenced media are uploaded and their IDs rewritten in
content/excerpt alongside URL replacement.

### 2. Sync Fidelity — REST Post/Page Sync Correctness

Make the post/page push faithful: metadata, ordering, hierarchy, and idempotency.

- [x] 2.1 Preserve full attachment/featured-image metadata (alt, caption, description, title) on
      media upload, including `_wp_attachment_image_alt` (mirrored into attachment `meta`) and the
      attachment `date`/`date_gmt`.
- [x] 2.2 Push page parent hierarchy and `menu_order` so page trees survive the round trip. Pages
      are ordered parent-first (`orderContentForPush`) and the parent's freshly-created remote ID
      is mapped onto the child's `parent`.
- [x] 2.3 Push canonical post fields currently dropped: `excerpt` (already), `comment_status`,
      `ping_status`, `sticky` (posts), and post `date`/`date_gmt` (only when publishing, so drafts
      are not forced to a date).
- [x] 2.4 Map featured image to the uploaded remote attachment ID (`featured_media`) — confirmed
      and covered by tests.
- [x] 2.5 Idempotency: a second push of unchanged content reuses the stored remote ID and issues
      an update against the same remote item rather than creating a duplicate (test-covered).
- [x] 2.6 Focused main-process tests for the REST content-push pipeline (preview + push) against an
      in-memory fake remote REST API (`self-hosted-rest-content-push.test.ts`, 9 cases).

### 3. Sync Reliability — Tests And Rollback Coverage

- [x] 3.1 Automatic verification + rollback for manually selected backup restores. After applying a
      selected restore, `restoreSelfHostedSshBackup` now verifies the site and, on failure, reverts
      to the pre-restore safety backup it just captured (mirroring the push auto-rollback), reporting
      whether the rollback itself verified.
- [x] 3.2 Failure-injection unit coverage (`self-hosted-ssh-failure-injection.test.ts`): insufficient
      remote disk space (now an authoritative main-process guard before upload), remote command
      failure during backup/apply, post-push verification failure → auto-rollback, double failure
      (verification + rollback), restore auto-rollback, and production-restore rejection.
- [x] 3.3 Public-key authentication fixture: the Docker fixture authorizes a committed test-only
      ED25519 key (`fixtures/ssh-wordpress/test_key`), enables `PubkeyAuthentication`, and a new
      integration case connects with the private key.

Also hardened: `pushSelfHostedSshSite` now enforces the disk-space preflight in the main process
(refuses the push before upload when the archive + scoped backup + 100 MB margin exceed available
remote space), so the block holds even if the renderer preflight is bypassed.

### Renderer surfaces (wiring the new backends into the UI)

The capabilities below were initially built as main-process handlers + IPC/preload only. They are
now surfaced in the Sync tab's self-hosted UI (`apps/studio/src/modules/sync/index.tsx`):

- **Security advisories** — `SelfHostedSshAdvisoriesPanel` inside the management modal, fetched
  alongside the status (critical = removed-from-directory, warning = outdated).
- **Deployment history** — a per-connection **History** button opens `SelfHostedDeploymentsModal`
  listing recorded pushes/restores with status and timestamp.
- **Pull size estimate** — the SSH pull confirmation dialog now shows the estimated download size
  from `previewSelfHostedSshPull` (best-effort; never blocks the pull).
- **Backup retention** — the backups modal's "Keep latest 5" now calls the authoritative
  `applySelfHostedSshBackupRetention` (`maxCount: 5`) instead of a renderer-side slice.
- **Scheduled publishing** — the content-push modal has a "Schedule publication" toggle +
  `datetime-local` picker; scheduling routes through the production approval gate and sends
  `scheduledDate` to `pushSelfHostedRestContent`.

### 4. Operations And Security

- [x] 4.1 Remote pull archive-size estimate before download (`previewSelfHostedSshPull`): reports
      WP-CLI database size and selected `wp-content` path disk usage, mirroring the push preflight.
- [x] 4.2 Automatic backup retention by age, count, and total size. Pure, tested policy in
      `self-hosted-backup-retention.ts` (`selectBackupsToPrune`) + `applySelfHostedSshBackupRetention`
      handler that prunes `studio-backup-*` pairs over SSH. The newest backup is always retained;
      pre-restore safety backups are never auto-pruned. Exposed via IPC/preload for the renderer to
      invoke with a user-configured policy (no silent default deletion).
- [x] 4.3 Clearer reporting when remote temporary-directory cleanup fails: `cleanupRemoteWorkDir`
      now logs the failure and emits a UI progress warning naming the leftover path instead of
      silently swallowing the error.
- [ ] 4.4 Configurable recurring HTTP health checks with notifications. **Deprioritized** (not on
      the near-term path; see Product Vision). One-shot HTTP status + response time already ships in
      `getSelfHostedSshManagementStatus`.
- [x] 4.5 Integrate plugin/theme/core advisory data into the management dashboard. Dependency-free,
      no paid feed: `getSelfHostedSshAdvisories` flags extensions removed/closed from the
      WordPress.org directory (critical security signal) and extensions with available updates
      (warning), via the pure, tested `buildExtensionAdvisories` in `self-hosted-advisories.ts`.
      Lookups degrade gracefully on network failure.

### 5. Production Deployment Workflow

- [x] 5.1 Scheduled production publishing. `pushSelfHostedRestContent` accepts a future
      `scheduledDate`; content is created with WordPress `status: future` and the scheduled
      `date_gmt`, so it auto-publishes at that time. The date is validated (must parse and be in the
      future), scheduling counts as a publish for the production approval gate, and the scheduled
      time is recorded in the audit trail. (Backend + IPC complete and tested; a renderer date
      picker is the remaining UI surface.)
- [x] 5.2 Deployment history and audit records for self-hosted pushes. Bounded per-connection
      history (newest 100) persisted in Desktop app data under the app-data lock
      (`sync-deployment-history.ts`), written by the SSH push (success/warnings/failure) and the REST
      content push, and read back via the `getSyncDeployments` IPC handler. Records carry no secrets.
- [x] 5.3 Editorial approval gate before production content writes. `pushSelfHostedRestContent`
      now enforces the approval token (`PUBLISH`) in the **main process** when publishing to a
      production connection — the gate can no longer be bypassed by calling the IPC directly. The
      renderer threads the typed confirmation through as `approval`; the approval is recorded in the
      deployment audit trail. Draft pushes and non-production targets are unaffected.

### 6. Architecture

- [x] 6.1 Extract the shared WP.com + self-hosted sync dialog shell into a provider-neutral
      component (`sync-dialog-shell.tsx`). It owns the modal frame, description, from→to header (with
      its screen-reader summary), the upper-case section heading, the scroll container, and the
      pinned footer slot. Both `SyncDialog` (WP.com/Pressable) and `SelfHostedSshSyncDialog` now
      render through it, passing their provider-specific selection UI as children and their warnings
      + action buttons as the footer. The two dialogs now share one consistent layout.
- [ ] 6.2 Optional CLI access to encrypted self-hosted credentials and operations.
      **Deprioritized** (not on the near-term path; see Product Vision). Credentials use Electron
      `safeStorage`, which has no CLI equivalent, so this would need a vault re-architecture or a
      CLI→Desktop bridge — revisit only if CLI-managed self-hosted sync becomes required.

### 7. Connector Plugin (last)

- [x] 7.1 Build the separately installable WordPress connector plugin implementing the documented
      `/wp-json/studio-connector/v1/` REST contract (status, exports, archives, restore) with
      bearer-token auth. Reference implementation at `wp-plugins/studio-connector/`
      (`studio-connector.php` + `README.md`): SHA-256-hashed bearer token with constant-time
      comparison, `mysqldump`-with-PHP-fallback DB export, `PharData` gzip tar archives matching
      Studio's `sql/` + `wp-content/` interchange layout, path-traversal-guarded archive handling,
      a Settings page for token generation/revocation, and production restore blocked by default
      (opt-in via the `studio_connector_allow_production_restore` filter). Matches the request/
      response shapes the desktop `connectorRequest` / pull / push handlers expect
      (`download_url`, `archive_id`, `backup_id`). Needs a security review before production use.

### Intentional Restrictions (kept disabled by design)

- [ ] Production SSH/connector database and file push remains disabled until broader real-host
      testing and review.
- [ ] Production backup restore remains read-only in Studio.
