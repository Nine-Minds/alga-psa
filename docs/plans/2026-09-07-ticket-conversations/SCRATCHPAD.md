# Ticket conversations — working notes

## Design status and placement

- Product scope was discussed and accepted incrementally before planning. The user selected option C (persistent conversation navigator) and explicitly requested the ALGA plan in the workflow-expected location. That authorization covers producing the synchronized PRD and checklists; no new design interview is required.
- The card's Draft Implementation verification explicitly discovers a design plan under `docs/plans/`. Therefore this folder intentionally overrides the alga-plan skill's default `ee/docs/plans/` location, following the user's location instruction. All four artifacts live together; no duplicate PRD.
- The work is stacked on `feature/co-managed-it`; inherited base at planning is `a475996666b6cc303407ecf9d2b50bcfabcb5f39`. Parent plan: [Co-Managed IT](../2026-09-06-co-managed-it-plan.md). The parent remains a dependency, not evidence that every requirement in its PRD is shipped.
- The card explicitly requires `release-v1-6-feature` around new UI only. Backend, APIs, routes and authorization must not depend on this release flag.
- Individually restricted technician conversations are follow-up scope. Organization-private audiences remain essential in this release.

## Prototype evidence

- Three local standalone HTML options are under `/tmp/alga-ticket-conversations-prototypes/`; C is `03-conversation-navigator.html`, and `index.html` compares all three.
- Checked all three in headless Chromium at desktop and mobile sizes: per-author draft persistence, reviewed selective share, audience filtering, scoped AI context, explicit regeneration, default/opt-in/cutoff reply policy, creation and sending. No JavaScript errors. Screenshots and `verification.txt` reside alongside the HTML.
- These are simulated design artifacts, not application or server-security tests. All fixture data is embedded in each HTML. The persona switch is an access demonstration, not a client-portal redesign. Synthesis responses are canned; the late-reply follow-up is an activity event.
- `/tmp` artifacts are disposable. The PRD captures the chosen layout and interaction contract in text so implementation does not depend on their continued availability.

## Working decisions

- Ordinary tickets open on requester conversation; explicit deep links open their destination. Persist drafts per qualified author and conversation, not per ticket globally.
- Drafts are private to their author as the proposed default adopted for planning; collaborative drafts and delegation are not introduced.
- Sending uses a stable explicitly authorized mailbox: ticket-owning workspace for requester; originating organization for vendor. Shared IT visibility does not grant sending authority.
- Named conversations are containers above existing comment reply roots. Never map every `comment_threads` root to a sidebar conversation.
- Vendor recipient additions from accepted correlated replies do not grant application access. No automatic forwarding of ticket history.
- Share and synthesis create explicit editable copies; private source provenance stays protected. Attachments are selected, never copied en masse by default.
- Vendor/AI activity does not fulfill requester-response obligations. Board side-reply opt-in defaults off and reuses the existing policy when on.

## Existing code discoveries

- `packages/tickets/src/components/ticket/TicketDetails.tsx` supports grid and entry preferences; grid uses `bento/TicketBentoLayout`. Preserve entry and embedded-drawer compatibility.
- `packages/tickets/src/components/ticket/TicketConversation.tsx` owns existing reply rendering, comment-order preference and reactions; named navigation must preserve these capabilities.
- `packages/co-managed/src/ticketConversation.ts`, `privateTicketConversation.ts`, `sharedWork.ts`, `sharedWorkIdentity.ts`, and `conversationPolicy.ts` already establish qualified identity, authorized reads and separate private storage.
- `packages/co-managed/src/conversationDrafts.ts` is an immutable, operation-keyed publication reservation protocol for staged attachment messages. Its current request requires at least one file. It is NOT an editable text autosave model. Extend or adapt deliberately; do not overwrite immutable reservations on each keystroke or route ordinary local tickets through a co-managed license check.
- `packages/co-managed/src/conversationAttachments.ts`, disclosure modules, inbound reply admission, notification recipients and event outbox modules are reuse points. Compare their actual APIs before changing schema.
- `shared/services/email/processInboundEmailInApp.ts` reads `inbound_reply_reopen_enabled`, `inbound_reply_reopen_cutoff_hours`, `inbound_reply_reopen_status_id`, and `inbound_reply_ai_ack_suppression_enabled`. Default enabled is false, normalized cutoff 168 hours. Explicit valid open status wins, otherwise board default open status. Cutoff handling occurs before automated/ack suppression. Within-window internal technician replies retain existing reopen behavior; existing automated-message/rate protections remain.
- `packages/tickets/src/components/settings/BoardsSettings.tsx` and `actions/board-actions/boardActions.ts` surface/persist these settings. `ticketBundleUtils.ts` also has `reopen_on_child_reply`; side traffic must not be misclassified as a requester/child reply.
- AI integration candidates: `ee/server/src/services/chatCompletionsService.ts`, `chatStreamService.ts`, and `lib/chat-actions/chatActions.tsx`; use current provider/entitlement policy, with server-side audience filtering before inference.

## Commands and verification

- Plan validation: `python3 /home/robert/.codex/skills/alga-plan/scripts/validate_plan.py docs/plans/2026-09-07-ticket-conversations`.
- Confirm feature/test IDs are unique, every mapped feature exists, PRD section references resolve, and all checklist entries begin false.
- Parent comparison is against the stacked parent branch, not an unqualified whole `main` diff that would attribute parent changes to this card.
- Two pre-existing setup changes are outside this plan: root lockfile SDK normalization and migration CLI executable mode. Preserve them.
- Implementation must append actual schema/API choices and test evidence here. Prototype validation does not mark product features or tests implemented.

## Planning completion

- Estimated a modular workflow plan of roughly 100 features before generating the checklist; final scope is 102 atomic feature entries and 35 representative tests. All entries are false. Tests map to the specific behaviors they exercise, with migrated PostgreSQL happy/guard paths and actual browser/email journeys.
- The main alga-plan skill's current Pareto test guidance takes precedence over its older format reference suggesting more tests than features.
- Validated required JSON fields, unique stable IDs, PRD heading references, complete feature-to-test traceability, and unimplemented status. No application implementation/test completion is claimed.
- Persisted planning scope includes all accepted capabilities: vendor email, optional AI, selective sharing, full-source synthesis, parent audience/ownership integration, option C, and reuse of existing board policy. No individual restriction or autonomous-send work added.

## Implementation checkpoint — named containers and editor drafts

- Added migrations `20260908013607_create_named_ticket_conversations.cjs` and `20260908015652_create_ticket_conversation_editor_drafts.cjs` through the repository Knex scaffolder. Named containers are separate from reply roots, use qualified ticket/store references, default audience slots, revisions, independent Open/Done and mailbox identity fields. Existing consistent native roots are grouped by audience; private ticket roots stay in their home store. Inconsistent root/reply flags remain unassigned for guarded handling rather than being broadened. Replay preserves existing mappings; rollback refuses retained conversation/draft records.
- Added `shared/lib/tickets/namedConversations.ts` (transactional storage engine), `packages/co-managed/src/namedTicketConversations.ts` (current home session + native/shared ticket authorization), and `server/src/lib/actions/namedTicketConversationActions.ts` (unflagged authenticated commands). Native PSA operations use native RBAC/bundle policy with no co-managed entitlement prerequisite. Private names never enter the other organization's store/list.
- Added `shared/lib/tickets/conversationEditorDrafts.ts` and private text/rich-content draft commands. Each draft is stored in the author's home tenant, scoped to qualified author and destination. Revision/operation hashes serialize edits and retries. Discard retains a revision tombstone so a delayed autosave cannot resurrect text. Publication reservation tables are not reused or mutated by autosave. Attachment/provenance columns are reserved for the later authorized sharing/upload bridge; no browser API accepts arbitrary attachment/provenance values yet.
- Registered tables in tenant metadata and tenant-deletion ordering. No live application database migration or real outbound delivery was performed.
- Marked only implemented backend checklist items F001/F002/F003/F007/F008/F010/F030. Remaining feature and product test entries stay open; the six database cases are partial evidence toward the planned representative journeys, not completion of the whole feature.

### Validation and environment

- The rebased checkout lacked its local `node_modules/@alga-psa/co-managed` workspace link and inherited package builds. Restored the link and built licensing/co-managed with their tsup configs. The db package uses `npm run build` (TypeScript and tsc-alias), not tsup; its build passes.
- Run focused DB checks from `server`: `NODE_OPTIONS=--max-old-space-size=12288 node ../node_modules/vitest/vitest.mjs run src/test/integration/coManagedBootstrap.integration.test.ts -t 'named ticket conversation'`. They clone schema only into a randomly named disposable database, use real session/role/relationship fixtures, then drop that database. All six new cases pass: qualified defaults/private storage/idempotent creation, native no-license use, permission/state guards, migration replay/root mapping, author/destination draft isolation, and concurrent/stale/revoked draft operations.
- The complete inherited DB run initially passed 883/885 cases. Investigated both failures: factory event mocks retained call history between fixtures, and a nested `mockRestore()` reset the enclosing `createTenantKnex` test mock rather than restoring its previous implementation. Repaired test isolation; the six new checks and both prior failures pass together (8 passed). A complete rerun is recorded below when finished.
- Full server TypeScript check initially exposed five inherited diagnostics in `nativeTimePeriod.ts`, `nativeTimePeriodSettings.ts`, and `nativeTimeSheetList.ts`: empty-array inference and nullable calendar dates. Added explicit return-element array types and a fail-fast invalid-date guard. The foundation server typecheck passed after these fixes; the final draft/action check is recorded below.
- Logs: `/tmp/ticket-conversations-drafts-and-regressions.log`, `/tmp/ticket-conversations-checkpoint-full-pg.log`, `/tmp/ticket-conversations-drafts-final-tsc.log`, and `/tmp/ticket-conversations-db-build.log`.

### Next implementation work (goal remains active)

- Wire legacy and named message publication to container/root association, and add authorized named-message reads without filtering after pagination. Native/co-managed/portal projections must exclude inappropriate side content even when the release UI flag is off.
- Implement option C in actual ticket grid, entry and embedded-drawer surfaces with draft switching and deep links, then the minimal requester portal selector. The current backend commands do not yet realize these UI flows.
- Complete file staging/publication integration, sender/envelope authority, inbound correlation and protected review, notifications/read cursors, board side-reply opt-in, selective sharing/disclosure/provenance, and actual optional AI/full-source synthesis.
- When wiring private legacy defaults, handle repeated relationships for the same owning organization and qualified ticket deliberately: current default-slot uniqueness groups by store/ticket/audience, while private row admission also binds relationship identity. Do not accidentally reuse a previous relationship's private default or disclose its history on reactivation.
- Finish the plan's actual application browser/email/AI evidence and remaining migrated-DB guard cases before marking tests or the overall goal complete. Prototype checks are not application evidence.
- Final server check after the editor-draft actions passes with `NODE_OPTIONS=--max-old-space-size=12288 node ../node_modules/typescript/bin/tsc --noEmit --pretty false` (empty `/tmp/ticket-conversations-drafts-final-tsc.log`).
- The next whole DB run passed 886/887; a separate inherited KB import test exposed the same factory-mock call-history issue under a different shuffle order. Added `beforeEach(vi.clearAllMocks)` to isolate call histories across this suite without changing mock implementations or weakening assertions. Final complete-suite log: `/tmp/ticket-conversations-checkpoint-final-pg.log`.
- Actual UI anchor confirmed: `TicketBentoLayout.tsx` builds `leftRail` and renders it at the bottom grid (around line 906), then `BentoTimelineTile` in the center. Add navigator/content slots or a cohesive controller here, preserving existing grid/entry/drawer behavior; do not merely render the standalone prototype inside the app. Existing co-managed UI is `server/src/components/co-managed/CoManagedTicketConversation.tsx`.
- Final complete migrated PostgreSQL suite: **887/887 passed**, including six new conversation/draft cases (`/tmp/ticket-conversations-checkpoint-final-pg.log`, 156 seconds). Final server typecheck is clean. Database and co-managed package builds were refreshed after the final source changes. The inherited duplicate `get` warning in the Next test stub is non-fatal and outside these changes.
- This turn made concrete implementation progress; the full goal is intentionally still active. No UI/email/AI completion is claimed by this backend checkpoint.
