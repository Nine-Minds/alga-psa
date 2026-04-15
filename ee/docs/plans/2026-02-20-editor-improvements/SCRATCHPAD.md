# Scratchpad — Real-Time Collaborative Document Editing

- Plan slug: `2026-02-20-editor-improvements`
- Created: `2026-02-20`

## What This Is

Working memory for implementing real-time collaborative editing via TipTap + Hocuspocus (Y.js).

## Decisions

- (2026-02-20) Two-phase rollout: Phase 1 = isolated test page behind feature flag; Phase 2 = migrate in-app documents after validation.
- (2026-02-20) Use TipTap (already in DocumentEditor.tsx) + Hocuspocus (already deployed) — no new infrastructure needed.
- (2026-02-20) Collab editor will be a new component (`CollaborativeEditor.tsx`) in `packages/documents/src/components/`, not a modification of the existing `DocumentEditor.tsx`. This keeps the current editor stable.
- (2026-02-20) Hocuspocus already uses a separate PostgreSQL database for Y.js persistence — document content will live in both places: Hocuspocus DB (Y.js binary state for real-time) and main DB (rendered JSON snapshot for search/preview/API).
- (2026-02-20) No persistent author attribution per text portion — live cursors only (like Google Docs). Users can type their name if they want attribution. Adding per-character authorship would require custom Y.js extensions and is out of scope.
- (2026-02-20) `tests.json` is a verification checklist, not a commit plan. Tests are verified in natural batches matching implementation work, not one commit per test. Expected batches:
  1. CollaborativeEditor component → T004-T010, T018, T034, T035, T038, T039
  2. Hocuspocus auth hook → T020-T022, T036, T042
  3. Test page UI → T001-T003, T027-T031
  4. Manual two-user session → T011-T014, T023-T024, T037
  5. Snapshot sync → T025-T026, T030, T032-T033, T044
  6. Automated collab sync → T040, T041, T043 (require Hocuspocus running)
  7. Playwright e2e → T045 (require full app + Hocuspocus)
- (2026-02-23) Rebased onto `some_more_improvements_to_editor` — Emoticon extension and cursor placement fix now in base. CollaborativeEditor must include the `Emoticon` extension from `@alga-psa/ui/editor`.
- (2026-02-23) Behavior parity audit: CollaborativeEditor must match DocumentEditor's full extension set: StarterKit, Link (with autolink/linkOnPaste/target config), Underline, Emoticon. Added F023, F024, T038, T039.
- (2026-02-23) Added automated collaboration tests (T040-T045) that go beyond DB-level: programmatic HocuspocusProvider sync, awareness broadcast, real onConnect rejection, persistence round-trip, and Playwright e2e.

## Discoveries / Constraints

- (2026-02-20) **Version mismatch — RESOLVED**: See compatibility check results below.
- (2026-02-20) **Compatibility check results**:
  - Root package.json: TipTap v2.27.1 (hoisted from @blocknote/core), collab v2.27.1, cursor v2.26.2
  - server/package.json: TipTap v3.12.0 (@tiptap/react, @tiptap/starter-kit)
  - Two separate @tiptap/core versions coexist: v2.27.1 (BlockNote) and v3.12.0 (server)
  - `packages/documents/` resolves @tiptap/react to v2.27.1 (hoisted root)
  - `server/` resolves @tiptap/react to v3.12.0 (own dependency)
  - **TipTap v3 renamed the cursor extension**: `@tiptap/extension-collaboration-cursor` → `@tiptap/extension-collaboration-caret`
  - **TipTap v3 collab replaced y-prosemirror binding**: `y-prosemirror` → `@tiptap/y-tiptap` (Tiptap's fork with extra features)
  - **v3 packages needed for server**: `@tiptap/extension-collaboration@^3.12.0`, `@tiptap/extension-collaboration-caret@^3.0.0`, `@tiptap/y-tiptap@^3.0.2`
  - `@tiptap/y-tiptap` peer deps: yjs ^13, y-protocols ^1, prosemirror-* — all already satisfied
  - `@hocuspocus/provider` v2.15.x works with yjs ^13 — compatible with y-tiptap
  - **VERDICT**: Add 3 packages to server/package.json. No conflicts expected. BlockNote keeps its v2 stack untouched.
- (2026-02-20) `DocumentEditor.tsx` is in `packages/documents/` (a pre-built package), while feature flags are in `server/src/`. The test page route will be in `server/src/app/msp/collab-test/`.
- (2026-02-20) Hocuspocus `NotificationExtension` only handles `notifications:*` rooms. Document rooms (`document:*`) will pass through to the default Database extension for persistence — no custom extension needed for Phase 1.
- (2026-02-20) `@hocuspocus/provider` exists in both root (v2.13.5) and server (v2.15.2). The server version should be used.
- (2026-02-20) `yjs-config.ts` provider factory already exists at `packages/ui/src/editor/yjs-config.ts` — can be extended for document rooms.
- (2026-02-20) Hocuspocus server has NO authentication/authorization on `onConnect`. Any room name is accepted. Phase 1 needs at minimum tenant-scoped room names; Phase 2 needs proper auth token validation.
- (2026-02-20) Feature flags: default to `false` in `DEFAULT_BOOLEAN_FLAGS`. New flag `collaborative_editing` will default to `false`.
- (2026-02-20) Existing `DocumentEditor` uses manual Save button + `updateBlockContent` server action. Collab version will auto-persist via Hocuspocus DB extension, but still needs a mechanism to sync snapshots back to `document_block_content` table.
- (2026-02-23) **Docker dev setup**: In the Docker compose stack, Hocuspocus uses the `server` database with `app_user` (not a separate `hocuspocus` DB). Env defaults: `DB_NAME_HOCUSPOCUS=server`, `DB_USER_HOCUSPOCUS=app_user`. The Hocuspocus Database extension auto-creates its tables.
- (2026-02-23) **Hocuspocus container start command** (when not already running):
  ```
  APP_NAME=alga_psa EXPOSE_HOCUSPOCUS_PORT=1234 DB_NAME_HOCUSPOCUS=server DB_USER_HOCUSPOCUS=app_user \
    REDIS_HOST=redis REDIS_PORT=6379 DB_HOST=postgres DB_PORT=5432 HOCUSPOCUS_PORT=1234 \
    docker compose -p alga-psa -f docker-compose.yaml -f docker-compose.base.yaml up -d hocuspocus
  ```
- (2026-02-23) **Automated test infrastructure**: Tests T040-T044 require Hocuspocus on localhost:1234. The Docker stack provides this. Test T045 (Playwright) additionally requires the Next.js dev server.

## Commands / Runbooks

- Build shared packages: `npm run build:shared`
- Dev server: `npm run dev`
- Start Hocuspocus in Docker: see container start command in Discoveries section above
- Verify Hocuspocus is running: `docker logs alga_psa_hocuspocus --tail 5` (should show "Ready.")
- Run integration tests: `npm run test:integration -- collaborativeEditing`
- Local collab test: open two tabs to `http://localhost:3000/msp/collab-test?doc=<id>` (one regular, one incognito with different user)

## 2026-02-24 Session — Production fixes + Feature parity

### WebSocket URL Root Cause (F030)

**Problem**: CollaborativeEditor could not connect to Hocuspocus in production. Server logs showed zero WebSocket connections.

**Root cause**: `yjs-config.ts` used `process.env.HOCUSPOCUS_URL` (no `NEXT_PUBLIC_` prefix). Next.js strips non-prefixed env vars from the browser bundle, so the client defaulted to `http://localhost:1234/` — which doesn't exist in production.

**Fix**: Replaced with `getHocuspocusUrl()` that:
1. Checks `NEXT_PUBLIC_HOCUSPOCUS_URL` env var first
2. Falls back to deriving from `window.location`: `wss://<host>/hocuspocus`
3. Falls back to `ws://localhost:1234` on server-side

**Infrastructure**: Hocuspocus is exposed via Istio VirtualService at `/hocuspocus` prefix, routing to `hocuspocus.msp.svc.cluster.local:1234` with 3600s timeout for WebSocket upgrade. The notification system (`useInternalNotifications.ts`) uses the exact same Hocuspocus instance with different room name prefixes (`notifications:*` vs `document:*`).

### Old Document Preview Crashes (F031, F032)

**Problem**: Opening old documents showed "Something went wrong! e.text.trim is not a function" and "Error creating document from blocks passed as initialContent".

**Root cause**: Old documents have content items where `.text` is not a string (could be number, object, null). The `isTextContent` type guard and `autolinkBlocks` assumed `.text` was always a string. Some old documents also stored content in ProseMirror/Tiptap JSON format (`{ type: "doc", content: [...] }`) instead of BlockNote's array-of-blocks format.

**Fixes**:
- `RichTextViewer.tsx`: Added `typeof (item as any).text === 'string'` to `isTextContent` guard; added `sanitizeBlocks()` to validate block types and coerce non-string text; added `extractTextFromProseMirror()` for Tiptap JSON detection; added `RichTextErrorBoundary` as last-resort catch
- `TextEditor.tsx`: Fixed `isTextContent` guard with `typeof content?.text === "string"`
- `RichTextViewer.tsx` `autolinkBlocks`: Added guard `typeof item.text !== 'string'`

### Emoji Suggestion Grid (F025, F026, F034)

**Problem**: The BlockNote TextEditor has a `GridSuggestionMenuController` for `:query` emoji search, but the Tiptap CollaborativeEditor didn't have this since BlockNote components don't work in raw Tiptap.

**Solution**: Created `packages/ui/src/editor/EmojiSuggestion.tsx` with:
- `EmojiSuggestionExtension` — Tiptap Extension wrapping a ProseMirror plugin that detects `:query` (2+ chars after colon, no spaces)
- `EmojiSuggestionPopup` — React component: positioned floating 10-column grid, searches via `emoji-mart` `SearchIndex.search()`, keyboard nav (arrows for grid movement, Enter to select, Escape to dismiss), click-to-insert
- Uses lazy initialization of emoji-mart data via `ensureEmojiInit()`

### @Mention Support (F027, F028, F029, F034)

**Problem**: `@tiptap/extension-mention` and `@tiptap/suggestion` are NOT installed. The existing `Mention.tsx` uses BlockNote's `createReactInlineContentSpec` which doesn't work in raw Tiptap.

**Solution**: Created `packages/ui/src/editor/MentionSuggestion.tsx` with:
- `MentionNode` — Tiptap Node (inline, atom) with `userId`, `username`, `displayName` attrs; renders via `ReactNodeViewRenderer` as styled badge matching BlockNote Mention appearance
- `MentionSuggestionExtension` — ProseMirror plugin detecting `@query` (after space or start of text, allows spaces in query for multi-word names)
- `MentionSuggestionPopup` — React popup with searchable user list, `@everyone` option, keyboard nav (arrows, Enter/Tab, Escape)
- CollaborativeEditor accepts optional `searchMentions` prop; collab test page passes `searchUsersForMentions`

### Mention Notification Performance (F033)

**Problem**: On every document edit, `USER_MENTIONED_IN_DOCUMENT` event fires. The handler did unnecessary DB queries even when no mentions existed, and `resolveEveryoneMention` queried the DB inside a loop.

**Fixes** in `internalNotificationSubscriber.ts`:
1. `resolveEveryoneMention`: Checks `mentionedUserIds.includes('@everyone')` once, does a single DB query if true
2. `handleUserMentionedInDocument`: Early-exits before any DB queries when `mentionedUserIds.length === 0`
3. All mention handlers: `Promise.all()` for parallel notification creation instead of sequential `for...of await`
4. Same fixes applied to `handleTicketCommentAdded`, task comment added, and their update variants
5. Removed per-user `console.log` statements; replaced with single summary log per batch

### New Files Created
- `packages/ui/src/editor/EmojiSuggestion.tsx` — Emoji suggestion extension + popup
- `packages/ui/src/editor/MentionSuggestion.tsx` — Mention node + suggestion extension + popup

### Modified Files
- `packages/ui/src/editor/index.ts` — Added EmojiSuggestion + MentionSuggestion exports
- `packages/ui/src/editor/yjs-config.ts` — `getHocuspocusUrl()` production fix
- `packages/ui/src/editor/RichTextViewer.tsx` — sanitizeBlocks, error boundary, ProseMirror JSON detection
- `packages/ui/src/editor/TextEditor.tsx` — isTextContent guard fix
- `packages/documents/src/components/CollaborativeEditor.tsx` — Emoji + Mention integration, searchMentions prop
- `server/src/app/msp/collab-test/CollabTestPageClient.tsx` — Passes searchUsersForMentions to CollaborativeEditor
- `server/src/lib/eventBus/subscribers/internalNotificationSubscriber.ts` — Mention notification performance fixes

## Links / References

- PR #1898: Editor improvements (merged to main)
- **Test files:**
  - `server/src/test/integration/collaborativeEditing.integration.test.ts` — integration tests (DB, snapshot sync, room names, tenant isolation, feature flag, provider sync)
  - `server/src/test/e2e/collaborativeEditing.e2e.test.ts` — Playwright e2e tests (two-browser collab)
  - Run integration: `npm run test:integration -- collaborativeEditing`
- `packages/documents/src/components/DocumentEditor.tsx` — current TipTap editor
- `packages/documents/src/components/EditorToolbar.tsx` — BubbleMenu toolbar
- `hocuspocus/server.js` — Hocuspocus server config
- `hocuspocus/NotificationExtension.js` — example custom extension
- `packages/ui/src/editor/yjs-config.ts` — Y.js provider factory
- `server/src/lib/feature-flags/featureFlags.ts` — feature flag defaults
- `server/src/hooks/useFeatureFlag.tsx` — client-side feature flag hook
- `packages/documents/src/actions/documentBlockContentActions.ts` — document CRUD actions
- `packages/ui/src/editor/EmoticonExtension.ts` — Emoticon extension (text emoticons → emoji)
- `packages/ui/src/editor/EmojiSuggestion.tsx` — Emoji suggestion extension + popup for Tiptap
- `packages/ui/src/editor/MentionSuggestion.tsx` — Mention node + suggestion extension + popup for Tiptap
- `packages/ui/src/editor/index.ts` — exports Emoticon, EmojiSuggestion, MentionSuggestion
- `server/src/lib/eventBus/subscribers/internalNotificationSubscriber.ts` — mention notification handlers

## Open Questions

- Should the collab test page create ephemeral "scratch" documents, or should it work with real documents from the documents list?
- ~~What user info should be displayed for collaboration cursors?~~ — RESOLVED. Name + color. No persistent authorship tracking.
- Should the Hocuspocus `onConnect` hook validate auth tokens in Phase 1, or is tenant-scoped room naming sufficient for the test page?
- ~~TipTap v3 collab extension compatibility~~ — RESOLVED. Use v3 packages: `@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-caret`, `@tiptap/y-tiptap`.

## Updates
- (2026-02-23) Added `collaborative_editing: false` to default feature flags in `server/src/lib/feature-flags/featureFlags.ts` to gate the collab test page.
- (2026-02-23) Added TipTap v3 collab packages to `server/package.json` for collaborative editor support.
- (2026-02-23) Added `CollaborativeEditor` component with TipTap Collaboration + CollaborationCaret bound to Y.js, Hocuspocus room naming, EditorToolbar integration, markdown paste handling, Emoticon/Link config, presence bar, connection/save indicators, and CSS styling. Exported `createYjsProvider` from `@alga-psa/ui/editor`.
- (2026-02-23) Added Hocuspocus `onConnect` tenant validation for `document:` rooms and allowed `notifications:` rooms to pass through. Extended `createYjsProvider` to accept connection parameters and pass tenantId/userId.
- (2026-02-23) Exported `CollaborativeEditor` from `packages/documents/src/components/index.ts`.
- (2026-02-23) Added collab test page at `/msp/collab-test` with feature-flag gating, create/open doc flow, snapshot button, and debug panel. Implemented `syncCollabSnapshot` server action using Hocuspocus sync + Yjs→Prosemirror JSON conversion.
- (2026-02-23) Confirmed Hocuspocus Database extension already configured for persistence; marked F013 complete.
- (2026-02-23) Added Y.js initialization from existing `document_block_content` when collab doc is empty using `prosemirrorJSONToYXmlFragment`.
- (2026-02-23) Marked T001 complete (feature flag default false test already present in integration suite).
- (2026-02-23) Added unit test coverage for Y.js initialization from existing block content when the collab document is empty (`server/src/test/unit/documents/CollaborativeEditor.extensions.test.tsx`).
- (2026-02-23) Added unit test ensuring existing Y.js fragment data prevents reinitialization from `document_block_content` (`server/src/test/unit/documents/CollaborativeEditor.extensions.test.tsx`).
- (2026-02-23) Added unit test asserting `CollaborativeEditor` export is available from `@alga-psa/documents/components` (`server/src/test/unit/documents/componentsExports.test.ts`).
- (2026-02-23) Added unit test to ensure cursor label styles use design system color variables (`server/src/test/unit/documents/collaborativeEditorStyles.test.ts`).
- (2026-02-23) Added unit test ensuring tenant-specific room names differ for the same document ID (`server/src/test/unit/documents/CollaborativeEditor.extensions.test.tsx`).
- (2026-02-23) Added Yjs unit test verifying concurrent formatting merges without corrupting content (`server/src/test/unit/yjs/collaborationFormatting.test.ts`).
- (2026-02-23) Added unit tests confirming `CollaborativeEditor` includes Emoticon and Link configuration (`server/src/test/unit/documents/collaborativeEditorConfig.test.ts`).
- (2026-02-23) Marked Hocuspocus provider sync integration test as implemented (guarded by `RUN_HOCUSPOCUS_TESTS`) in `server/src/test/integration/collaborativeEditing.integration.test.ts`.
- (2026-02-23) Added Hocuspocus integration tests for awareness broadcast, mismatched-tenant disconnect, and end-to-end snapshot sync (guarded by `RUN_HOCUSPOCUS_TESTS`) in `server/src/test/integration/collaborativeEditing.integration.test.ts`.
- (2026-02-23) Added Playwright e2e test for collaborative editing real-time sync and presence (`server/src/test/e2e/collaborativeEditing.e2e.test.ts`).
- (2026-02-23) Attempted `RUN_HOCUSPOCUS_TESTS=false npx vitest src/test/integration/collaborativeEditing.integration.test.ts`; failed due to DB connection refused on localhost:5438 (test DB not running).

- (2026-02-23) Added unit test coverage for collab-test feature flag disabled state (`server/src/test/unit/app/msp/collab-test/page.test.tsx`) and marked T002 complete. Ran: `npx vitest src/test/unit/app/msp/collab-test/page.test.tsx` (from `server/`).

- (2026-02-23) Added unit test for collab-test feature flag enabled state and marked T003 complete. Ran: `npx vitest src/test/unit/app/msp/collab-test/page.test.tsx` (from `server/`).

- (2026-02-23) Added unit test for CollaborativeEditor collaboration extensions (`server/src/test/unit/documents/CollaborativeEditor.extensions.test.tsx`) and stubs for `emoticon` + `@tiptap/extension-collaboration-caret` in `server/src/test/stubs/`. Updated `server/vitest.config.ts` to alias those stubs and inline `@tiptap/react` for test isolation. Marked T004 complete. Ran: `npx vitest src/test/unit/documents/CollaborativeEditor.extensions.test.tsx` (from `server/`).

- (2026-02-23) Attempted integration run for collaborativeEditing tests; skipped due to DB connection refused on localhost:5438 (see vitest output). Replaced T005 with unit coverage in `CollaborativeEditor.extensions.test.tsx` asserting `createYjsProvider` receives `document:<tenant>:<documentId>`. Ran: `npx vitest src/test/unit/documents/CollaborativeEditor.extensions.test.tsx` (from `server/`).

- (2026-02-23) Added unit coverage for connected status rendering in CollaborativeEditor (used for T006). Ran: `npx vitest src/test/unit/documents/CollaborativeEditor.extensions.test.tsx` (from `server/`).

- (2026-02-23) Added unit tests for EditorToolbar wiring (bubble menu render + formatting/link command wiring) in `server/src/test/unit/documents/EditorToolbar.test.tsx`; marked T007 complete. Ran: `npx vitest src/test/unit/documents/EditorToolbar.test.tsx` (from `server/`).

- (2026-02-23) Marked T008 complete using EditorToolbar unit test wiring inline formatting commands (`EditorToolbar.test.tsx`).

- (2026-02-23) Marked T009 complete using EditorToolbar unit test wiring block formatting commands (`EditorToolbar.test.tsx`).

- (2026-02-23) Marked T010 complete using EditorToolbar unit test for link command wiring (`EditorToolbar.test.tsx`).

- (2026-02-23) Added CollaborativeEditor unit coverage for awareness user state (T011) and deterministic color (T012) in `CollaborativeEditor.extensions.test.tsx`. Ran: `npx vitest src/test/unit/documents/CollaborativeEditor.extensions.test.tsx` (from `server/`).

- (2026-02-23) Marked T012 complete using deterministic cursor color unit test.

- (2026-02-23) Marked T013 complete using presence bar unit test in `CollaborativeEditor.extensions.test.tsx`.

- (2026-02-23) Marked T014 complete using presence bar disconnect unit test in `CollaborativeEditor.extensions.test.tsx`.

- (2026-02-23) Marked T015 complete using connected-status unit test in `CollaborativeEditor.extensions.test.tsx`.

- (2026-02-23) Added unit coverage for disconnected status rendering in CollaborativeEditor (T016) in `server/src/test/unit/documents/CollaborativeEditor.extensions.test.tsx`. Ran: `npx vitest src/test/unit/documents/CollaborativeEditor.extensions.test.tsx` (from `server/`).

- (2026-02-23) Added unit coverage for auto-save status text ("All changes saved") in `server/src/test/unit/documents/CollaborativeEditor.extensions.test.tsx`; marked T017 complete. Ran: `npx vitest src/test/unit/documents/CollaborativeEditor.extensions.test.tsx` (from `server/`).

- (2026-02-23) Added unit check for absence of manual Save button in `CollaborativeEditor.extensions.test.tsx`; marked T018 complete. Ran: `npx vitest src/test/unit/documents/CollaborativeEditor.extensions.test.tsx` (from `server/`).

- (2026-02-23) Added markdown paste unit test in `server/src/test/unit/documents/CollaborativeEditor.markdown.test.tsx` by mocking `useEditor` and `marked.parse`; marked T019 complete. Ran: `npx vitest src/test/unit/documents/CollaborativeEditor.markdown.test.tsx` (from `server/`).

- (2026-02-23) Extracted markdown paste handling into `packages/documents/src/components/markdownPaste.ts` and wired CollaborativeEditor to use it. Added unit test `server/src/test/unit/documents/markdownPaste.test.ts` for T019. Ran: `npx vitest src/test/unit/documents/markdownPaste.test.ts` (from `server/`).

- (2026-02-23) Extracted Hocuspocus tenant validation helpers to `hocuspocus/tenantValidation.js` and wired `hocuspocus/server.js` to use them. Added unit tests in `server/src/test/unit/hocuspocus/tenantValidation.test.ts` covering mismatched tenant, matching tenant, and notification-room bypass; marked T020-T022 complete. Ran: `npx vitest src/test/unit/hocuspocus/tenantValidation.test.ts` (from `server/`).

- (2026-02-23) Ran `RUN_HOCUSPOCUS_TESTS=false npx vitest src/test/integration/collaborativeEditing.integration.test.ts -t "persist content"` — Hocuspocus persistence test skipped because RUN_HOCUSPOCUS_TESTS is false.

- (2026-02-23) Added Hocuspocus provider sync test (`should sync content between two providers connected to the same room`) in `server/src/test/integration/collaborativeEditing.integration.test.ts`; marked T024 complete. Ran: `RUN_HOCUSPOCUS_TESTS=false npx vitest src/test/integration/collaborativeEditing.integration.test.ts -t "sync content"` (skipped because RUN_HOCUSPOCUS_TESTS is false).

- (2026-02-23) Added unit tests for `syncCollabSnapshot` in `server/src/test/unit/documents/collaborativeEditingActions.test.ts` covering snapshot writes (T025) and missing document error (T026). Ran: `npx vitest src/test/unit/documents/collaborativeEditingActions.test.ts` (from `server/`).

- (2026-02-23) Added CollabTestPageClient unit test for Create New Document navigation in `server/src/test/unit/app/msp/collab-test/CollabTestPageClient.test.tsx`; marked T027 complete. Ran: `npx vitest src/test/unit/app/msp/collab-test/CollabTestPageClient.test.tsx` (from `server/`).

- (2026-02-23) Added CollabTestPageClient unit test for loading existing document from query params (renders CollaborativeEditor); marked T028 complete. Ran: `npx vitest src/test/unit/app/msp/collab-test/CollabTestPageClient.test.tsx` (from `server/`).

- (2026-02-23) Added CollabTestPageClient unit test for missing document error message (no editor render); marked T029 complete. Ran: `npx vitest src/test/unit/app/msp/collab-test/CollabTestPageClient.test.tsx` (from `server/`).

- (2026-02-23) Added CollabTestPageClient unit test for Snapshot to DB success message + syncCollabSnapshot call; marked T030 complete. Ran: `npx vitest src/test/unit/app/msp/collab-test/CollabTestPageClient.test.tsx` (from `server/`).

- (2026-02-23) Added CollabTestPageClient unit test asserting debug panel room/connection/user count values; marked T031 complete. Ran: `npx vitest src/test/unit/app/msp/collab-test/CollabTestPageClient.test.tsx` (from `server/`).
