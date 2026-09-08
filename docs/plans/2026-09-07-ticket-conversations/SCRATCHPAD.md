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
