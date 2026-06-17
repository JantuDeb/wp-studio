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
- [ ] SSH/WP-CLI connection testing.
- [ ] Connector plugin connection testing.
- [ ] Self-hosted pull or push operations.
- [ ] Production database push.
- [ ] Secure credential storage outside `shared.json`.

## Guardrails

- [x] WordPress.com / Pressable behavior is preserved.
- [x] Full-sync providers still advertise `canPushToProduction: false`.
- [x] The UI states that SSH and connector testing are not available yet.
- [x] REST testing only verifies that the remote site exposes a WordPress REST API index.

## Follow-Up PRs

- [ ] Add secure credential storage or encryption before production use.
- [x] Implement REST content-only push and default remote writes to draft.
- [ ] Add SSH/WP-CLI preflight checks.
- [ ] Add connector plugin discovery and token validation.
- [ ] Reuse existing import/export archive code for full sync.
- [ ] Add production push dry-run, backup, and typed-confirmation requirements.

## Phase 3 Addendum

The REST content push MVP now pushes posts and pages from a local Studio site to a saved `self-hosted-rest` connection. Remote writes default to drafts.

Included:

- [x] Fetch local posts and pages through the local WordPress REST API.
- [x] Fetch local categories and tags.
- [x] Create or reuse remote categories and tags by slug.
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
