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
- Added numbered list item conversion test in `packages/documents/src/lib/blockContentFormat.test.ts` and marked T10 complete.
- Ran `npx vitest run ../packages/documents/src/lib/blockContentFormat.test.ts`.
- Added link inline conversion test in `packages/documents/src/lib/blockContentFormat.test.ts` and marked T11 complete.
- Ran `npx vitest run ../packages/documents/src/lib/blockContentFormat.test.ts`.
- Added mention inline conversion test in `packages/documents/src/lib/blockContentFormat.test.ts` and marked T12 complete.
- Ran `npx vitest run ../packages/documents/src/lib/blockContentFormat.test.ts` (tests passed but the command hit the 10s timeout after printing results).
- Added code block conversion test in `packages/documents/src/lib/blockContentFormat.test.ts` and marked T13 complete.
- Ran `npx vitest run ../packages/documents/src/lib/blockContentFormat.test.ts`.
- Added blockquote conversion test in `packages/documents/src/lib/blockContentFormat.test.ts` and marked T14 complete.
- Ran `npx vitest run ../packages/documents/src/lib/blockContentFormat.test.ts`.
- Added empty block conversion test in `packages/documents/src/lib/blockContentFormat.test.ts` and marked T15 complete.
- Ran `npx vitest run ../packages/documents/src/lib/blockContentFormat.test.ts`.
- Added recursive conversion to flatten `children` blocks in `packages/documents/src/lib/blockContentFormat.ts` plus a nested children test in `packages/documents/src/lib/blockContentFormat.test.ts` (T16).
- Ran `npx vitest run ../packages/documents/src/lib/blockContentFormat.test.ts`.
- Added `CollaborativeEditor.init.test.tsx` to cover ProseMirror load (no conversion) and BlockNote load (conversion + persistence), marking T17/T18 complete.
- Mocked `EditorToolbar` in the new test file to avoid editor API dependencies.
- Ran `npx vitest run ../packages/documents/src/components/CollaborativeEditor.init.test.tsx`.
- Extended `Documents.drawer.test.tsx` to assert Save triggers `syncCollabSnapshot` in collaborative mode (T19) and adjusted mock to set connection status via `useEffect`.
- Ran `npx vitest run ../packages/documents/src/components/Documents.drawer.test.tsx`.
- Added drawer close snapshot test in `Documents.drawer.test.tsx` and marked T20 complete.
- Ran `npx vitest run ../packages/documents/src/components/Documents.drawer.test.tsx`.

## Updates
- Fixed fallback mode timing loop by separating `isEditingDocument` from `isCollaborativeEdit` so the timeout can set fallback without immediately clearing it. Files: `packages/documents/src/components/Documents.tsx`.
- Test T21 now passes by waiting for the 3s timeout to switch to the fallback editor. Test: `packages/documents/src/components/Documents.drawer.test.tsx`.
- Added fallback mode save test (T22) asserting `updateBlockContent` runs when manual save is enabled. Enhanced `DocumentEditor` mock to drive unsaved state and content for fallback save. File: `packages/documents/src/components/Documents.drawer.test.tsx`.
- Added T23 test to confirm offline indicator appears in fallback mode (`Offline — manual save mode`). File: `packages/documents/src/components/Documents.drawer.test.tsx`.
- Added collaborative presence/caret tests in `packages/documents/src/components/CollaborativeEditor.init.test.tsx`:
  - Presence bar renders connected users from awareness state.
  - Collaboration caret render callback produces labeled cursor.
  - Collaboration extension configured with Yjs document for real-time sync.
- Added T27 test to ensure folder-mode new document creation calls `createBlockDocument` and opens the collab editor. Test: `packages/documents/src/components/Documents.drawer.test.tsx`.
- Added T28 test to ensure non-editable docs render the read-only viewer in the drawer. File: `packages/documents/src/components/Documents.drawer.test.tsx`.
- Added T29 test confirming document name input in drawer is editable. File: `packages/documents/src/components/Documents.drawer.test.tsx`.
- Added T30 test verifying unsaved changes confirmation appears when closing in fallback mode. Updated ConfirmationDialog mock to render when open. File: `packages/documents/src/components/Documents.drawer.test.tsx`.
- Marked T31 complete based on existing conversion persistence assertion in `packages/documents/src/components/CollaborativeEditor.init.test.tsx`.
- Added T32-T35 coverage in `packages/documents/src/components/CollaborativeEditor.init.test.tsx`:
  - Reopens content saved as ProseMirror JSON string.
  - Editor toolbar renders when editor is ready.
  - Emoticon extension included in editor configuration.
  - Link extension configured with autolink + linkOnPaste.
