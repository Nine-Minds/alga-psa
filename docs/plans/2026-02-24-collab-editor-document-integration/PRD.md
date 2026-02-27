# PRD — Integrate Collaborative Editor into In-App Documents

- Slug: `2026-02-24-collab-editor-document-integration`
- Date: `2026-02-24`
- Status: Draft
- Predecessor: `2026-02-20-editor-improvements` (Phase 1 — test page, completed)

## Summary

Replace the single-user TextEditor (BlockNote) in the documents drawer with the CollaborativeEditor (Tiptap + Y.js + Hocuspocus) so that multiple users can edit the same document simultaneously with live cursors and auto-sync. Falls back gracefully to single-user mode when Hocuspocus is unavailable.

## Problem

Phase 1 validated the collaborative editing stack on `/msp/collab-test`. But in-app documents still use the BlockNote-based TextEditor with manual save — so real users don't get collaborative editing. Two users editing the same document still risk last-write-wins data loss.

## Goals

1. Replace the TextEditor in the document drawer (`Documents.tsx`) with CollaborativeEditor for in-app document editing.
2. Graceful fallback: if Hocuspocus is unreachable, fall back to a single-user Tiptap editor with manual save (the existing `DocumentEditor` pattern).
3. Keep a manual Save/Snapshot button alongside auto-sync for user confidence.
4. Handle existing documents that were stored in BlockNote JSON format — convert to ProseMirror JSON on first collaborative open.
5. Preserve presence indicators (connected users, cursors) and connection status in the drawer.

## Non-goals

- Changing the drawer-based UX to a full-page editor (keep current UX).
- Collaborative editing for BlockNote-based editors (ticket comments, task comments) — those stay as-is.
- Offline-first / offline editing.
- Version history UI.
- Document-level permissions beyond existing tenant isolation.
- Presence indicators in the document list ("2 people editing" badge).

## Users and Primary Flows

**Persona**: MSP team members editing shared documents (runbooks, SOPs, client notes).

### Flow 1 — Collaborative edit (Hocuspocus available)
1. User clicks a document in the documents list.
2. Drawer opens with CollaborativeEditor.
3. Editor connects to Hocuspocus room `document:<tenantId>:<documentId>`.
4. If the document has existing content in `document_block_content`, the Y.js document is initialized from it (on first connection to a room with no prior Y.js state).
5. User edits. Changes auto-sync via Y.js.
6. If a second user opens the same document, both see each other's cursors.
7. Presence bar shows connected users.
8. Status bar shows "All changes saved" / "Saving..." / "Offline".
9. User can click "Save" to force-snapshot current state to `document_block_content`.
10. On drawer close, a final snapshot is triggered.

### Flow 2 — Fallback (Hocuspocus unavailable)
1. User clicks a document.
2. Drawer opens, CollaborativeEditor attempts Hocuspocus connection.
3. Connection times out (e.g., 3 seconds).
4. Editor falls back to single-user Tiptap mode (no Y.js, no presence).
5. Status bar shows "Offline — manual save mode".
6. User edits and clicks "Save" to persist manually.

### Flow 3 — New document creation
1. User clicks "Create New Document" in the documents page.
2. Drawer opens with CollaborativeEditor in a new room.
3. A new document record and `document_block_content` row are created.
4. User types and auto-syncs. On close, snapshot persists.

## UX / UI Notes

### Drawer changes
- Replace `TextEditor` (BlockNote) with `CollaborativeEditor` (Tiptap) in edit mode.
- Replace `RichTextViewer` (BlockNote) with a read-only Tiptap view in view mode (or keep RichTextViewer for non-editable contexts).
- Add presence bar at top of editor area (already built into CollaborativeEditor).
- Add connection/save status bar (already built into CollaborativeEditor).
- Keep the "Save" button in the drawer footer (triggers `syncCollabSnapshot`).
- Keep the document name input at the top.

### Content format handling
- Existing documents stored in BlockNote JSON need conversion to ProseMirror JSON.
- Conversion happens lazily on first open: detect format, convert if needed, save in new format.
- Detection heuristic: BlockNote JSON is an array starting with `[{ type: "paragraph", props: {...} }]`; ProseMirror JSON is `{ type: "doc", content: [...] }`.

## Requirements

### Functional

**F01**: Documents.tsx drawer renders `CollaborativeEditor` instead of `TextEditor` when editing an in-app document.

**F02**: CollaborativeEditor connects to Hocuspocus room `document:<tenantId>:<documentId>` on mount.

**F03**: On first connection to a room with no Y.js state, existing `document_block_content.block_data` is loaded and used to initialize the Y.js document (already implemented in CollaborativeEditor).

**F04**: Content format detection: if `block_data` is in BlockNote JSON format, convert to ProseMirror JSON before initializing the Y.js document.

**F05**: Format conversion function: `blockNoteJsonToProsemirrorJson()` that maps BlockNote block types (paragraph, heading, bulletListItem, numberedListItem, etc.) to ProseMirror equivalents.

**F06**: Auto-sync via Y.js — changes propagate to all connected clients in real-time.

**F07**: Manual "Save" button triggers `syncCollabSnapshot()` to write current Y.js state to `document_block_content.block_data`.

**F08**: On drawer close, trigger a final snapshot to persist content.

**F09**: Graceful fallback: if Hocuspocus connection fails (timeout after ~3s), switch to single-user mode using a standalone Tiptap editor with manual save via `updateBlockContent()`.

**F10**: Fallback mode shows a status indicator: "Offline — manual save mode".

**F11**: Presence bar shows connected users with avatars and names (existing CollaborativeEditor feature).

**F12**: Collaboration cursors show user name and distinct color (existing feature).

**F13**: New document creation flow creates the document record and `document_block_content` row, then opens CollaborativeEditor in the new room.

**F14**: Read-only view mode: when the drawer is in view mode (non-editable), render a read-only Tiptap editor or keep using RichTextViewer.

**F15**: The `DocumentEditor` component (single-user Tiptap) is reused as the fallback editor, sharing the same toolbar and styling as CollaborativeEditor.

### Non-functional

**NF01**: Hocuspocus connection timeout for fallback detection: 3 seconds.

**NF02**: Snapshot on close should be best-effort — don't block drawer close if it fails.

**NF03**: Tenant isolation enforced via room name validation (already implemented in Hocuspocus server).

## Data / API

### Content format detection and conversion

```
Input: block_data from document_block_content (JSONB)
If Array.isArray(block_data) && block_data[0]?.props  → BlockNote format → convert
If block_data?.type === "doc"                          → ProseMirror format → use directly
Otherwise                                              → empty document
```

### Existing actions used
- `getBlockContent(documentId)` — load existing content
- `updateBlockContent(documentId, data)` — manual save in fallback mode
- `syncCollabSnapshot(documentId)` — snapshot Y.js state to DB
- `createBlockDocument(data)` — create new document + block content

### No new tables needed
- Hocuspocus manages its own persistence
- `document_block_content.block_data` stores the snapshot (format changes from BlockNote JSON to ProseMirror JSON)

## Risks

1. **Content format mismatch**: Existing documents in BlockNote JSON must be correctly converted. A buggy conversion could corrupt document content. Mitigation: write thorough conversion tests, preserve original data in a `_legacy_block_data` field or log.

2. **RichTextViewer compatibility**: RichTextViewer (BlockNote-based) is used elsewhere to render document content. After migration, `block_data` will be in ProseMirror format — RichTextViewer needs to handle both formats or be replaced for document contexts.

3. **Hocuspocus availability**: In production, Hocuspocus must be reliably available. The fallback exists, but if it triggers frequently it degrades the user experience.

## Acceptance Criteria

- [ ] Opening a document in the drawer loads the CollaborativeEditor
- [ ] Two users opening the same document see each other's cursors
- [ ] Changes sync in real-time between users
- [ ] Existing documents (BlockNote format) load correctly after conversion
- [ ] "Save" button writes content to `document_block_content`
- [ ] Closing the drawer triggers a snapshot
- [ ] When Hocuspocus is down, editor falls back to single-user mode with manual save
- [ ] New document creation works end-to-end
- [ ] Presence bar shows connected users
- [ ] Connection/save status is visible
