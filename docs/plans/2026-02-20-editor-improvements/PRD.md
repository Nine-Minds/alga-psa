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

## Local Testing

The full stack can be tested locally without any production dependency:

**Prerequisites** (all already part of the dev setup except the hocuspocus DB):
- PostgreSQL running locally (existing)
- Redis running locally (existing)
- `hocuspocus` database created: `CREATE DATABASE hocuspocus;` with user `hocuspocus_user` (one-time)

**Run locally:**
1. `npm run dev` — Next.js app on localhost:3000
2. `cd hocuspocus && node server.js` — Hocuspocus on localhost:1234
3. Open two browser tabs (or one regular + one incognito with a different user) to `/msp/collab-test?doc=<id>`
4. Both tabs should show live cursors and real-time sync

## Open Questions

1. ~~**TipTap v3 + collab extensions**~~ — RESOLVED. v3 packages exist: `@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-caret`, `@tiptap/y-tiptap`. No conflicts with existing BlockNote v2 stack.
2. **Hocuspocus auth tokens**: Should Phase 1 pass a session token to Hocuspocus for validation, or is room-name-based tenant check sufficient for internal testing?
3. **Test page document lifecycle**: Should test documents be real documents visible in the documents list, or ephemeral/hidden?

## Acceptance Criteria (Definition of Done)

### Phase 1 Done When:
- [ ] Feature flag `collaborative_editing` exists and defaults to `false`
- [ ] `/msp/collab-test` page is accessible only when flag is enabled
- [ ] Two users can open the same document and see each other's cursors with names
- [ ] Changes from one user appear in real-time for the other
- [ ] Content persists across page refreshes (Hocuspocus DB persistence works)
- [ ] "Snapshot to DB" button successfully writes content to `document_block_content`
- [ ] Tenant isolation: users from different tenants cannot see each other's edits
- [ ] All existing editor formatting (from PR #1898) works in collaborative mode
- [ ] Connection/save status is visible to the user
