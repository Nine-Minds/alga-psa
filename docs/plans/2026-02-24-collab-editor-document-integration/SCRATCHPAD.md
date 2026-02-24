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
