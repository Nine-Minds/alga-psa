# Scratchpad — Collaborative Editor Document Integration

## Key Discoveries

### Current architecture
- Documents are edited **in a drawer** (`Documents.tsx`), not a dedicated page
- Drawer uses `TextEditor` (BlockNote) for editing, `RichTextViewer` for viewing
- `CollaborativeEditor` uses **Tiptap** (not BlockNote) — different editor, different JSON schema
- `DocumentEditor` (also Tiptap) exists but is **NOT actively used** anywhere in the app
- Content stored in `document_block_content.block_data` as JSONB

### Content format mismatch (CRITICAL)
- **BlockNote JSON**: `[{ type: "paragraph", props: {...}, content: [{ type: "text", text: "...", styles: {} }] }]`
- **Tiptap/ProseMirror JSON**: `{ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "..." }] }] }`
- Existing documents created via `TextEditor` are in BlockNote format
- `CollaborativeEditor` reads/writes ProseMirror format
- Need a conversion layer or format detection on load

### Hocuspocus infrastructure
- Server: `hocuspocus/server.js` on port 1234
- Room naming: `document:<tenantId>:<documentId>`
- Tenant validation in `tenantValidation.js`
- `createYjsProvider` in `packages/ui/src/editor/yjs-config.ts`
- Env vars: `HOCUSPOCUS_URL` (default http://localhost), `HOCUSPOCUS_PORT` (default 1234)

### Snapshot/persistence
- `syncCollabSnapshot()` in `collaborativeEditingActions.ts` already works
- Converts Y.js XML fragment → ProseMirror JSON → `document_block_content.block_data`
- Hocuspocus Database extension also persists to its own tables

### Key file paths
- `packages/documents/src/components/Documents.tsx` — main documents page with drawer
- `packages/documents/src/components/CollaborativeEditor.tsx` — collab editor
- `packages/documents/src/components/DocumentEditor.tsx` — unused single-user Tiptap editor
- `packages/documents/src/actions/documentBlockContentActions.ts` — CRUD actions
- `packages/documents/src/actions/collaborativeEditingActions.ts` — snapshot sync
- `packages/ui/src/editor/TextEditor.tsx` — BlockNote editor (used in drawer today)
- `packages/ui/src/editor/yjs-config.ts` — Y.js provider factory
- `hocuspocus/server.js` — Hocuspocus WebSocket server

## Decisions

1. **Keep drawer UX** — replace TextEditor inside drawer with CollaborativeEditor
2. **Graceful fallback** — detect Hocuspocus availability, fall back to current editor
3. **Keep Save button** — auto-sync via Y.js, but keep explicit Save/Snapshot for confidence
4. **Content format**: need to handle both BlockNote and ProseMirror JSON in DB

## Open Questions

- How many existing documents are in BlockNote format vs ProseMirror format?
- Should we convert existing documents eagerly (migration) or lazily (on first open)?

## Progress

- Replaced drawer edit mode for existing in-app documents to render `CollaborativeEditor` (kept BlockNote editor only for new-document flow for now). Placeholder tenant/user display info used until F02 wiring.
- Wired current user lookup in `Documents.tsx` to supply tenant/user identity to `CollaborativeEditor` for proper Hocuspocus room naming.
- Added `blockContentFormat` helper with JSON parsing + format detection (BlockNote vs ProseMirror vs empty/unknown).
- Implemented initial BlockNote-to-ProseMirror conversion for paragraph blocks in `blockContentFormat`.
- Added heading block conversion with level mapping to ProseMirror heading nodes.
- Added BlockNote list item conversion to ProseMirror bullet/ordered list nodes.
- Expanded inline conversion to map text styles, links, and mentions to ProseMirror marks/text.
- Added conversion support for checklists, code blocks, blockquotes, and table fallbacks.
- Collaborative editor now initializes Y.js state from existing block_data with BlockNote conversion when needed.
- Save button in drawer now triggers collaborative snapshot sync when using the collab editor.
- Added best-effort snapshot on drawer close for collaborative sessions.
- Added 3s Hocuspocus timeout handling to switch drawer editor into fallback mode.
- Fallback editor now uses `DocumentEditor` with drawer-level save via `updateBlockContent` and shared toolbar/styling.
- Added fallback status banner: "Offline — manual save mode".
- Presence bar and collaboration cursors are available via `CollaborativeEditor` in the drawer context.
- New document creation now pre-creates document + block_content and opens the collaborative editor in the new room.
- Added read-only `DocumentViewer` (Tiptap) for drawer view mode to render BlockNote or ProseMirror content.
- Document name input remains editable and wired to update document name on save in both collab and fallback modes.
- Unsaved changes warning now accounts for fallback editor changes before closing the drawer.
- BlockNote-to-ProseMirror conversion now persists converted JSON back to `document_block_content`.
- Added drawer test coverage to ensure CollaborativeEditor renders on edit of in-app documents.
- Synced entity-mode drawer rendering with collaborative/fallback editor logic (avoids legacy BlockNote path).
- Added test ensuring `CollaborativeEditor` uses `document:<tenantId>:<documentId>` room naming.
- Added format detection test for BlockNote JSON.
- Added format detection test for ProseMirror JSON.
- Added empty/null format detection test.
- Added paragraph conversion test for BlockNote → ProseMirror.
- Added styled text conversion test for bold/italic/underline marks.

## 2026-02-24 Updates
- Added heading conversion test for BlockNote -> ProseMirror (levels 1-3) in `packages/documents/src/lib/blockContentFormat.test.ts` and marked T08 complete.
- Ran `npx vitest run ../packages/documents/src/lib/blockContentFormat.test.ts`.
- Added bullet list item conversion test in `packages/documents/src/lib/blockContentFormat.test.ts` and marked T09 complete.
- Ran `npx vitest run ../packages/documents/src/lib/blockContentFormat.test.ts`.
