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
- [ ] Self-hosted pull or push operations.
- [ ] Production database push.

## Guardrails

- [x] WordPress.com / Pressable behavior is preserved.
- [x] Full-sync providers still advertise `canPushToProduction: false`.
- [x] The UI states that connector testing is not available yet.
- [x] REST testing only verifies that the remote site exposes a WordPress REST API index.
- [x] Self-hosted auth fields are stripped from `shared.json` and stored in encrypted Studio app data.
- [x] Saved self-hosted connections can be edited to update site metadata or replace credentials.
- [x] SSH + WP-CLI connection testing verifies password or private-key SSH auth, the remote WordPress path, and `wp core version`.

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

- [ ] Pull remote database with `wp db export`.
- [ ] Archive and download remote `wp-content` parts.
- [ ] Reuse Studio import code to restore the archive locally.
- [ ] Staging push with backup and selected restore parts.
