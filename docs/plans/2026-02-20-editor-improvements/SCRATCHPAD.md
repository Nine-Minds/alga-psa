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
- `packages/ui/src/editor/index.ts` — exports Emoticon extension

## Open Questions

- Should the collab test page create ephemeral "scratch" documents, or should it work with real documents from the documents list?
- ~~What user info should be displayed for collaboration cursors?~~ — RESOLVED. Name + color. No persistent authorship tracking.
- Should the Hocuspocus `onConnect` hook validate auth tokens in Phase 1, or is tenant-scoped room naming sufficient for the test page?
- ~~TipTap v3 collab extension compatibility~~ — RESOLVED. Use v3 packages: `@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-caret`, `@tiptap/y-tiptap`.

## Updates
- (2026-02-23) Added `collaborative_editing: false` to default feature flags in `server/src/lib/feature-flags/featureFlags.ts` to gate the collab test page.
- (2026-02-23) Added TipTap v3 collab packages to `server/package.json` for collaborative editor support.
