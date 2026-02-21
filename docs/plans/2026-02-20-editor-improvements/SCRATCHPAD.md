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
  1. CollaborativeEditor component → T004-T010, T018, T034, T035
  2. Hocuspocus auth hook → T020-T022, T036
  3. Test page UI → T001-T003, T027-T031
  4. Manual two-user session → T011-T014, T023-T024, T037
  5. Snapshot sync → T025-T026, T030, T032-T033

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

## Commands / Runbooks

- Build shared packages: `npm run build:shared`
- Dev server: `npm run dev`
- Hocuspocus dev: `cd hocuspocus && node server.js`
- Docker hocuspocus: check `docker-compose.base.yaml` for hocuspocus service
- Create hocuspocus DB (one-time): `CREATE DATABASE hocuspocus;` + create user `hocuspocus_user`
- Local collab test: open two tabs to `http://localhost:3000/msp/collab-test?doc=<id>` (one regular, one incognito with different user)

## Links / References

- PR #1898: Editor improvements (merged to main)
- **Test files:**
  - `server/src/test/integration/collaborativeEditing.integration.test.ts` — integration tests (DB, snapshot sync, room names, tenant isolation, feature flag)
  - Run: `npm run test:integration -- collaborativeEditing`
- `packages/documents/src/components/DocumentEditor.tsx` — current TipTap editor
- `packages/documents/src/components/EditorToolbar.tsx` — BubbleMenu toolbar
- `hocuspocus/server.js` — Hocuspocus server config
- `hocuspocus/NotificationExtension.js` — example custom extension
- `packages/ui/src/editor/yjs-config.ts` — Y.js provider factory
- `server/src/lib/feature-flags/featureFlags.ts` — feature flag defaults
- `server/src/hooks/useFeatureFlag.tsx` — client-side feature flag hook
- `packages/documents/src/actions/documentBlockContentActions.ts` — document CRUD actions

## Open Questions

- Should the collab test page create ephemeral "scratch" documents, or should it work with real documents from the documents list?
- ~~What user info should be displayed for collaboration cursors?~~ — RESOLVED. Name + color. No persistent authorship tracking.
- Should the Hocuspocus `onConnect` hook validate auth tokens in Phase 1, or is tenant-scoped room naming sufficient for the test page?
- ~~TipTap v3 collab extension compatibility~~ — RESOLVED. Use v3 packages: `@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-caret`, `@tiptap/y-tiptap`.
