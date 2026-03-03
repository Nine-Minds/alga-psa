# PRD — Real-Time Collaborative Document Editing

- Slug: `2026-02-20-editor-improvements`
- Date: `2026-02-20`
- Status: Draft

## Summary

Add real-time collaborative editing to Alga PSA so multiple users can edit the same document simultaneously, seeing each other's cursors and changes live. Rolled out in two phases: first as an isolated test page behind a feature flag, then integrated into the main documents system.

## Problem

Currently, document editing is single-user with manual save. If two users open the same document, the last save wins — silently overwriting the other person's work. There is no indication that someone else is viewing or editing a document. For teams working on shared documentation (runbooks, SOPs, client notes), this creates data loss risk and forces users to coordinate out-of-band.

## Goals

1. **Phase 1 — Isolated test page**: Ship a feature-flag-gated page at `/msp/collab-test` where users can create/open a test document and collaboratively edit it in real-time. This validates the full stack (TipTap + Hocuspocus + Y.js) works in production with real infrastructure (Redis, PostgreSQL, WebSockets).
2. **Phase 2 — Production integration**: Replace the current `DocumentEditor` with the collaborative version for all in-app documents. Existing documents continue to work. Users see presence indicators and live cursors when co-editing.

## Non-goals

- Collaborative editing for the BlockNote-based `TextEditor` (used in tickets) — that's a separate effort.
- Offline editing / offline-first sync — Y.js supports this but it's out of scope.
- Document permissions beyond existing tenant isolation — if you can see the document today, you can co-edit it.
- Version history UI / undo across sessions — Hocuspocus handles persistence; version browsing is a future feature.
- Comments / annotations / suggestions mode.

## Users and Primary Flows

**Persona**: MSP team members (technicians, managers) who create and edit shared documents within their tenant.

### Phase 1 Flow — Test Page
1. User navigates to `/msp/collab-test` (visible only when `collaborative_editing` feature flag is enabled).
2. Page shows a simple UI: create a new test document or open an existing one by ID.
3. User opens a document — the collaborative TipTap editor loads and connects to Hocuspocus.
4. A second user opens the same document (same URL or enters the same document ID).
5. Both users see each other's cursors (colored, with name labels).
6. Changes sync in real-time — no save button needed.
7. Content auto-persists to Hocuspocus DB. A "snapshot to main DB" action is available for testing the sync-back mechanism.

### Phase 2 Flow — Integrated Documents
1. User opens any in-app document from the documents list.
2. The editor connects to Hocuspocus automatically.
3. If another user opens the same document, both see presence indicators and live cursors.
4. Content auto-saves. The manual "Save" button is removed.
5. Existing documents that were created before the migration load their content from `document_block_content`, which is used to initialize the Y.js document on first connection.

## UX / UI Notes

### Collaborative Editor Component
- Based on the existing `DocumentEditor.tsx` + `EditorToolbar.tsx` (BubbleMenu).
- Adds: collaboration cursors (colored carets with user name labels), presence bar (avatars/names of connected users at the top of the editor).
- Removes: manual "Save" button (replaced by auto-save indicator: "Saving..." / "Saved" / "Offline").
- Connection status indicator: connected (green dot), syncing (yellow), disconnected (red with retry).

### Test Page (`/msp/collab-test`)
- Minimal UI — this is a developer/QA tool, not a polished feature page.
- Input field for document ID + "Open" button, or "Create New" button.
- The collaborative editor fills the page below.
- Shareable URL: `/msp/collab-test?doc=<documentId>` so users can share links to test together.
- Debug panel (collapsible): connection status, connected users count, Y.js sync state.

## Requirements

### Functional Requirements

#### Phase 1 — Test Page

**F-P1-01**: Feature flag `collaborative_editing` gates access to `/msp/collab-test`. Defaults to `false`.

**F-P1-02**: Test page allows creating a new collaborative test document (creates a real document in the `documents` + `document_block_content` tables).

**F-P1-03**: Test page allows opening an existing document by ID via URL parameter (`?doc=<id>`).

**F-P1-04**: `CollaborativeEditor` component connects to Hocuspocus server using the existing `yjs-config.ts` provider factory, with room name format `document:<tenant>:<documentId>`.

**F-P1-05**: TipTap editor configured with `Collaboration` extension (Y.js binding via `@tiptap/y-tiptap`) and `CollaborationCaret` extension (awareness protocol for cursors). Uses the v3 packages: `@tiptap/extension-collaboration@^3.12.0`, `@tiptap/extension-collaboration-caret@^3.0.0`, `@tiptap/y-tiptap@^3.0.2`.

**F-P1-06**: Collaboration cursors display the user's name and a distinct color.

**F-P1-07**: Presence bar above the editor shows avatars/names of all connected users.

**F-P1-08**: Connection status indicator (connected / syncing / disconnected).

**F-P1-09**: Auto-save indicator replaces manual save button ("All changes saved" / "Saving..." / "Offline — changes will sync when reconnected").

**F-P1-10**: Content persists via Hocuspocus Database extension to its separate PostgreSQL database.

**F-P1-11**: "Snapshot to DB" button on test page that writes the current Y.js document state back to `document_block_content` as rendered TipTap JSON — proving the sync-back mechanism works.

**F-P1-12**: Hocuspocus `onConnect` hook validates that the room name's tenant segment matches the connecting user's tenant (basic tenant isolation).

**F-P1-13**: Editor includes the existing `EditorToolbar` (BubbleMenu) with all formatting from PR #1898 (bold, italic, underline, strikethrough, code, headings, lists, blockquote, links).

**F-P1-14**: Markdown paste handling works in collaborative mode (same behavior as current `DocumentEditor`).

**F-P1-15**: Editor includes the `Emoticon` extension (from `@alga-psa/ui/editor`) for text-emoticon-to-emoji conversion (e.g., `:)` → emoji).

**F-P1-16**: Editor includes the `Link` extension configured identically to the current `DocumentEditor`: `openOnClick: false`, `autolink: true`, `linkOnPaste: true`, `HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' }`.

**F-P1-17**: Editor includes an emoji suggestion grid triggered by typing `:` followed by 2+ characters. Uses `emoji-mart` for search. Grid shows up to 30 matching emoji with keyboard navigation (arrows, Enter to select, Escape to dismiss). Feature parity with BlockNote TextEditor's `GridSuggestionMenuController`.

**F-P1-18**: Editor includes @mention support triggered by typing `@`. Shows a searchable dropdown of tenant users (via `searchUsersForMentions` server action) plus an `@everyone` option. Mentions render as styled inline badges matching the BlockNote Mention component appearance. Uses a custom Tiptap `MentionNode` (inline, atom) + `MentionSuggestionExtension` (ProseMirror plugin for detection) + `MentionSuggestionPopup` (React popup).

**F-P1-19**: `yjs-config.ts` derives the Hocuspocus WebSocket URL from `window.location` in the browser (falling back to `NEXT_PUBLIC_HOCUSPOCUS_URL` env var if set, or `ws://localhost:1234` on the server). This ensures the client connects to `wss://<domain>/hocuspocus` in production without requiring a build-time environment variable.

**F-P1-20**: `RichTextViewer` defensively handles old/malformed document content: `sanitizeBlocks()` validates block types and coerces non-string `.text` fields; `extractTextFromProseMirror()` handles Tiptap JSON `{ type: "doc", content: [...] }` format; `RichTextErrorBoundary` catches BlockNote render crashes and shows plain text fallback. Fixes `e.text.trim is not a function` and `Error creating document from blocks passed as initialContent` on legacy documents.

**F-P1-21**: Mention notification handlers in `internalNotificationSubscriber.ts` are optimized: `resolveEveryoneMention` does a single DB query instead of looping; handlers early-exit when no new mentions are found (avoiding unnecessary DB queries on every document edit); notifications are created in parallel via `Promise.all` instead of sequential `for...of await`.

#### Phase 2 — Production Integration

**F-P2-01**: Replace `DocumentEditor` usage across the app with `CollaborativeEditor`.

**F-P2-02**: When a document is opened for the first time in collaborative mode, initialize the Y.js document from the existing `document_block_content.block_data` JSON.

**F-P2-03**: Auto-snapshot: periodically (and on last-user-disconnect), write the Y.js document state back to `document_block_content` so that non-editor consumers (previews, search, API) have up-to-date content.

**F-P2-04**: Remove the manual "Save" button from document editing views.

**F-P2-05**: Presence indicators visible in the document list (e.g., "2 people editing" badge) — optional, nice-to-have.

**F-P2-06**: Graceful degradation: if Hocuspocus is unreachable, fall back to the current single-user editor with manual save.

### Non-functional Requirements

- WebSocket connection must work through the existing reverse proxy / ingress setup.
- Hocuspocus server must handle multiple concurrent document rooms without degradation.
- Tenant isolation must be enforced — users from tenant A must never see content or cursors from tenant B.

## Data / API / Integrations

### Hocuspocus Room Naming
- Format: `document:<tenantId>:<documentId>`
- Example: `document:550e8400-e29b-41d4-a716-446655440000:7c9e6679-7425-40de-944b-e07fc1f90ae7`

### Hocuspocus Authentication Extension
- New `onAuthenticate` or `onConnect` hook in `hocuspocus/server.js`
- Validates: (a) user has a valid session, (b) tenant from session matches tenant in room name
- Phase 1: tenant check via room name parsing
- Phase 2: full JWT/session token validation

### Snapshot Sync (Y.js -> Main DB)
- Server action: `syncCollabSnapshot(documentId)`
- Reads Y.js document state from Hocuspocus DB, converts to TipTap JSON, writes to `document_block_content`
- Triggered: on-demand in Phase 1, automatically in Phase 2

### Existing Tables Used
- `documents` — document metadata (unchanged)
- `document_block_content` — block_data JSONB (read for initialization, written for snapshots)

### No New Tables Required
- Hocuspocus manages its own persistence in the separate `hocuspocus` database
- Awareness (cursor positions) is ephemeral — not persisted

## Security / Permissions

- Tenant isolation enforced at Hocuspocus connection level (room name validation).
- No cross-tenant document access possible — room names include tenant ID.
- Feature flag prevents unauthorized access to the test page.
- Existing document-level permissions (RLS policies) continue to apply for CRUD operations.

## Rollout / Migration

### Phase 1 (this plan)
1. Add `collaborative_editing: false` to feature flag defaults.
2. Build `CollaborativeEditor` component.
3. Build `/msp/collab-test` page.
4. Add basic tenant validation to Hocuspocus `onConnect`.
5. Enable flag for internal testers via PostHog.
6. Test with 2-3 concurrent users on production infrastructure.

### Phase 2 (future plan, after Phase 1 is validated)
1. Build the auto-snapshot mechanism.
2. Build the Y.js initialization-from-existing-content mechanism.
3. Replace `DocumentEditor` imports with `CollaborativeEditor`.
4. Remove feature flag gating.
5. Monitor Hocuspocus resource usage.
6. **Dead code cleanup**: After migration, audit and delete files that are no longer referenced:
   - `packages/documents/src/components/DocumentEditor.jsx` (stale .jsx artifact)
   - `packages/documents/src/components/BlockEditor.jsx` (stale .jsx artifact)
   - `packages/documents/src/components/DocumentEditor.tsx` (replaced by CollaborativeEditor)
   - Any `DocumentEditor` imports/re-exports (e.g., in `packages/documents/src/components/index.ts`)
   - Verify with `grep -r "DocumentEditor" --include='*.ts' --include='*.tsx'` that zero references remain before deleting.
   - Confirm comments (ticket, task) use `TextEditor.tsx` (BlockNote) — not affected by this cleanup.
   - Confirm `RichTextViewer.tsx` is not affected — it's read-only display, unrelated to DocumentEditor.

## Local Testing

The full stack can be tested locally without any production dependency:

**Prerequisites** (all already part of the dev Docker setup):
- PostgreSQL running (existing `alga_psa_postgres` container, port 5432)
- Redis running (existing `alga_psa_redis` container, port 6379)
- Hocuspocus running (`alga_psa_hocuspocus` container, port 1234) — uses the `server` database with `app_user` in dev (no separate hocuspocus DB needed)

**Start Hocuspocus in Docker (if not running):**
```bash
APP_NAME=alga_psa EXPOSE_HOCUSPOCUS_PORT=1234 DB_NAME_HOCUSPOCUS=server DB_USER_HOCUSPOCUS=app_user \
  REDIS_HOST=redis REDIS_PORT=6379 DB_HOST=postgres DB_PORT=5432 HOCUSPOCUS_PORT=1234 \
  docker compose -p alga-psa -f docker-compose.yaml -f docker-compose.base.yaml up -d hocuspocus
```

**Run locally:**
1. `npm run dev` — Next.js app on localhost:3000
2. Hocuspocus on localhost:1234 (via Docker, see above)
3. Open two browser tabs (or one regular + one incognito with a different user) to `/msp/collab-test?doc=<id>`
4. Both tabs should show live cursors and real-time sync

## Automated Test Strategy

### Programmatic Y.js Sync Tests (require Hocuspocus + Redis + PostgreSQL)

These tests create `HocuspocusProvider` instances programmatically (no browser) to verify server-side collaboration behavior:

1. **Two-provider sync**: Connect two providers to the same room, write content via provider A, verify it arrives at provider B within a timeout.
2. **Awareness broadcast**: Set awareness state (user name, cursor) on provider A, verify provider B receives it.
3. **onConnect tenant rejection**: Connect with a room name containing a mismatched tenant, verify the connection is rejected.
4. **syncCollabSnapshot end-to-end**: Write content via a provider, call `syncCollabSnapshot`, verify `document_block_content` is updated.
5. **Content persistence**: Write via provider, disconnect both, reconnect a new provider to the same room, verify content loads from Hocuspocus DB.

**Infrastructure required**: Hocuspocus server on localhost:1234, PostgreSQL, Redis. All available via the Docker stack.

**Test file**: `server/src/test/integration/collaborativeEditing.integration.test.ts` (extend existing)

### Playwright Browser Tests (require full app + Hocuspocus)

These are end-to-end browser tests for real UI collaboration:

1. Two browser contexts (different logged-in users), same `?doc=<id>` URL.
2. Type in context A, assert content appears in context B within 3 seconds.
3. Verify cursor labels with user names appear.
4. Verify presence bar shows both users' names.
5. Close context A, verify presence bar in context B updates.

**Infrastructure required**: Next.js dev server + Hocuspocus + PostgreSQL + Redis.

## Open Questions

1. ~~**TipTap v3 + collab extensions**~~ — RESOLVED. v3 packages exist: `@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-caret`, `@tiptap/y-tiptap`. No conflicts with existing BlockNote v2 stack.
2. **Hocuspocus auth tokens**: Should Phase 1 pass a session token to Hocuspocus for validation, or is room-name-based tenant check sufficient for internal testing?
3. **Test page document lifecycle**: Should test documents be real documents visible in the documents list, or ephemeral/hidden?

## Acceptance Criteria (Definition of Done)

### Phase 1 Done When:
- [x] Feature flag `collaborative_editing` exists and defaults to `false`
- [x] `/msp/collab-test` page is accessible only when flag is enabled
- [x] Two users can open the same document and see each other's cursors with names
- [x] Changes from one user appear in real-time for the other
- [x] Content persists across page refreshes (Hocuspocus DB persistence works)
- [x] "Snapshot to DB" button successfully writes content to `document_block_content`
- [x] Tenant isolation: users from different tenants cannot see each other's edits
- [x] All existing editor formatting (from PR #1898) works in collaborative mode
- [x] Emoticon extension works in collaborative mode (`:)` converts to emoji)
- [x] Link auto-detection works (typing a URL auto-links it)
- [x] Connection/save status is visible to the user
- [x] Programmatic two-provider sync test passes (automated)
- [x] Programmatic onConnect tenant rejection test passes (automated)
- [x] Emoji suggestion grid works (`:ha` shows emoji picker) — feature parity with TextEditor
- [x] @mention works (`@` shows user search dropdown, inserts mention badge) — feature parity with TextEditor
- [x] WebSocket connects in production (URL derived from `window.location`, not env var)
- [x] Old documents render without crashes (sanitizer + error boundary in RichTextViewer)
- [x] Mention notifications don't cause unnecessary DB queries on every document edit
