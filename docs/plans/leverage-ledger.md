# Leverage ledger

Tracking for cross-cutting leverage candidates (no single home) and decisions.
Inline markers are the per-site ledger; `grep -rn "LEVERAGE:"` is the count.

---

## tenant-query-facade — friction

- **What:** Tenant-scoped application queries still require each caller to
  re-create the same root predicate shape, usually through local
  `tenantScopedTable` wrappers over `createTenantScopedQuery`. The staged
  migration has made many files safer, but the app layer is still responsible
  for remembering which tables need tenant roots, which aliases qualify the
  predicate, and where joined tables need tenant equality.
- **Root cause (wrong layer):** `createTenantScopedQuery` brands a single query
  root, but most application code immediately unwraps it to a raw Knex builder.
  Tenant context and tenant SQL shape live next to each other in `@alga-psa/db`,
  but callers still have to combine them by convention.
- **Where:** Package-local wrappers and direct-root migrations across API
  services, server actions, jobs, workflow helpers, notifications, documents,
  billing, assets, projects, integrations, and EE services. The staged migration
  tracker in `/tmp/act-migration.md` records the breadth of the current cleanup.
- **Gate:** friction with high correctness cost. Frequency is saturated, the
  shape is stable, and the leverage is app-wide. Continuing only file-by-file
  cleanup preserves the wrong layer.
- **Axis-2 (how to land):** **staged-migration.** Add a full tenant query
  facade in `@alga-psa/db` with table metadata, tenant-aware joins, branded
  scoped queries, and explicit unscoped escape hatches. Migrate callers
  incrementally and add static guardrails after the facade is available.
- **Status:** extracting. Design approved in
  `docs/plans/2026-06-25-tenant-query-full-facade-design.md`.

---

## datatable-client-paging — friction

- **What:** Every client-side consumer of `@alga-psa/ui/components/DataTable` re-derives the
  same controlled paging state — `const [currentPage] = useState(1)` / `const [pageSize] =
  useState(10)` plus a `handlePageSizeChange` that sets size and resets the page to 1 — and threads
  all four (`currentPage` / `onPageChange` / `pageSize` / `onItemsPerPageChange`) back into the
  table.
- **Root cause (wrong layer):** `DataTable` is *half-controlled*. It keeps its own
  `{pageIndex, pageSize}` state and syncs from the controlled props via effects, and it renders the
  items-per-page selector but delegates the actual size change back to the parent
  (`onItemsPerPageChange`, with no internal `setPageSize`). So a consumer that just wants default
  client paging with a working size selector is forced to hold the state anyway.
- **Where (~13 sites, all marked):**
  - `packages/ui/src/components/DataTable.tsx` (engine root-cause marker)
  - `packages/jobs/src/components/monitoring/RecentJobsDataTable.tsx`
  - `server/src/app/client-portal/request-services/my-requests/MyRequestsTable.tsx`
  - `server/src/app/msp/service-requests/ServiceRequestsManagementPage.tsx` (no-op variant — dummy `currentPage={1}` / `onPageChange={() => {}}`)
  - `server/src/components/settings/general/{UserList,BoardsSettings,ChecklistTemplatesSettings,InteractionTypeSettings,InteractionStatusSettings}.tsx`
  - `server/src/components/settings/profile/ApiKeysSetup.tsx`
  - `server/src/components/settings/secrets/SecretsManagement.tsx`
  - `server/src/components/settings/security/{AdminApiKeysSetup,AdminWebhooksSetup}.tsx` (AdminWebhooksSetup has 2 instances — two components)
- **Variants worth noting (not separately marked):** some consumers opt out of the awkward API by
  hardcoding — `pageSize={999} // Show all users` (`UserRoleAssignment.tsx`), `pageSize={10}`
  (`TeamDetails.tsx`). The spread of strategies (thread state / no-op props / hardcode) is itself
  evidence the paging contract is unclear.
- **Gate:** frequency saturated (≫3, verbatim); cost low per site but correctness-adjacent (page
  reset on size change is easy to forget); stable (shape has stopped moving — identical across all
  sites); leverage high (one fix removes the block everywhere + clarifies the contract).
- **Axis-2 (how to land):** **promote-to-plan / staged-migration.** Wide blast radius across an
  exported UI primitive with ~13 callers. Candidate call-site-first shape: let `DataTable` own
  client paging by default (uncontrolled), exposing the items-per-page selector without requiring
  the parent to hold `pageSize`; keep the controlled props as an opt-in escape hatch for
  server-side paging. Migrate callers, then delete the boilerplate.
- **Status:** watching (markers placed this pass — detection only, no extraction).

---

## datatable-paging-remount — friction

- **What:** `key={`${currentPage}-${pageSize}`}` on `<DataTable>` to remount the entire table and
  force paging to apply — a sharper symptom of the same half-controlled engine as
  [[datatable-client-paging]].
- **Where (2 sites, marked):** `UserList.tsx`, `RecentJobsDataTable.tsx`.
- **Gate:** friction (weighs heavy — direct evidence the layer is wrong); fixing the root cause
  above removes the need for the remount hack entirely.
- **Status:** watching (resolve together with `datatable-client-paging`).

---

## datatable-filter-paging — pattern

- **What:** Tables with filters re-implement the same list-controller shape with no shared layer:
  filter state, a 300ms debounce on text search, "reset page to 1" on every filter/size/sort
  change, and either a client-side `filteredX` `useMemo` or a server fetch state machine.
- **Where (strong instances, marked):**
  - `packages/tickets/src/components/TicketingDashboard.tsx` (**largest instance** — full server list-query: filter state + 500ms search debounce + reset-page + manual fetch + URL sync; added 2026-06-19 during the ticket-list redesign)
  - `server/src/components/settings/profile/ApiKeysSetup.tsx` (client filter + debounce + reset)
  - `server/src/components/settings/security/AdminApiKeysSetup.tsx` (near-identical to ApiKeysSetup — the two files are ~95% duplicate components, a separate candidate)
  - `server/src/app/msp/email-logs/EmailLogsClient.tsx` (server variant: fetch + debounce + reset + manual sort)
- **Lighter / partial instances (not marked — different/smaller shape):**
  - `SecretsManagement.tsx` (search-only `filteredSecrets`, no debounce, no page reset)
  - `ServiceRequestsManagementPage.tsx` (`showArchived` toggle → `visibleDefinitions`)
  - `UserList.tsx` (`selectedClientId` → `visibleUsers`)
  - `AdminWebhooksSetup.tsx` inbound deliveries (server paging + `inboundDeliveryStatusFilter`)
- **Gate:** frequency strong; cost medium (debounce + page-reset coordination is easy to get
  subtly wrong); leverage high. Missing layer, not a wrong one → **extract** a `useListController`
  / `useFilteredTable` hook (filters + paging + sort + debounce + reset, client or server).
- **Axis-2 (how to land):** bounded-now to promote-to-plan — a hook is additive (callers migrate
  incrementally), but coordinating with the `datatable-client-paging` engine revision argues for a
  single plan.
- **Status:** watching.

---

## filter-descriptor-table — pattern

- **What:** Within a single filtered list, each filter dimension's three facts — *is it active*,
  *its human label*, and *how to clear it* — get written once per consumer of that knowledge. In
  `TicketingDashboard` that's now three copies: the toolbar control's `onValueChange`, the
  `activeFilterCount` memo, and the `activeFilterChips` memo. Adding the chips this session was the
  third hand-written copy across ~12 dimensions (board, client, assignee, team, unassigned, status,
  response, priority, due, sla, category, tags).
- **Where:** `packages/tickets/src/components/TicketingDashboard.tsx` (marked at `activeFilterChips`).
- **Gate:** frequency 3 copies × ~12 dimensions; cost medium (every new filter or chip must touch
  all three in sync — drift = a chip that doesn't clear, or a miscount); stability good (filter set
  is stable); leverage real but **local to one component** so far.
- **Shape if extracted:** one `FILTER_DESCRIPTORS` list of `{ key, isActive(filters), label(filters,
  lookups), clear() }`; the count, the chips, and (eventually) the controls all derive from it.
- **Axis-2:** in-pass/bounded-now — self-contained to this component, no API ripple. Worth doing if
  a 4th consumer of the per-dimension knowledge appears (e.g. a saved-views feature).
- **Status:** watching (1 component; revisit if it recurs in another filtered list, at which point
  it converges with `datatable-filter-paging`).

## Notes

- `ApiKeysSetup.tsx` and `AdminApiKeysSetup.tsx` are near-duplicate components (profile vs admin
  API keys). Worth a separate `apikeys-setup-dup` candidate if it recurs / diverges — left
  unmarked this pass to keep the table-focused ledger clean.

## Targeted durable subscriber replay — friction
- What: retrying one unfinished co-managed consumer through ordinary event fanout could resend email or trigger workflows; global processed markers also suppressed another channel carrying the same stable event ID.
- Where: event-bus publisher/stream processing, co-managed search and internal-notification completion recovery.
- Gate: high duplicate/lost-delivery cost, stable subscriber/channel identities, two concrete transactional consumers; ACT / bounded engine revision with regression coverage.
- Status: revised (2026-09-07). Explicit targeted force replay bypasses fanout/workflow publication and only dispatches its named subscriber. Processed event/handler tuples include the channel. Existing untargeted publication semantics remain covered by pending/poison tests; durable consumer effects and completion stay in their own source-owned transaction.

## Authorization-aware email retries — friction
- What: the generic tenant email rate-limit path serializes rendered messages into a delayed queue; co-managed retries must reload current content, recipients and grants instead.
- Where: TenantEmailService rate limiting, sendEventEmail outcome handling, upcoming co-managed recipient delivery queue.
- Gate: high stale-content disclosure cost and a stable existing send boundary; ACT / bounded opt-in engine revision.
- Status: revised (2026-09-07). Explicit caller-owned retry returns rate-limit metadata without enqueueing rendered content. A result-returning event-email entry point distinguishes sent, queued and skipped outcomes; the existing void entry point preserves its contract and queued reply tokens. The co-managed recipient queue remains the next integration step.

## Customer-owned notification content — friction
- What: the existing comment notification reader binds current content loading to an MSP trust admission; reusing that admission for customer technicians would make ownership depend on a live sponsor and omit customer-private history.
- Where: ticketCommentNotification.ts and customerCommentNotification.ts.
- Gate: high disclosure/lifecycle cost, two actual identity boundaries, stable locked source/audience/redaction rules; ACT / bounded extraction of the internal content reader.
- Status: revised (2026-09-07). Both callers use the same retained ticket/thread/comment content reader. MSP admission still requires current trust and permits only requester/shared-IT content. The new customer recipient boundary applies local RBAC/bundle policy, permits customer-owned private content, and remains independent of sponsorship after departure or PSA upgrade. It grants no session or mutation authority. Routing/preferences and durable customer delivery remain separate integration work.

## Customer technician email delivery — pattern
- What: customer-local and MSP-shared queues need the same current internal-email preferences and escaped/localized transport, with different source authority and navigation.
- Where: commentEmailRecipient.ts, commentEmailDeliveries.ts, customerEmailDeliveries.ts and coManagedCommentEmailTransport.ts.
- Gate: two concrete queues, high stale-recipient/content cost, stable preference and rendering rules; ACT / bounded extraction.
- Status: revised (2026-09-07). Both queues use the locked current-email preference reader and caller-owned transport renderer. Customer routing/source admission stays ownership-based; MSP routing remains trust-based. Completion-loop duplication is marked for observation while requester recipient kinds are still being shaped. Customer subscriber effects use the existing connection-aware after-commit engine so an outer rollback discards sends and the owning commit supplies the root recovery connection.

## Requester email ownership and shared contact visibility — friction
- What: requester mail cannot borrow an internal technician or portal session, and the existing contact/board visibility policy lived behind a ticket-package subpath without a runtime export.
- Where: requesterCommentEmail.ts, ticketCommentNotificationContent.ts, ticket clientPortalVisibility facades and shared/lib/tickets/clientPortalVisibility modules.
- Gate: three actual consumers (portal reads, portal file reads and background requester email), high stale-recipient/visibility cost, unchanged mature policy; ACT / bounded policy relocation.
- Status: revised (2026-09-07). Moved both visibility modules unchanged to explicit shared runtime entry points, preserving ticket facades and the pure browser-safe filter boundary. The content reader accepts an explicit null interactive actor for a separately admitted requester identity; internal/MSP callers retain qualified self-suppression. Requester admission binds contact/client/location identities and current public agent content without granting a login, role or linked-resource read. Queue completion/preferences and reply-token integration remain subsequent work.

## Requester reply-token admission — friction
- What: native reply-token lookup returns flat ticket/comment IDs; co-managed requester replies also need immutable recipient/address binding, current requester visibility, sender authentication and write admission retained through the mutation.
- Where: requesterReplyTokens.ts, requesterCommentEmail.ts and the forthcoming inbound requester adapter.
- Gate: high stale-token/cross-audience cost and an existing stable requester read boundary; ACT / bounded transaction admission layer before transport integration.
- Status: added (2026-09-07). Customer-owned opaque tokens bind delivery/address and qualified source/requester identities. Reply callbacks hold canonical ticket/thread and current authority locks, reject expired/revoked/mismatched tokens, and recheck expiry/lifecycle before and after writes. Existing receiving-MTA sender verification is reused through an explicit shared runtime export. Native inbound fallback and durable requester delivery have not yet been connected to this boundary; adapters must treat recognized token rejection as terminal rather than trying alternate ticket matching.

## Requester email delivery preparation — friction
- What: SMTP can expose a reply token before an enclosing transaction commits; keeping the whole attempt in one transaction could send an unusable token after rollback.
- Where: requesterEmailDeliveries.ts and requesterReplyTokens.ts.
- Gate: high replyability and stale-authority cost, stable existing requester admission; ACT / bounded two-phase delivery engine.
- Status: added (2026-09-07). Preparation commits an address-bound token, then delivery reacquires current source, recipient and tenant preference locks before sending. Address changes between phases defer for fresh preparation; lost acknowledgements reuse the same token and Message-ID. First event discovery fixes the requester identity across replays. Tenant comment-email preference gates are shared with internal recipients, whose own user preferences remain separate. Completion-loop extraction remains deferred because requester preparation differs from internal delivery. This queue is not registered with production consumers until the qualified inbound reply adapter is connected.

## Qualified requester admission in durable mail — friction
- What: native token lookup returns unqualified IDs and falls through on rejection; using it for co-managed replies would lose current requester authority and could commit partial writes before recording quarantine.
- Where: requesterReplyAdmission.ts, inboundRequesterReply.ts, processInboundEmailInApp.ts, durable core/dispatcher and both worker entry points.
- Gate: high tenant/audience and transaction cost; one stable current-authority callback needed by two actual compositions; ACT / bounded mail-engine injection.
- Status: revised (2026-09-07). Worker roots inject requester admission into the durable core without a shared-to-domain package cycle. The domain uses a savepoint so expiry/destination rejection rolls back reply writes before quarantine is persisted. Canonical comment, reopen and cutoff creation share the outer inbox transaction. Cutoff destinations retain client/contact identity and current board visibility; the reply token cannot add CC watchers or acquire an internal identity. Recognized malformed/case-variant/HTML tokens cannot fall through to native matching. The staged source remains available after quarantine. HTML-only replies use the parser's existing visible-text projection for substantive-content detection.

## Lifecycle errors across compiled worker packages — friction
- What: an independently compiled admission adapter and the source-compiled mail core can load different constructors for the same lifecycle error; instanceof then misclassifies a pause as retryable processing failure.
- Where: licensing lifecycle contract and inboundEmailCoreProcessor.ts.
- Gate: verified worker runtime boundary, high retained-intake cost, stable error contract; ACT / bounded error-contract predicate.
- Status: revised (2026-09-07). A checked lifecycle predicate recognizes only the named non-writable lifecycle states with the matching error code. The durable core defers and refunds a newly claimed attempt after rollback. Plain Node verification loads both actual compiled constructors and proves the shared contract works when instanceof does not.


## Requester delivery activation and ticket email routing — pattern
- What: primary requester delivery now consumes committed co-managed intent and shares current, localized rendering with technician delivery; native sender and portal routing still have a second implementation in the worker adapter.
- Where: coManagedRequesterCommentEmailSubscriber.ts, coManagedRequesterEmailRouting.ts, ticketEmailSubscriber.ts and coManagedCommentEmailTransport.ts.
- Gate: shared rendering has three concrete recipients; sender/portal settings are stable but native watcher delivery still has a separate authority path. Reuse rendering now, mark routing duplication for a later bounded extraction.
- Status: connected (2026-09-07). Discovery completion and recipient obligations commit together before token preparation or transport. Dedicated targeted replay and scheduled delivery cannot invoke native fanout. Rollout keeps already-published events with the native primary sender; co-managed watcher and bundle-child exclusions remain intact. Settings lookup errors retry instead of silently choosing a guessed routing context.

## HTML reply boundary trimming — friction
- What: the shared parser cut at the boundary attribute itself, leaving an incomplete opening tag in an HTML-only answer.
- Where: replyParser.ts and the actual co-managed requester rendering/parser round trip.
- Gate: reproduced malformed canonical reply input, stable explicit marker contract; ACT / bounded parser correction.
- Status: revised (2026-09-07). An attribute inside an opening tag trims from that tag's start. Requester notifications place their boundary before the quoted notification, so the answer excludes old mail in both text and HTML while token extraction remains intact. Native parser fixtures and delimiter regressions remain covered.


## Customer technician email reply authority — pattern
- What: requester and customer-technician reply tokens both retain delivery/address/source identity, but technicians need current local read and update permissions and must not widen an answer's audience after the original email was sent.
- Where: customerReplyTokens.ts, requesterReplyTokens.ts and the customer-owned notification reader.
- Gate: repeated opaque-token persistence is marked for observation; recipient kinds, lifecycle and reply policy differ. Reuse existing locked content, RBAC and lifecycle boundaries without introducing a generic principal bypass.
- Status: added (2026-09-07). Customer-owned `cm2:` tokens bind the internal user, original sent address and exact source thread/audience. Admission intersects current read/update RBAC and bundle restrictions, current active internal identity, source publication and lifecycle. Savepoint rollback protects an enclosing inbox transaction even when it catches a late expiry rejection. The actual notification transport and incoming mail adapter remain to be connected before production issuance.


## Savepoint after-commit ownership — friction
- What: a raw Knex savepoint creates a distinct transaction object; hooks registered by reply writers on it are lost when only the outer owning transaction flushes. Flushing on savepoint release would publish work that can still roll back.
- Where: db withSavepoint/afterCommit helpers and customerReplyTokens.ts.
- Gate: reproduced through actual technician reply transactions; high lost/premature notification cost and stable existing hook ownership contract; ACT / bounded database-engine addition.
- Status: revised (2026-09-07). Explicit withSavepoint requires an owning transaction, promotes successful child hooks to that parent without dispatch, and discards hooks on rollback. The ordinary withTransaction behavior is unchanged. Actual root and enclosing reply transactions prove hooks see committed database state only once, while child rejection and outer rollback produce no hooks. Existing after-commit unit regressions remain covered.


## Qualified mail identity and audience — friction
- What: the requester-only inbox callback could not represent a customer technician, and native mail helpers always created public roots/changed requester response state. Closed-ticket cutoff copied the incoming subject/body into public ticket context.
- Where: qualifiedReplyAdmission.ts, inboundEmailReply.ts, durable worker compositions, processInboundEmailInApp.ts, emailWorkflowActions.ts and TicketModel.createComment.
- Gate: two real principal kinds and three supported audiences, high identity/disclosure cost; ACT / bounded extension of the existing mail engine rather than a parallel ticket writer.
- Status: revised (2026-09-07). The typed callback distinguishes requester and customer technician identities. The same canonical writer retains their thread audience, qualified actor in events, reopen policy and durable effects. Technician cutoff checks create/read/update permissions on its fixed client/destination, uses the actual technician as creator, preserves the original audience and keeps IT-only reply subjects/bodies out of public ticket context. Explicit audience/visibility or parent-audience conflicts reject before content persists. Customer technicians use the existing stronger internal sender-authentication policy (DMARC alignment or both aligned SPF and DKIM).

## Technician inbound artifact authority — friction
- What: the native artifact worker forces portal-visible attachment processing and cannot inherit the recipient-specific conversation audience. Editable comment metadata cannot safely choose its path.
- Where: inboundEmailArtifactWorker.ts and the future conversation artifact adapter.
- Gate: concrete private email replies now reach the canonical inbox writer; current native folder defaults are the wrong authority boundary. Full conversation attachment materialization remains required.
- Status: pending adapter (2026-09-07). Digest-verified original MIME identifies reserved technician tokens before any native upload. Its artifact manifest/source stays pending with fenced, attempt-preserving deferral until the conversation attachment adapter is connected. No production outgoing technician token issuance has been enabled. The generic pause helper is shared with lifecycle callers without changing their lease/failure preservation. This retention boundary is interim protection, not completed attachment handling.


## conversation-transfer-authority — friction
- **What:** The existing durable file reservation/transfer engine assumed an interactive session, preventing accepted email artifacts from using current worker authority.
- **Where:** `packages/co-managed/src/conversationAttachments.ts` and `inboundEmailAttachments.ts`.
- **Gate:** Interactive published comments and drafts already share stable immutable file identities, checksums, reservation and publication. Email is the third real caller; duplicating transport or inventing a session would add authority and retry risk. ACT / bounded-now within the approved mail integration work.
- **Status:** revised. The transfer engine consumes a retained transaction, owner-qualified actor/source and an explicit write-authority assertion. Interactive wrappers preserve session/lifecycle checks. The worker supplies committed reply provenance, current RBAC/source/audience and a live fenced artifact claim. An optional completion callback runs atomically with ready publication, including exact ready retries. The compiled worker entry uses the licensing runtime surface. Storage-provider composition remains separately marked while its error policy settles.


## ticket-email-mailbox-routing — pattern
- **What:** Customer technicians and requesters reply to the same tenant-configured ticket intake, while their navigation and locale identities differ.
- **Where:** `packages/jobs/src/lib/handlers/coManagedRequesterEmailRouting.ts` and `coManagedCommentEmailTransport.ts`.
- **Gate:** Two actual replyable delivery callers, stable existing mailbox resolution, high risk from divergent reply routing; ACT / in-pass.
- **Status:** extracted the existing mailbox lookup as a shared internal function. Portal-domain selection remains requester-specific, and technicians retain their internal ticket links. The broader native-subscriber routing marker remains; this extraction does not claim to unify native routing.


## native-comment-outbox-ownership — friction
- **What:** Inbound co-managed comments used the native email outbox while interactive shared comments used current-source conversation intent and durable consumer recovery.
- **Where:** Shared inbound core/outbox adapter, co-managed conversation outbox/catalog/consumers, and both mail worker compositions.
- **Gate:** Two actual producers with identical downstream conversation requirements; retaining two independently publishing rows would split authority and recovery. ACT / bounded-now within the approved notification/email integration.
- **Status:** revised. The native publisher accepts a typed retention callback and relinquishes comment publication when the conversation outbox owns it. Both production workers supply the compiled adapter; missing composition retries co-managed writes. Commit hooks dispatch current content, and existing maintenance owns recovery. The outbox intent now retains an optional internal-only channel; consumer creation, consumption and recovery enforce its exclusions, preserving initial ticket-comment behavior even after stale consumer backfill. Native UI/API/scheduled comment writers and non-comment workflow events remain separate integration work.

## native-comment-publication-boundary — friction
- **What:** UI/API comment writers published directly, swallowed intent failures, or retained obsolete edit bodies while inbound and shared comments already used durable current-source delivery.
- **Where:** Generic/optimized/simple ticket actions, API TicketService, and the inbound retention adapter.
- **Gate:** Four native writers plus inbound share one stable event ownership, source audience and commit boundary. ACT / staged-migration within the approved conversation integration; scheduled and model/workflow producers remain separate stages.
- **Status:** revised. A domain retainer derives canonical source metadata for ordinary events, workflow events and content-free edit/delete invalidations. The inbound callback delegates to it. A native ticket composition supplies strict stable-ID delivery for co-managed intent and preserves ordinary PSA after-commit transport. Construction/retention errors propagate to the owning writer; transport failures are recoverable. Tests inject real PostgreSQL outbox constraints, including failures after an earlier event was retained, and verify rollback with no publication or orphan consumer obligations.

## scheduled-publication-authority — friction
- **What:** Scheduled comments bypassed current author and lifecycle authority, then depended on finite job retries and boot-only event recovery.
- **Where:** Scheduled publication handler, co-managed notification maintenance, and conversation event transport.
- **Gate:** This is a deferred write with the same stable source, current permission and commit requirements as interactive/inbound comments. ACT / bounded-now within the approved scheduled conversation integration.
- **Status:** revised. Current worker authority is explicit and session-free; publication and event handoff commit together. Persisted retry time allows maintenance to resume withheld sources and make progress past denied ones. Recovery of already-visible content uses its original requester intent and current source checks without reapplying operational write admission.

## scheduled-worker-composition — friction
- **What:** The scheduled writer and response-setting reader lived behind server/vertical entry points unavailable to maintenance worker composition.
- **Where:** Server scheduled handler, jobs publication engine, shared ticket response settings, and server co-managed event queue adapter.
- **Gate:** Server queue delivery and recurring maintenance are two concrete callers. Stable transport and settings logic should not be copied or require server-only module imports. ACT / bounded-now.
- **Status:** revised. The jobs package owns the publication engine and common after-commit conversation queue transport; the server adapter re-exports that transport and supplies queue connections/boot scheduling. Response settings moved unchanged to a compiled shared subpath, with the ticket helper retaining its existing export. Domain scheduled authority also has a compiled worker entry point.

## workflow-conversation-composition — friction
- **What:** Shared workflow code could only publish best-effort events, while co-managed comment writes need domain admission and durable intent in their owning transaction.
- **Where:** WorkflowEventPublisher, email and business-operation actions, server/workflow-worker startup, and TicketModel event error handling.
- **Gate:** Native, inbound, scheduled and workflow producers share the stable commit/retention boundary. Domain imports from shared would create a cycle; process composition is already established for workflow email. ACT / bounded-now as a staged producer migration.
- **Status:** revised. A typed runtime registry injects domain retention without a reverse package dependency. The model declares transaction-critical comment publishers; business actions use the transaction engine's after-commit owner, and email initial ticket/comment creation shares that owner. Workflow context resolves the exact executing version and current authority. Publisher-less import/system paths remain explicit follow-up contracts, avoiding accidental notification behavior changes.

## scheduled-command-queue-ownership — friction
- **What:** Rescheduling canceled/created queue jobs inside the write transaction, while initial scheduling could attach a stale queue response after a concurrent schedule change.
- **Where:** Native comment creation, rescheduling and cancellation actions.
- **Gate:** Three callers share a stable committed-source queue handoff; a queue call cannot roll back with PostgreSQL. ACT / bounded-now.
- **Status:** revised. Committed schedule state owns publication. Queue cancellation and arming run as independent after-commit hooks; arming checks the current scheduled instant before submission and conditionally attaches the returned job. A stale response cancels its own job. Existing maintenance recovers due co-managed sources after queue failures. Browser command authority is distinct from deferred author authority, allowing current technicians to cancel a departed author's work.

## customer-resource-admission — friction
- **What:** Customer-local authorization only supported tickets despite the shared boundary already recognizing projects and tasks.
- **Where:** Customer work admission, shared project/task admission, and the task editor/list.
- **Gate:** Two actual resource families need the same current session, relationship, lifecycle and home-policy boundary, with deliberately different record projections. ACT / bounded-now.
- **Status:** revised. The customer engine resolves ticket or parent-project policy records behind resource-specific entry points. Project/task paths lock the project before its task/phase and revalidate the parent, so task lists and concurrent edits use a consistent order. No session-tenant switching or implicit task assignment is introduced.

## explicit-audit-ownership — friction
- **What:** The legacy audit trigger replaced an explicit owner tenant with app.current_tenant, breaking shared-task attribution and potentially routing a record to the wrong organization.
- **Where:** Audit trigger migration and the canonical project-task edit adapter.
- **Gate:** A real PostgreSQL failure proved that explicit owner-qualified writes could not survive the storage engine. ACT / bounded-now.
- **Status:** revised. The trigger preserves explicit ownership and uses connection context only when ownership is absent. Tests cover both forms, foreign connection context, replay and guarded rollback. The migration uses ordinary CREATE OR REPLACE FUNCTION; modern Citus documents function DDL propagation in its [changelog](https://github.com/citusdata/citus/blob/main/CHANGELOG.md). Actual Citus execution remains an explicit validation gap.

## qualified-task-audit — pattern
- **What:** Task field edits and assignment changes need the same owner-qualified, immutable actor attribution in one writer transaction.
- **Where:** Native task edit adapter and task assignment command.
- **Gate:** Two concrete writers, high attribution/isolation cost, stable storage contract. ACT / bounded-now.
- **Status:** extracted. A task audit writer validates the admitted task context, resolves the actual foreign actor reference, and records protected actor/relationship identity after caller-supplied details. Both writers retain their existing command authority and atomic receipts.

## active-home-policy-subject — friction
- **What:** Assignment candidate checks needed active home identity without borrowing a session or pretending to deliver a notification.
- **Where:** Shared identity engine and project task assignee admission.
- **Gate:** Recipients and assignment candidates use the same active user/role/team locks with different resource authority. ACT / in-pass.
- **Status:** revised. The identity engine exposes its non-session subject contract explicitly; notification admission retains its prior adapter. Assignment commands evaluate candidate policy against the proposed qualified assignment while separately retaining the editor's actual resource authority.

## qualified-queue-policy — pattern
- **What:** Ticket and task queues must compile the same home policy projections and fail closed on unsupported constraints before counts and pagination.
- **Where:** Ticket queue and project task queue.
- **Gate:** Two real resource families, high authorization cost, stable compiler contract. ACT / bounded-now.
- **Status:** extracted. A shared queue policy adapter accepts the resource family and available owner/board projections. Ticket behavior is preserved; task projections use native project ownership or a verified MSP assignment reference. Resource/lifecycle discovery remains separate because customer-home task queues and MSP ticket queues have different entry contracts.

## qualified-private-resource-comment — pattern
- **What:** MSP-private ticket and task notes require identical home-store receipts, authorship, revisions, content validation, and retained shared-resource authority.
- **Where:** `packages/co-managed/src/privateTicketConversation.ts`.
- **Gate:** Two supported resource families already share the private schema; stable command contract and high isolation cost. ACT / bounded-now.
- **Status:** extracted. One internal resource writer uses the qualified resource kind. Explicit ticket/task entry points preserve input rejection and Promise behavior for existing adapters. No customer-store receipt or copied task is introduced.

## qualified-conversation-page — pattern
- **What:** Ticket and task readers combine canonical and MSP-private content using exact timestamp/store/comment cursors and field-mask projections.
- **Where:** `ticketConversation.ts` and `projectTaskConversation.ts`.
- **Gate:** Two callers; shared pagination is stable, but native audience, publication, attachment, and event contracts still differ. WATCH / reconsider when the task consumer boundary settles.
- **Status:** watching. Keep explicit resource readers while task integration is established. Task legacy flags cannot inherit ticket-public defaults. Timestamp handling is verified on non-UTC PostgreSQL connections.

## native-task-comment-admission — pattern
- **What:** Native comment bodies, counts, writes, and reaction batches must retain the same current local project/session/lifecycle authority through their final read or mutation.
- **Where:** Project task comment and reaction actions; `nativeTaskCommentAccess.ts` and the projects composition adapter.
- **Gate:** Eight existing entry points, high disclosure cost, stable owner-local project policy. ACT / bounded-now.
- **Status:** extracted. One native action boundary binds the browser identity, resolves actual comment/task parents, locks parent projects before tasks, and rechecks session/lifecycle after the callback. Batches authorize every current parent before querying results. This local-owner boundary remains valid after live trust terminates; it cannot borrow the former MSP grant.

## customer-project-policy-record — pattern
- **What:** Native task admission and qualified customer work project the actual customer project/client/assignee into home RBAC and bundle policy.
- **Where:** `customerWork.ts`, `nativeTaskCommentAccess.ts`.
- **Gate:** Two callers share the record shape; live shared relationships and retained owner-local batches have distinct admission and lifetime requirements. WATCH.
- **Status:** watching. Keep projections aligned; reconsider a common local-resource admission layer when export and paid-upgrade paths settle. Do not force post-termination customer reads through an active-trust requirement.

## qualified-conversation-event-outbox — friction
- **What:** The durable conversation engine assumed every source was a ticket, preventing task producers from using the existing claim/retry/consumer-completion machinery.
- **Where:** Conversation outbox, task writers, native project event publication, maintenance recovery, search subscriber.
- **Gate:** Two concrete source families, stable retry machinery, high duplication and disclosure costs. ACT / bounded-now.
- **Status:** revised. The existing outbox now retains qualified resource type/ID. Ticket identities and hashes remain compatible, including rolling older ticket writers; task events carry strict metadata and resolve current source independently. Existing dispatch and consumer recovery remain the only engine. Canonical task changes enroll search work atomically; private MSP notes enroll none. Task notification and workflow authority remain separate unfinished consumers.

## task-conversation-audience — pattern
- **What:** Task writers, native access and background delivery all need explicit task audience rules; legacy task flags have different semantics from ticket flags.
- **Where:** `projectTaskAudience.ts`, task conversation reader/writer, native actions and task event source resolver.
- **Gate:** Three live callers and stable compatibility rules. ACT / bounded-now.
- **Status:** extracted. Pure task audience SQL/value helpers preserve legacy privacy without importing the task mutation engine into event delivery.

## admitted-search-relation — friction
- **What:** Post-query visibility checks cannot remove information already exposed by ranking, snippets, pagination, type counts and typeahead.
- **Where:** Search query engine, full search, typeahead server action and REST search.
- **Gate:** Three live query consumers share one indexed relation; disclosure cost is high and the query boundary is stable. ACT / bounded-now.
- **Status:** revised. The engine accepts a trusted admitted relation built inside a retained search transaction. Co-managed/retained customer project families join current owner-local projects through the existing queue policy compiler, project current fields through masks, then rebuild search vectors. Full search and typeahead share this boundary. Transport adapters supply actual session/API-key identity; API-key bundles participate in evaluation. Cached task-comment bodies need matching current revision/timestamp evidence. Other search families still require their own authority audit.

## project-search-field-sources — pattern
- **What:** Task editors, assignment projections, task queues and global search must recognize aliases of the same masked project/task field.
- **Where:** `projectTaskEditing.ts`, `projectTaskAssignments.ts`, `projectTaskQueue.ts`, `projectSearchAccess.ts`.
- **Gate:** Repeated stable names, but projections expose different dependencies (e.g. project names versus navigable parent IDs). WATCH before combining whole maps.
- **Status:** watching. Search now honors task value aliases and project/phase display aliases; retain source-specific masks and test derived search effects before extracting a field dependency map.

## qualified-conversation-composer — pattern
- **What:** Ticket and task conversation screens share rich-text rendering, explicit audience choice, immutable operation retries and access-refresh behavior.
- **Where:** `CoManagedTicketConversation.tsx`, `CoManagedProjectTaskConversation.tsx`.
- **Gate:** Two callers; attachment/disclosure orchestration, revision contracts and task recipient capabilities are still different and evolving. WATCH.
- **Status:** watching. Reuse the validated document control and text renderer now. Keep task commands explicit rather than stretching the ticket attachment pipeline with resource flags; revisit a shared composer controller when task attachments/disclosure and consumer authority are connected.

## qualified-notification-receipts — friction
- **What:** Ticket-only notification receipts prevented tasks from using the current-source inbox and independent channel retry engine.
- **Where:** Stored comment verification, inbox scoping/presentation, task event consumer, notification delivery queue.
- **Gate:** Two concrete resource families; stable receipt, rendering, preferences and delivery contracts. ACT / bounded-now.
- **Status:** revised. The existing receipt retains resource type/ID and rolling ticket compatibility. Task-specific recipient/source readers feed the same inbox and channel verifier. Owner-local task history keeps current project policy after separation; MSP reads retain live trust. Canonical task creation enrolls the existing internal-notification consumer, committing both tenants' receipts and recovery rows with consumer completion. No second inbox or transport retry engine.

## notification-source-classification — pattern
- **What:** Inbox pagination and channel delivery must agree that a damaged qualified notice or an older customer task notice cannot use cached content as native authority.
- **Where:** `coManagedNotificationClassification.ts`, `coManagedInbox.ts`, `notificationDelivery.ts`.
- **Gate:** Two callers with identical source classification and high disclosure cost. ACT / bounded-now.
- **Status:** extracted. One SQL predicate identifies markers, receipts and legacy task/mention notices in current or retained customer ownership. Identified legacy notices without authoritative receipts are omitted; pending retained creation events join recovery, while published pre-rollout notices are not replayed as new alerts.

## qualified-comment-email-queue — friction
- **What:** The MSP ticket email queue's ticket-only columns prevented current task recipient admission from using its stable identity, retry and completion engine.
- **Where:** `commentEmailDeliveries.ts`, email consumer catalog/subscriber, maintenance recovery and `coManagedCommentEmailTransport.ts`.
- **Gate:** Two concrete source families; task delivery needs the same transaction-owned discovery, preference checks and current-source send boundary. ACT / bounded-now.
- **Status:** revised. Task recipients from both organizations enter the existing queue through one retained-identity helper. Resource-specific readers and routing checks feed the existing completion engine; task preferences select the existing task subtype. The current renderer accepts admitted task names/owner paths and shares escaping, locale resolution, caller-owned retries and stable Message-ID handling. No task-specific SMTP queue or maintenance scanner was introduced. Ticket customer/requester reply-token preparation remains separate; task mail does not manufacture ticket reply authority.

## operational-time-billing-mode — friction
- **What:** Native time forms and API validators require a service even for non-billable entries, and product changes alone cannot preserve the non-invoiceable nature of customer history.
- **Where:** Product capability/mode resolver, `timeEntryBillingMode.ts`, `time_entries`, invoice source links; native browser save/form and API create/edit now connected; remaining time paths pending.
- **Gate:** Two live write stacks need one explicit distinction and durable financial invariant. ACT / bounded-now.
- **Status:** partially connected. Native browser and API create/edit saves now retain actor, work, sheet and product authority around existing mutations; form defaults use actual mode and historical entries preserve their stored mode. Remaining timer/read/approval paths still need the same boundary. Operational time has an explicit capability, immutable stored billing mode and price/invoice exclusions. The internal mode helper retains product/lifecycle locks; field normalization preserves elapsed effort while excluding billable minutes. This is billing-mode admission, not actor/work-item authorization. Native adapters must retain their own current principal, source and timesheet authority when connecting it.

## project-task-effort-aggregate — friction
- **What:** Summing entries before locking the task lets concurrent committed saves overwrite each other's actual-minute totals.
- **Where:** The existing DB recalculation service used by native time creation, edits, deletion and work-item removal.
- **Gate:** One existing shared service already owns all relevant local projections. ACT / bounded-now.
- **Status:** corrected. Lock affected tasks in sorted order before taking the aggregate snapshot, inside the caller's transaction (or an owned transaction for root callers). Continue deriving actual minutes from elapsed instants, including service-free operational entries; billable duration remains separate. Shared organization-qualified contributions still need their planned resolver and visibility rules.

## local-record-authorization — pattern
- **What:** Native time needs the same current, retained home RBAC, bundle narrowing and concrete record constraint evaluation as local/shared ticket and project commands.
- **Where:** `sharedWorkIdentity.ts`, native operational time admission.
- **Gate:** The existing evaluator already owns this stable decision; allowing a concrete resource/action avoids another subtly different kernel. ACT / bounded-now.
- **Status:** extracted. `authorizeCoManagedLocalRecord` owns the existing evaluator; the typed ticket/project entry point delegates unchanged. Native time uses actual source projections and owner-qualified time records, without interpreting browser mode hints as authority.

## local-credential-admission — pattern
- **What:** Project API search and operational time must bind current home roles/bundles to the actual retained session or API key and recheck expiry after waits.
- **Where:** `localAuthentication.ts`, local project search and native time admission.
- **Gate:** Two stable, security-sensitive callers need identical credential semantics. ACT / bounded-now.
- **Status:** extracted. A validated credential snapshot, retained active identity/key and final-expiry callback are shared; resource/lifecycle authority remains with each caller.

## api-time-transaction-ownership — friction
- **What:** API time helpers opened fresh connections, so automatic sheets and detail reads could escape the save transaction. Manual controllers also reconstructed incomplete credential contexts.
- **Where:** `TimeEntryService`, manual time API dispatch.
- **Gate:** Atomic effort, scope and sheet admission require every native helper to use the retained connection. ACT / bounded-now.
- **Status:** revised. Each create/edit gets a fresh connection-bound service with private admitted mutation methods; no shared service instance is mutated. Controllers forward their verified context. Timer methods remain a separate migration because their unfinished-entry representation conflicts with the schema.

## running-time-storage — friction
- **What:** Running timers have no end instant, while completed time entries and their consumers require one.
- **Where:** REST `startTimeTracking`/`stopTimeTracking`, initial `time_entries` schema.
- **Gate:** The existing representation cannot satisfy its own persistence contract. ACT / staged-migration in the co-managed time plan.
- **Status:** implemented for REST start/read/stop. Separate tenant clocks transition atomically into the existing completed-time engine; immutable request receipts prevent duplicate effort on retries. Current source/credential policy, original billing mode and timezone remain retained through completion. Named-clock cancellation now remains possible after lost source access or entitlement, without exposing work data or creating effort; retries cannot abandon a newer clock. Completed entries keep their non-null end invariant.


## native-time-detail-projection — pattern
- **What:** Browser and API time detail readers independently join work-item/billing data and can bypass current customer source or field policy; billable minutes also erase operational elapsed duration.
- **Where:** Native `getTimeEntryById`, API `getById` and `getWithDetails`.
- **Gate:** Two independent adapters share a high-cost authority/projection shape already established by timers and native saves. ACT / bounded-now within the approved time workstream.
- **Status:** extracted a retained customer-owned detail reader, reusing source/credential admission and projecting native/API DTOs from current records. Collection, export, approval and deletion adapters remain separate pending work.


## native-time-collection-authority — pattern
- **What:** Sheet entry and review-history readers need the same current source/field policy as individual time details; independent joins leak excluded work through review comments or derived totals.
- **Where:** Native sheet/review readers and retained time detail projection; REST list, both search methods, statistics and CSV/JSON exports.
- **Gate:** Shared authority/projection shape with high disclosure cost. ACT / bounded-now in the approved time workstream.
- **Status:** extended the retained reader to independently admit sheet entries and current-sheet review history; reused home ownership/delegation and a tracked-browser identity resolver. Shared read locks preserve concurrent reads. REST list/search/statistics/CSV/JSON export now consume the same projected entries before filters, pagination or aggregation; collection owners/sheets are retained before source parents. Five focused API checks cover actual effort, omitted scope, masked-field inference, array filters, expiry and response schemas. Native broader sheet summaries/time search remain pending. Collection scans currently admit all tenant entries; scalable SQL candidate narrowing/batching and wider lock-order validation remain for the later review pass.


## native-time-deletion — pattern
- **What:** Browser/API deletion must retain actual work authority through billing reversal, row/child deletion, task effort and post-commit identity events.
- **Where:** Native `deleteTimeEntry`, REST `TimeEntryService.delete` and bulk dispatch.
- **Gate:** Two adapters with high-cost permission, financial and rollback invariants. ACT / bounded-now under the approved time workstream.
- **Status:** shared customer-owned deletion boundary and billing-reversal adapter implemented; tested expiry rollback, state privacy, timer receipts, acting-manager attribution and commercial allocation restoration.

## time-allocation-command-locks — friction
- **What:** Entry deletion retains its canonical entry before reading reversal allocations; nightly client reconciliation must use compatible serialization before taking its own ledger snapshot.
- **Where:** `reverseDeletedTimeEntryBilling`, shared `allocateTimeEntry` / `reverseTimeEntryAllocations` / `reconcileClientAllocations`.
- **Gate:** Financial snapshot correctness across concurrent entry and reconciliation commands. ACT / staged-migration within the remaining billing integration; changing only deletion cannot establish the shared invariant.
- **Status:** implemented for entry/ledger serialization. Allocation reloads and retains the actual row; reversal shares one client-scoped engine; reconciliation locks candidate entries before client balances and rereads after waits. Five focused source-mode PostgreSQL checks passed (concurrent reversal, stale allocation input/retry, deletion/reconciliation in both orders, invoicing during a lock wait). Broad billing/Citus validation and the wider source-parent/invoice lock audit are deferred; this does not claim global application deadlock freedom.

## native-time-review-authority — pattern
- **What:** Native status updates and REST approval/change requests independently mutate approval state and publish private feedback without retaining work scope.
- **Where:** `updateTimeEntryApprovalStatus`, REST `approveTimeEntries` / `requestChanges`, `nativeTimeReview`.
- **Gate:** Shared authorization, financial-state and feedback-transaction invariants across two adapters. ACT / bounded-now in the approved time workstream.
- **Status:** Shared per-entry review command implemented with actual credential, delegation, source/entry/sheet policy, mutation guards, transition checks, billing evidence rejection and after-commit identity-only events. Six focused source checks passed. Whole-sheet commands, bulk sheet operations, optional approval-note storage and broader mutation/lock verification remain pending.

## native-time-sheet-command-authority — pattern
- **What:** Submission, single/bulk approval, return and reversal must authorize every affected entry under one retained sheet transaction; filtered views cannot authorize hidden work.
- **Where:** `timeSheetOperations.submitTimeSheet`, four review actions in `timeSheetActions`, shared `nativeTimeSheetCommand`.
- **Gate:** Five adapters share high-cost scope, state, financial and atomicity invariants. ACT / bounded-now in the approved time workstream.
- **Status:** shared all-or-nothing engine retains owner/sheet/source/entry policy and state, checks all billing evidence, stores audit comments and queues identity events after commit. Six focused source-mode scenarios validated, including a two-case follow-up for localized bulk errors and actual session-expiry rollback. Broader sheet/comment readers, related comment writes/deletion, API sheet commands and wider concurrent lock ordering remain pending.

## native-time-sheet-comment-authority — pattern
- **What:** Whole-sheet free text can reference any entry; independently filtered entries cannot safely redact that prose. Comment writes also trusted caller-supplied authors and approver flags.
- **Where:** Native `fetchTimeSheet`, alternate sheet entry reader, `fetchTimeSheetComments`, `addCommentToTimeSheet`, shared time projection/comment command.
- **Gate:** Shared high-cost disclosure and attribution boundary across reads/writes. ACT / bounded-now in the approved time workstream.
- **Status:** sheet detail totals use admitted intervals; complete-content visibility controls the comment stream and comment writes; stored author/reviewer attribution comes from actual identity/ownership. Final credential/lifecycle checks retain rollback. Five focused source-mode cases pass. List/approval-dashboard readers, sheet creation/deletion and wider scale/concurrency verification remain pending.

## native-time-sheet-list-authority — pattern
- **What:** Own/all sheet lists, manager approvals and period summaries independently joined raw sheet/entry/user rows and bypassed retained detail visibility.
- **Where:** `fetchTimeSheets`, `fetchAllTimeSheets`, `fetchTimeSheetsForApproval`, `fetchTimePeriods`, shared `nativeTimeSheetList`.
- **Gate:** Four adapters share current credential, delegation and disclosure invariants. ACT / bounded-now in the approved time workstream.
- **Status:** all use retained sheet projections; employee metadata and metrics honor masks; scope-limited removal counts remain unknown, and the period UI renders masked metrics as an em dash. Six focused source-mode scenarios pass. Sheet creation/deletion, API sheet/period adapters and broader scale/concurrency verification remain pending.

## native-time-sheet-lifecycle-authority — pattern
- **What:** Native lazy opening/removal and API automatic sheet creation independently trusted user/period hints and performed unheld check-then-write operations.
- **Where:** `fetchOrCreateTimeSheet`, `deleteTimeSheets`, `TimeEntryService.getOrCreateTimeSheetForWorkDate`, shared `nativeTimeSheetLifecycle`.
- **Gate:** Three adapters share current identity, owner/period, creation permission and retained emptiness invariants. ACT / bounded-now in the approved time workstream.
- **Status:** shared open/remove commands retain current authority and serialize creation on target users. Existing history is a read; missing sheets require create permission/current write entitlement. Empty-draft deletion checks actual children, clears private feedback atomically and retains final credential checks. Seven focused scenarios verified across the initial six-case run and a two-case API follow-up. Standalone sheet/period API services and wider concurrency/scale verification remain pending.

## native-time-sheet-api-adapters — pattern
- **What:** Standalone API sheet readers and workflow methods rebuilt raw queries and state changes independently of the current native time authority, with placeholder permission checks and columns absent from the actual schema.
- **Where:** `TimeSheetService`, manual `ApiTimeSheetController` handlers, shared native sheet read/list/command/comment/lifecycle domains.
- **Gate:** The existing domains already own the same permission, visibility and transition invariants. ACT / bounded-now as API adapters, with a pure projection-to-DTO/filter/sort helper.
- **Status:** Sheet reads/list/search/comments/workflow/removal now reuse current domains and actual API credentials. Command feedback and safe response reads share the mutation transaction. Five focused source-mode scenarios verified across the initial and corrected three-case follow-up. Generic create/update/notes, statistics, export fidelity, period/schedule adapters and broader verification remain pending.

## native-time-sheet-create-edit — friction
- **What:** The generic API create/update contract had no persistent notes storage and could directly assign approval state, while lazy sheet opening already owned user-period creation serialization.
- **Where:** `nativeTimeSheetLifecycle`, `nativeTimeRead`, `nativeTimeSheetCommand`, `TimeSheetService`, additive timesheet notes migration.
- **Gate:** Extend the existing lifecycle engine with distinct explicit-create and lazy-open entry points; compose existing workflow commands instead of duplicating transitions. ACT / bounded-now.
- **Status:** Explicit creation rejects duplicates under the existing user lock; retained note edits require complete sheet content and current update authority. Status assignments use review commands. Read projections and command receipts protect sheet-wide free text. Five focused source-mode scenarios pass in 9.40 seconds; broad validation remains deferred.

## native-time-sheet-reporting-projections — pattern
- **What:** Statistics were a placeholder and controller exports silently used the first unfiltered list page; reconstructing reporting queries would duplicate customer visibility rules.
- **Where:** `TimeSheetService`, `timeSheetCollection`, search/export/statistics handlers in `ApiTimeSheetController`.
- **Gate:** Existing admitted collection supplies authoritative visible rows; pure projections support statistics and all export formats. ACT / bounded-now.
- **Status:** Reporting derives exclusively from admitted fields; unknown metrics stay null, exports include all permitted rows with explicit filters/fields/groups, and real XLSX/escaped CSV retain private-content masks. Three focused scenarios pass in 10.22 seconds, with direct Node filter/calendar checks. Collection scale, HTTP/browser and wider validation remain deferred.

## native-time-period-calendar-engine — friction
- **What:** API, browser and background model period writers used separate unheld overlap/emptiness checks; locking existing rows cannot serialize creation in an empty calendar. Generic API generation also introduced one-day gaps.
- **Where:** `db/timePeriodCalendar`, `co-managed/nativeTimePeriod`, `TimePeriod` model, native period actions and `TimeSheetService`.
- **Gate:** Three concrete mutation paths share stable calendar invariants and meaningful concurrency risk. ACT / bounded-now in the approved operational-time workstream: centralize storage invariants below feature authority, with a tenant lock table registered/distributed through the existing infrastructure.
- **Status:** Model and customer commands share serialized calendar writes; feature commands retain current credentials and permissions above that engine. Native/API generation uses contiguous boundaries and atomic insertion. Seven focused scenarios verified across the six-case core run and corrected generator follow-up. Period settings and explicit background-job authority/lifecycle remain pending, as do broader regression, Citus and lock-order checks.

## native-time-period-settings-authority — pattern
- **What:** Two native settings readers, native writes, API settings methods and generation consumed different settings shapes and independently trusted tenant-scoped rows. API label/count fields conflicted with the stored numeric-count/unit model.
- **Where:** `nativeTimePeriodSettings`, `TimeSheetService`, both native settings action modules and settings-driven generation.
- **Gate:** Stable settings invariants and existing calendar lock support shared domain normalization/read/manage admission without another storage engine. ACT / bounded-now.
- **Status:** Current credentials, bundle scope, field masks and lifecycle guard shared settings operations; calendar locking serializes active-profile conflict checks with generation. Legacy inputs normalize once, canonical responses preserve IDs, compatible profiles coexist and inactive history remains readable. Five new focused scenarios and the affected generator pass in 9.46 seconds. Background authorization and broader generator parity remain pending.

## native-time-period-worker-boundary — friction
- **What:** The background generator was exported as a server action, accepted caller-supplied settings and diverged from browser calendar calculations.
- **Where:** `timePeriodJob`, scheduling `timePeriodAutomation`/`timePeriodCadence`, `TimePeriodSuggester`, native generation and scheduler registration.
- **Gate:** An actual persisted system job supplies bounded worker authority; the existing calendar engine serializes work and shared pure date math removes divergent period-end calculations. ACT / bounded-now.
- **Status:** Worker admission retains processing job/queue identity and current product/lifecycle; active settings are loaded under the calendar lock and final authority changes roll dates back. Native generation and suggestions share exclusive ends and compatible profile boundaries. Six focused scenarios verified across initial and corrected assertion runs; broader calendar, worker integration and Citus/browser coverage remain deferred.

## native-schedule-read-authority — pattern
- **What:** Native detail and API list/detail had divergent private-entry filtering and no common retained source/credential boundary; API enrichment returned placeholder work titles and unadmitted assignee PII.
- **Where:** `nativeScheduleRead`, schedule detail actions and `TimeSheetService` schedule readers.
- **Gate:** Three real consumers share stable read admission and high disclosure cost. ACT / bounded-now within approved scheduling work.
- **Status:** Retained credentials, actual assignments, schedule/source scope and explicit projections now govern these readers; five focused scenarios verified across initial/follow-up/expiry runs. Native recurring collections and all schedule command adapters remain pending.

## native-operational-source-admission — pattern
- **What:** Time and schedule readers retain the same project/task/ticket/interaction roots but apply different operation permissions.
- **Where:** `nativeTimeEntryAccess` and `nativeScheduleRead`.
- **Gate:** Real duplication with meaningful lock/field-projection cost; schedule commands and recurrence are still evolving. WAIT for the command boundary before extracting a shared work-source engine.
- **Status:** Watching; source authority is explicit in both domains, and scheduling does not require time-entry permission.

## native-schedule-calendar-projection — friction
- **What:** Native calendar reads bypassed retained detail authority; the model excluded recurring masters while the recurrence engine also excluded their first occurrence.
- **Where:** `nativeScheduleRead`, `getScheduleEntries`, shared recurrence utilities and model expansion.
- **Gate:** Existing admitted master/source projection is the appropriate layer for every occurrence; an explicit pure-engine master-inclusion option fixes the calendar contract without changing subsequent-only consumers. ACT / bounded-now.
- **Status:** Native calendar expansion retains actual master/assignment/source scope and projects each occurrence after holiday/exception processing. Half-open overlap includes spanning events; first occurrences are represented once. Three focused PostgreSQL cases, 18 pure recurrence cases and four existing model cases pass using fast Node source tests. Schedule commands and broader timezone/workday/scale checks remain pending.

## native-schedule-command-authority — friction
- **What:** Schedule API writes used raw rows and independent permission checks, wrote assignment arrays as columns, returned details only after commit and published private snapshots. Own-calendar permission also differs from dispatcher permission while bundles must evaluate the actual command action.
- **Where:** `nativeScheduleCommand`, shared schedule read/source helpers, `TimeSheetService`, schedule schemas and model update.
- **Gate:** Create/update/delete share stable current actor/source/assignment and response-admission requirements. ACT / bounded-now for API master commands; native recurrence scopes follow.
- **Status:** Commands retain current credentials, write lifecycle and actual assignments, map own/dispatcher RBAC from locked state while retaining actual bundle actions, normalize model inputs, protect time dependencies and publish IDs after commit. Six focused scenarios verified across corrected runs; eight existing model-update cases pass in under a second. Native adapters, recurrence command scopes and appointment/workflow consequences remain pending.

## native-schedule-recurrence-commands — friction
- **What:** Native mutations bypassed API command authority; model recurrence branches conflated empty/null updates with absence, reused master dates for future splits and reset counted series. Stored-master replacement on first-occurrence cancellation could also discard historical source identity.
- **Where:** `nativeScheduleCommand`, native schedule actions and shared schedule model recurrence branches.
- **Gate:** Existing retained command admission fits occurrence mutations when master membership is verified first; the model must preserve explicit fields and count/duration semantics. ACT / bounded-now.
- **Status:** Native mutations share current credentials/scope; exact occurrence checks, single/future/all behavior, stable cancellation identity and actual-row events are verified by eight focused PostgreSQL scenarios and 22 fast model cases. Native branches now publish identity-only schedule events; appointment/Teams cleanup and derived workflow consequences still need retained integration.

## native-schedule-relations — friction
- **What:** Co-managed calendar commands needed atomic local appointment/meeting cleanup; legacy request-only provider IDs would otherwise disappear during cancellation, and external failure must not leave a half-cancelled local booking.
- **Where:** `nativeScheduleRelations`, retained schedule source/command admission and online_meetings synchronization intent columns.
- **Gate:** The admitted schedule transaction owns its local relation changes; provider work requires a durable operation retained on the actual meeting. ACT / bounded-now for local consistency and intent storage.
- **Status:** Local request/meeting rescheduling and cancellation, stable provider IDs, conflicting binding rejection and final-credential rollback pass six focused source-mode PostgreSQL scenarios in 9.45 seconds. Six source files and the migration pass syntax checks. External provider execution, retries and explicit appointment/meeting action admission remain pending; no Graph calls or broad builds performed.

## native-schedule-meeting-reconciliation — friction
- **What:** Committed calendar changes left external provider state pending; ordinary cleanup drops unavailable operations and addressing the current organizer can target the wrong mailbox after configuration changes.
- **Where:** `nativeScheduleMeetingSync`, scheduling provider bridge, existing Teams maintenance sweep and Graph update/delete adapters.
- **Gate:** Reuse the durable meeting operation as narrow system reconciliation authority and existing recurring maintenance for recovery; serialize the provider effect on that actual operation. ACT / bounded-now.
- **Status:** Pending clock updates/deletions retry without copying calendar text or attendees, retain unavailable operations and sanitize persisted errors. Persisted event/organizer identity is required; incomplete legacy bindings stay pending for repair instead of acknowledging guessed-resource 404s. Six focused PostgreSQL scenarios, six fast mocked provider cases and six syntax-only checks pass. Recipient reconciliation, broader appointment action authority and live runner/provider validation remain pending.

## native-appointment-authority — friction
- **What:** Appointment list/detail/ticket-linked readers disagreed on visibility; direct decline/reschedule writers bypassed retained request/schedule authority, transactionally coupled cleanup and final credential checks.
- **Where:** `nativeAppointmentRequest`, `nativeAppointmentRequestCommand`, schedule relation engine and native appointment adapters.
- **Gate:** The actual request source, preferred technician, current approver configuration and schedule are the shared admission substrate for these operations. ACT / bounded-now for read/decline/reschedule; approval and provider creation follow.
- **Status:** Current read scopes and field-safe filters/labels, atomic decline/rescheduling, pending-state preservation, local-time validation and final-expiry rollback are verified by eight new focused PostgreSQL scenarios. The existing implicit-approval guard also passes; five sources pass syntax checks. Requester notifications, recording artifacts, approval/creation, association and legacy binding repair remain pending. The pure approver-config decoding duplication is marked at both layers for later extraction.

## native-appointment-approval-and-ticket — friction
- **What:** Approval needed current request/assignee/schedule authority and stable creation identity; ticket association replaced the calendar's appointment reference and broke later relation commands.
- **Where:** `nativeAppointmentApproval`, request schedule-policy projection, native approval/association adapters and schedule model creation options.
- **Gate:** Reuse the retained request policy for old/proposed ticket roots and actual schedule changes. Allow command-reserved model IDs to align pre-insert admission with the real row. ACT / bounded-now for local approval and association.
- **Status:** Six focused PostgreSQL scenarios verify local approval, duplicate creation prevention, scope/masks, stable ticket association, legacy repair and final-expiry rollback; six sources pass syntax checks. Teams-enabled approval remains on its legacy path until the provider coordinator is connected. Shared canonical allocation admission is marked at the three command sites for later extraction.

## appointment-meeting-creation-recovery — friction
- **What:** A successful Graph create followed by a lost response or failed local approval could orphan an external event; the old provider also discarded partial creation evidence before online-meeting indexing completed.
- **Where:** Shared retained approval planner, `meetingCreationOperation`, new journal migration, EE creation/recovery helpers and the CE-safe provider registry.
- **Gate:** Freeze an admitted operation before external effects, retain its source fingerprint and original organizer, and pair retry identity with read-only provider discovery. ACT / bounded-now for preparation and recovery substrate.
- **Status:** Immutable duplicate-safe reservations and changed/expired authority rejection pass four focused PostgreSQL cases; seventeen mocked provider cases verify transaction/property identity, lost-response recovery, partial receipts and target changes. Eight sources and the migration pass syntax checks. Actual create/attach coordination and durable cleanup execution remain pending; no live provider or migration effects performed.

- 2026-09-07 — Appointment creation now composes the shared retained approval planner with a durable provider operation. The scheduling layer owns Graph payload rendering and transport adaptation; the co-managed layer owns current authority, frozen disclosure, state transitions, atomic attachment and narrow compensation. The recurring Teams runner supplies only durable identities, and recovery never builds new recipients or reissues creation. Remaining friction: Generate Teams Meeting still has its legacy orchestration, requester mail/artifact admission is separate, and an ambiguous absent provider event needs an explicit resolution policy.

## appointment-meeting-creation — friction
- **What:** Approved-request generation previously duplicated provider creation and bypassed the retained receipt/attachment engine used by approval.
- **Where:** `nativeAppointmentApproval.ts`, `meetingCreationOperation.ts`, `appointmentMeetingCreation.ts`, and the scheduling generation action.
- **Gate:** Two concrete callers with the same irreversible provider effect and compensation rules; high duplication cost and a stable durable-operation boundary. ACT / bounded-now within the approved meeting workstream.
- **Status:** revised. Both callers compose purpose-specific retained intent with one preparation, attempt, attachment and recovery engine. Generation uses actual calendar times and all current assignees, while approval keeps its status transition and frozen encoding. Only undisclosed failed placeholders are reusable. The previously recorded Generate Teams Meeting orchestration gap is closed; notifications, artifact delivery and ambiguous-event resolution remain separate requirements.

- 2026-09-07 — Native artifact metadata, content delivery and transcript-document admission now share `retainNativeOnlineMeeting`, which retains all actual source owners and the calendar before the artifact. Media requires full source/content visibility; the composition route owns storage/Graph streaming and receives only retained identities. The native browser session adapter shape is marked in the document bridge; capture, portal/API HTTP adapters, interaction projections and generic file delivery remain subsequent callers to migrate.

- 2026-09-07 — `resolveMeetingArtifactActor` gives both artifact HTTP URLs one explicit principal boundary: a supplied key uses the real hashed-key validator and its actual tenant/user/key identity, while absent keys use the tracked browser session. The retained domain consumer remains responsible for current key scope and expiry. No user-profile-only API override or caller tenant header is treated as credential evidence.

- 2026-09-07 — Interaction loaders were another live source of unprojected meeting rows, beyond the dedicated meeting action. `readCoManagedNativeInteractions` now owns current interaction/label projection, search and count semantics; `nativeInteractionMeetingView` and the shared artifact projector own linked meeting visibility. The storage model retains its internal shape, while the public interaction type references an explicit meeting view. Native session adapter duplication is marked; API credential propagation is still evolving, so extraction is deferred. Mutation/refresh enrichment and broader model/API consumers remain to migrate.

- 2026-09-07 — Interaction editing now owns one retained transaction for credential/lifecycle, old/proposed relationships, record field scope, mutation and response projection. It bypasses the legacy model method that opened its own connection inside a nominal transaction and returned raw meeting enrichment. An exact-identity option on the existing reader supplies the mutation response without introducing a second projector. Linked calendar/media/effort identity is preserved until an explicit linked-work operation handles the change; creation/deletion remain subsequent command paths.

- 2026-09-07: Co-managed native interaction creation/deletion reuse the retained parent checks and admitted interaction projection. Extracted only the existing classification and linked-work checks within the command module; ordinary PSA fallbacks remain in the action layer. Seven focused source-mode PG cases passed in 11.97s; no build/broad regression. Direct model/API/workflow writers and derived creation workflow consequences remain open.

- 2026-09-08: Consolidated ticket export shares the existing admitted relation with queue pagination, using an internal pagination choice rather than a second policy/query implementation or independently fetched pages. The browser action only serializes admitted values. Existing CSV serializer copies now both quote carriage returns. Focused validation: 5 PG, 12 UI/action and 25 CSV cases passed without builds; bulk routing and remaining original plan tasks stay open.

- 2026-09-08: Bulk handback composes existing canonical handoff transactions and receipts. Each selected qualified ticket retains its own admission and failure result; no batch-level shadow lifecycle or replacement routing implementation. The queue exposes only the permitted work revision. Existing UI retry semantics freeze the complete uncertain batch. Six focused PG cases and sixteen distinct UI/action cases passed; field-alias refinement was checked separately. No builds.

## shared-work-assignee-admission — pattern
- What: Active MSP identity, technician participation, proposed-assignment policy and staffed-team eligibility repeat across ticket and project-task assignment.
- Where: `sharedWorkAssignees.ts`, `projectTaskAssignments.ts`, `ticketAssignments.ts` in `packages/co-managed/src`.
- Gate: Two concrete callers, high isolation risk, stable principal and membership rules, real reuse; ACT / bounded-now within assignment implementation. The helper accepts the domain's field restrictions and actual routing board, leaving storage/lifecycle outside it.
- Status: Extracted and exercised through both actual domain callers. Qualified work audit writing is shared similarly; the existing task wrapper preserves its task-only contract. Pagination remains a marked candidate rather than another extraction. Nine focused PG and ten action tests passed without builds.

- 2026-09-08: Ticket assignment UI composes the existing ticket assignment actions and parent refresh/access-loss callbacks. Generic assignment labels and ticket error translations are reused. Request lifetime is marked alongside task assignment as a candidate; no UI engine was extracted while these lifecycles still differ. Twenty-three focused source-mode UI tests passed in 2.67s; no build or database rerun.

- 2026-09-08: Revised the ticket work substrate to distinguish participation from escalation. Nullable, constrained escalation timestamps let the same assignment engine create work on already-collaborative boards without manufacturing a handoff or permanent ticket grant. Queue membership composes responsibility and assignment under their respective field visibility. Existing work/reference identity survives the first real escalation; handback clears active assignment. Eleven focused PG and thirteen UI cases passed without builds; migration replay/retained-data rollback refusal were checked in the disposable database.

## organization-sla-obligation — friction
- **What:** Native SLA storage and locking assume that the policy owner also owns the ticket; an MSP must have its own obligation for the canonical customer ticket.
- **Where:** `packages/sla/src/services/slaService.ts`, `slaLock.ts`, and the co-managed SLA requirements in this plan.
- **Gate:** High correctness cost (cross-tenant storage and repeated handoffs resetting deadlines); organization/source separation is settled. ACT / staged migration within the approved SLA work.
- **Status:** Added an independent clock reducer and transaction-scoped obligation/event store. Calendar classification reuses the existing shared segmentation primitive, retaining millisecond precision. Native ticket storage and its existing lock key remain compatible. Mapping/resolution adapters and scheduler integration are the next stage, not yet migrated.

Organization SLA migration checkpoint (2026-09-08): shared policy/calendar resolution now lives in `shared/lib/sla/slaPolicyResolver.ts`; native SLA callers use the extracted helper unchanged. Co-managed handoffs reuse that precedence with explicit, administrator-owned priority mappings and independent persistence. Start/pause/resume are connected to actual handoff transactions; response/resolution admission, scheduling, and policy-change reconciliation remain in the next stage. No second ticket or customer SLA rewrite was introduced.

The clock, store, and organization lock also moved into `shared/lib/sla`, with compatible SLA-package re-exports. Direct co-managed → SLA imports would create a co-managed → SLA → notifications → co-managed cycle; both consumers now depend on the existing lower shared package. Shared resolver types use the existing backend contracts in `@alga-psa/types`. Source-mode native/organization checks (47 cases) and two targeted PG handoff/configuration checks passed after this dependency correction.

Organization SLA source effects checkpoint (2026-09-08): `ticketSla.ts` now retains the canonical ticket/work and current visibility before applying first response, resolution, or reopen effects. The native and shared mutation adapters use one organization-obligation reducer/store. Replies use actual persisted attribution and root/reply audience rather than an event-bus payload; completely revoked work remains frozen. Future timer workers must preserve source-ticket/work → organization-obligation lock order before choosing an observation timestamp so they cannot race a source mutation with a later clock observation.

Organization SLA scheduler checkpoint (2026-09-08): CE and EE reuse the same qualified observation adapter through the existing maintenance fanout, with independent schedules and no duplicate ticket workflow state. The adapter reuses the source-retaining helper from synchronous reply/closure effects and the shared clock/store; source work is locked before organization time is observed. Nine focused PostgreSQL cases and 23 maintenance unit cases passed. Warning thresholds and recipient delivery remain subsequent adapters.

Organization SLA display checkpoint (2026-09-08): qualified ticket readers reuse the immutable organization clock for current display projection; reading never emits timer events or invents a second SLA store. A minimized presentation contract separates native customer timing from MSP timing, keeping policy configuration and private pause details out of the shared screen. Source-field redaction removes derived displays together. Existing source/credential admission is reused; repeated screen admission remains a performance candidate to watch rather than a new authorization abstraction in this pass.

Organization SLA notification checkpoint (2026-09-08): the shared organization event store captures threshold crossings atomically, so timer polling, handbacks, replies, and closures do not each need a separate notification detector. Existing policy-owned threshold configuration supplies recipient flags/channels; the outbox retains source identity and timing, never cached ticket text as authority. ACT / staged migration: detection and durable inputs are connected, while recipient verification and existing inbox/delivery adaptation remain the next stage. Fifteen focused PostgreSQL cases passed without a production build.

## co-managed-notification-source-dispatch — friction
- **What:** Inbox and channel delivery were hard-wired to comment receipts; SLA notices require a distinct durable source without cached-content fallback.
- **Where:** `coManagedInbox.ts`, `notificationDelivery.ts`, and the new organization SLA notice readers.
- **Gate:** Two high-risk authorization/presentation callers with a stable source-qualified contract; ACT / bounded-now within planned notification integration.
- **Status:** Both callers now use `withCoManagedStoredPresentation`, which dispatches to comment or SLA verification under the owning transaction. Actual comment/inbox regressions and SLA recipient/redaction/queue cases passed. Transport-specific effects remain in the existing delivery queue/runtime; email notices are retained pending their send adapter.

Organization SLA email checkpoint (2026-09-08): recipient preference gates reuse `coManagedInternalEmailRecipient` with the existing SLA subtype catalog. The dedicated SLA receipt queue reuses the current source verifier and the existing tenant email service; channel completion is kept separate from fanout and in-app delivery. Retry-state repetition is marked alongside the existing comment/email queues; source identities and authority remain distinct, so no transaction/transport abstraction was extracted in this pass. Eleven focused PostgreSQL cases and 30 job/transport unit cases passed with mocked sends.

## email-template-context-escaping — friction
- **What:** The generic database template processor substitutes raw strings into HTML, text, and subjects using one operation; authorized ticket text still needs output-context escaping.
- **Where:** `packages/email/src/templateProcessors.ts` and `coManagedSlaEmailTransport.ts`.
- **Gate:** High correctness cost but wide existing-caller impact. ACT / staged migration when revising the generic renderer; do not silently change every existing email template in an SLA delivery task.
- **Status:** SLA transport loads existing template definitions without raw data substitution, then safely fills its flat admitted data. Existing processor semantics remain compatible; general engine revision remains staged work.

## ticket-close-transition — pattern

Primary ticket updates and bundle child propagation now both perform close-rule admission, closure fields, independent SLA effects, and audit. The full primary updater also owns notifications, so calling it recursively would duplicate the existing master-owned bundle close email behavior. Keep the per-child path explicit for now; a future extraction should separate the canonical lifecycle transition from notification ownership and retain each source transaction and actor's authority. Markers are in `packages/tickets/src/actions/optimizedTicketActions.ts`.

## executing-workflow-authority — pattern

Co-managed conversation retention and ticket field mutation retain the same executing workflow run/version, published actor, lifecycle, and current home permissions. Both now have inline markers. The runtime supplies these domain adapters through composition registries to avoid a shared-to-co-managed package cycle. A common retained workflow-authority layer should eventually cover other operational actions; do not substitute an unqualified run-user lookup or generic event payload for admission.


Workflow closure checkpoint (2026-09-08): the existing ticket workflow admission was factored into `workflowTicketAuthority.ts` for operational mutations and committed closure-email delivery. This is a bounded extraction: both callers retain the exact version/author, current record and field permissions, while only mutations require a running lease. Conversation admission remains a separate caller to reconcile later. The mutation registry supplies a transactional email-intent capability instead of importing its co-managed consumer. Closure email retains its distinct command identity; bounded email retry and context-aware template substitution remain marked alongside the existing queues/renderers. Notification recovery now continues independent committed stages and aggregates failures, matching the existing SLA maintenance behavior (`independent-maintenance-recovery`); no general job engine was introduced.


## normalized-time-billing-work — pattern (bounded extraction)

The contract and catalog billing loaders duplicated native ticket/project joins and assumed a time owner also owned the work. The new shared work kind made those joins insufficient; both now use `timeEntryWorkContext.ts`. It produces one owner/type/id-qualified billing row from native work or an MSP-owned retained reference, keeps foreign project IDs out of local project billing rules, and leaves charge calculation in the existing engine. Invoice snapshots and grouping preserve the qualified source. The local conditional time-entry/reference FK deliberately uses an explicit nullable reference column plus a type/ID equality check, preserving real tenant-local referential integrity without a hidden ticket or foreign-tenant FK. General time UI/writer adoption is the next stage, not a second billing engine.


## time-work-evidence — pattern

Reference registration and admitted new time contributions capture the same allowlisted ticket/task descriptions. Both now carry an inline marker. Current time writes refresh local evidence only inside the retained source transaction, so failed writes cannot capture customer changes. Historical MSP time uses current home authority and retained evidence without live customer reads. A future common evidence projector should preserve those distinct admission and transaction contracts; it must not turn registration alone into participation or an archive entitlement. Native browser/API financial save-field requirements also repeat and should converge when the existing API billing stub is brought into native billing parity.

Shared timer checkpoint (2026-09-08): the third financial writer now uses `assertCoManagedTimeSaveFields` with the native browser/API callers. This bounded extraction keeps their returned commercial fields consistent without changing unrelated native time behavior. Existing clocks and completed time use the same retained-evidence admission; a guessed reference or registration alone cannot substitute for actual effort. Timer completion continues through the existing receipt and API writer rather than a separate time engine.


## time-entry-preparation — friction (bounded extraction)

The native launcher coupled user/period/sheet preparation to a global drawer. Shared customer screens need their form lifetime to follow the qualified resource and release boundary. `prepareTimeEntryForWorkItem` now returns the existing form inputs, and the native drawer launcher and shared-work dialog both consume them. No alternate timesheet writer or form was introduced. The native launcher now propagates save failures to the existing dialog handler, eliminating a swallowed-error path that could report success. Shared client lookup retains the actual source/entry authority and then uses ordinary contract selection; it does not add a separate billing engine.


## native-time-billing-command — pattern (bounded extraction)

Native saves held contract resolution and allocation sequencing inline while the REST writer returned stub contract fields. Both now use transaction-bound contract selection and the existing reverse-old/apply-new allocation routine. Candidate loading is separate from browser authentication, preserving the retained write connection. Charge calculation and invoicing remain in the existing billing engine; this extraction does not introduce another invoice engine. The same task/client lookup also existed in prepaid-hour allocation, so work client/profile resolution moved into shared billing runtime and scheduling retains a compatibility facade. Reconciliation’s collection query now admits the shared reference kind. Current lower-level lock-order and eligibility concurrency audits remain part of the broader billing validation work.

## shared-work-effective-grant — pattern (watching)

MSP source admission and customer-side aggregate reads both resolve explicit ticket or board visibility. Customer ownership permits local effort after unsharing, so it cannot use foreign-user admission directly. Two sites now carry the marker; keep this small predicate duplication while the aggregate/retention contract settles rather than introducing a generic cross-tenant grant engine. Project effort composes existing work authorization for each actual child and reads owner-local time instead of copying timesheets or mutating native cached hours.

Native task effort checkpoint (2026-09-08): reused the project's existing composition-slot pattern for an optional TaskEffort component. The server workspace layer owns product/session knowledge and co-managed actions; the native project form receives only its local task ID. The provider sits above the common drawer outlet so task dialogs and pages have the same behavior without importing server product code into projects. No new calculation or timesheet engine.

## co-managed-relationship-closure — domain transaction boundary

Explicit departure and independent upgrade need the same retained trust/capacity order, archive cutoff, final credential check and idempotent release. `closeCoManagedRelationship` supplies that boundary without granting independent product entitlement. The caller must provide a transactional evidence finalizer; there is no default or public action until the production archive adapter exists. This keeps future upgrade orchestration from reimplementing seat release or closing access before authorized evidence is retained. Current validation proves transaction semantics with stand-ins, not archival completeness.

## co-managed-participation-evidence — retained event boundary

Handoff and shared-work audit writers now call one append-only evidence recorder after their actual source event exists in the transaction. It resolves the sponsoring owner and qualification from persisted records, selects explicit fields and compares immutable replay hashes. Archive participation comes from actual work, not a viewed row or registered time reference. No generic audit-log copier or retrospective source scanner was introduced; later conversation/file adapters must enforce their own audience rules before entering the archive.

Time participation checkpoint (2026-09-08): the second source adapter uses a factored qualified append/hash store. Source eligibility and content selection remain in the handoff/audit and completed-time adapters. Native manual, API and timer-completion writers invoke capture inside their actual transaction; no read-side capture, shadow timer, copied timesheet, or foreign-source lookup was introduced. First time proof is immutable even when the retained native entry subsequently moves, changes or is deleted.

Conversation capture checkpoint (2026-09-08): effective source disclosure now has two concrete non-user consumers, organization effort totals and transactional conversation retention. Extracted their small predicate into `hasEffectiveSharedGrant`; each caller still owns its current trust/authentication boundary. The shared-work authorization engine retains its richer predicate with collaboration/routing decisions, so its existing marker stays. Newly inserted canonical event intent is the single capture hook for ticket/task writers; retries do not re-read mutable history. Source adapters continue to own audience and participation eligibility, and the immutable store remains a qualified append/hash primitive.

## co-managed-archive-file-staging — transaction and storage boundary

Archive retention must survive customer object removal immediately, while remote storage retries must not keep reading newly private sources. The writer therefore captures verified bytes into MSP-owned transactional staging; existing tenant maintenance drains that staging into a separate immutable object identity. This is a bounded domain outbox, not a generic storage framework. Direct uploads supply already-confirmed bytes; publication/disclosure adapters use the existing storage provider. The existing 25 MB attachment limit bounds each staged object, and successful storage clears its temporary database payload. File metadata and byte identity are immutable; retention readers must enforce current MSP policy separately. Effective grants and qualified participation reuse existing lower-level rules. Future source types can use the same staging/transport boundary once their actual audience and publication semantics are defined.

## co-managed-retained-read-authority — local policy projection

Retained time and archive reads need current MSP work permissions without requiring renewed customer trust. The archive reader composes the existing credential locks, RBAC/bundle evaluator and qualified local routing projection; it does not fabricate a foreign session or reuse live collaboration admission. Stored source identities select retained records only. One archive admission function serves discovery, history, file metadata and byte delivery. Source-specific field restrictions remain in presentation, and file transport retains the final credential check. No generic export or authorization engine was introduced; time and archive projections remain separate while their caller-specific retention rules settle.

Private archive checkpoint (2026-09-08): the existing common MSP-private ticket/task writer now owns one receipt-based capture hook. Canonical and MSP-private file source adapters retain distinct publication/audience admission, then share a small published-file selector and immutable byte-staging engine. This removes duplicated copy/retry mechanics without merging the two privacy boundaries. Archive reads likewise apply private and canonical source restrictions separately. Earlier source-enumeration migration replays preserve later expansions instead of narrowing an already-upgraded schema; no generic migration framework was introduced.

Sharing reduction checkpoint (2026-09-08): bounded revision of canonical conversation capture separates real outbox-event admission from the source snapshot. Explicit revocation and board/project policy removal can now reuse the existing source/audience/participation rules without manufacturing comment events or an MSP principal. The persisted policy event supplies the snapshot operation identity. No generic archival framework or backend release-flag boundary was added.

Source move checkpoint (2026-09-08): the existing archive source capture now has a small internal adapter for native ticket/task/phase moves. Existing mutation admission remains in each writer; the adapter handles actual relationship resolution and phase-child expansion, then delegates to the same qualified capture engine. No change to the licensing transaction abstraction or generic callback registry was needed. Whole-batch structure updates capture before mutating phase membership.

Closure seal checkpoint (2026-09-08): source-specific archive admission remains separate from the immutable manifest. The closure primitive seals only already-owned evidence/file identities and checksums after its mandatory finalizer, then revokes trust. This keeps file storage retries independent of live sharing and avoids a generic export framework. A fixed ordered checksum representation avoids depending on JSONB object-key order.

Private closure source checkpoint (2026-09-08): extracted the existing private evidence construction behind two actual source admissions: a newly persisted private command and closure's qualified owned history. Closure does not fabricate a writer context or read current customer work to recover captions. The owned-file adapter permits retaining a previously disclosed private source without granting any new live write authority.

Work snapshot checkpoint (2026-09-08): extracted the existing shared metadata candidate projection for live reads and admitted archive capture. This reuses its explicit field allowlist and derived-source aliases without manufacturing a session or widening source reads. Archived candidates retain those aliases for current policy projection. Private note-body restrictions stay distinct from work metadata restrictions; no generic record-export layer was introduced.

Archive composition checkpoint (2026-09-08): closure now has a concrete composition of its source adapters. Candidate discovery derives from actual participation records and historical contributions, while each source retains its own live-grant/owned-data admission. Historical handoff/audit recovery reads persisted actor attribution directly and skips existing evidence; it does not impersonate the original writer or reuse a current session as historical proof. The immutable store/seal remain below this source composition.

Tenant licensing checkpoint (2026-09-08): the installation singleton cannot represent an independently licensed customer on the MSP's host. Added a tenant-scoped override below tier and seat resolution, keeping signed-token verification and the existing pure state resolver. A minimal resolution input avoids manufacturing installation IDs or connected-appliance credentials for a tenant license. User admission passes its real tenant/transaction; no changes to global installation licensing or subscription ownership are hidden in activation.

PSA upgrade backfill checkpoint (2026-09-08): the existing backfill engine opened separate transactions, preventing an independent co-managed upgrade from committing its commercial defaults together with entitlement and closure. Reused the existing optional retained-transaction bootstrap helper for four backfills. Existing activity callers retain their original boundaries; no duplicate seed engine or new generic transaction abstraction. The permission catalog adds only the approved forward product transition.

Independent upgrade checkpoint (2026-09-08): the domain coordinator owns current customer authority, lock order, closure reuse, capacity accounting and immutable replay. Its runtime adapter supplies an actually retained paid entitlement and calls the existing PSA backfill engine. This keeps self-host token verification in licensing and leaves hosted payment admission to its future concrete adapter, rather than coupling the domain to Stripe or duplicating product seeds. Already-departed upgrades consume the original closure seal instead of rerunning source capture. An upgrade receipt is distinct from a closure receipt because the customer can depart before purchasing PSA.

Tenant license management checkpoint (2026-09-08): management scope now comes from actual product identity, owned licensing or durable upgrade history, rather than the installation singleton. The existing license action facade routes tenant status/activation into a retained customer-admin domain boundary and leaves ordinary installation operations in place. The pure resolver receives an explicit independent scope instead of fabricated trial timestamps, and the native seat limit follows signed renewal. The tenant UI is a small panel under the existing release boundary, with the original license-page activation/session-refresh orchestration reused.

Session licensing checkpoint (2026-09-08): inspection narrowed the suspected edition-runtime problem to the duplicated NextAuth callback paths, rather than the unused broad edition helper. Both callbacks now reuse tenant-aware licensing for the real session tenant, preserving hosted plan presentation and failing closed on license-read errors. No parallel tier engine or speculative global edition API was introduced.

- 2026-09-08 — Independent upgrade admission: extracted the existing customer-admin transaction admission so hosted provider inspection and final commit use the same session, trust revision and replay checks. Stripe reads happen between transactions; completion compares the retained subscription fingerprint before using the existing atomic upgrade coordinator. The two paid adapters' shared PSA backfill sequence is marked as a small extraction candidate. Two hosted source-mode PostgreSQL checks passed in 8.45s; three existing self-host cases also passed. Production builds and broad validation remain deferred for implementation speed.

- 2026-09-08 — Customer upgrade delivery: extended the existing tenant product-upgrade workflow with a single co-managed atomic activity; public actions construct its command from the actual tracked browser principal. The workflow retains its AlgaDesk path while independent conversion uses the already implemented entitlement/closure coordinator. Advisory UI state and durable completion receipts are customer-owned; the release flag is presentation only. Two focused source-mode PostgreSQL scenarios and five fast UI/workflow checks passed. Hosted purchase initiation remains separate work.

- 2026-09-08 — Independent hosted purchasing: the existing MSP pool purchase primitive assumes sponsor capacity and cannot own an independent customer subscription. A separate customer purchase journal uses current customer-admin admission and provider calls between short transactions. Checkout and webhook paths share session recovery and billing import; the existing paid PSA validator now serves both reconciliation and worker admission from the EE Stripe layer. The existing webhook handler intercepts pre-conversion billing so ordinary PSA cancellation cannot delete a still-sponsored customer. Three focused PostgreSQL scenarios and five UI checks pass; live provider timing/deployment validation remains open.

- 2026-09-08 — Payment recovery and seat confirmation: fresh Stripe invoice evidence distinguishes active-but-unpaid asynchronous failures from paid entitlement. The existing purchase journal now retains failure and prevents duplicate checkout; explicit retry reuses customer-admin admission and canceled-subscription recovery. Paid seat changes use Stripe's existing confirmation flow rather than adding a second charge/proration implementation. Four focused PostgreSQL cases and seven UI checks passed. The hosted worker uses the same secret-provider convention as checkout. Live portal configuration remains a deployment check.

## portable-document-authority — pattern
- **What:** Native document reads and portable export need the same association-to-client/owner/team projection.
- **Where:** `packages/documents/src/actions/documentActions.ts`, `packages/co-managed/src/portableDocumentExport.ts`.
- **Gate:** Two callers; high permission-drift cost; existing resolver is stable. Keep network/file transport separate from database authority.
- **Status:** revised / bounded-now (2026-09-08). Moved the resolver unchanged to `shared/lib/documents/authorizationRecords.ts`, added optional retained association/parent locks for export, and kept native reads on the default behavior. Focused export database checks and existing document authorization wiring checks pass.

## portable-blob-staging — pattern
- **What:** Document and conversation exports need the same private streamed staging, size/checksum verification, lease and cleanup behavior.
- **Where:** `packages/co-managed/src/portableDocumentExport.ts`, `packages/co-managed/src/portableConversationExport.ts`.
- **Gate:** Two callers, high byte-integrity/cleanup cost, stable transport shape. Domain-specific source admission and path ownership remain in their collectors.
- **Status:** extracted / bounded-now (2026-09-08) into `portableBlobStaging.ts`. Optional expected SHA-256 supports immutable conversation objects; native document streams receive a calculated digest. Four focused source-mode database/real-staging checks pass.

## portable-record-section — pattern
- **What:** strict portable table/column rosters, composite identities and parent references repeated across core, work and documents, with two incoming collectors.
- **Gate:** three stable existing sites; inconsistent validation admits malformed archives. ACT / bounded-now: a pure internal validator, without authorization, provider I/O or transaction orchestration.
- **Status:** extracted into `portableRecordValidation.ts`; core/work/document callers migrated. Domain conversation/source checks stay local. The assembler can require cross-section parents using the same reference engine. Five direct tests and six actual PostgreSQL collector regressions pass; authenticated archive assembly and restore remain separate work.


## portable-transfer-resource-context — pattern
- **What:** Native staging, remote capture, encryption and extraction need one cancellation and temporary-write budget per operation.
- **Where:** portableBlobStaging, portableArchive, portableRemoteMeetingExport, credential portable envelope and workspace coordinators.
- **Gate:** Repeated streaming boundaries share stable byte/deadline admission; missing a check risks retaining sensitive staging or exhausting disk. ACT / bounded-now.
- **Status:** extracted into portableTransfer; provider upload cancellation and durable crash cleanup remain distinct lifecycle work.


## independent-psa-backfills — pattern
- **What:** Hosted upgrades, tenant-license upgrades and restored-workspace activation must apply the same additive PSA setup atomically.
- **Where:** co-managed-hosted-upgrade, co-managed-upgrade-operations, portableWorkspaceActivation.
- **Gate:** Three real callers with an identical established four-step sequence and a shared transaction boundary; omission would produce inconsistent capabilities. ACT / bounded-now.
- **Status:** extracted as initializeIndependentPsa; the two prior source markers were removed. Activation's explicit workflow pause remains its own lifecycle policy.


## portable-upload-location-and-fence — friction
- **What:** Restore cleanup needs the provider's stable object-store location and a durable commit/abandon fence; transient upload leases hide both.
- **Where:** native provider base, portable file staging, restore coordinator and installation recovery command.
- **Gate:** Lost COMMIT acknowledgement and process-exit recovery are distinct verified lifecycle gaps; cleanup cannot safely reconstruct provider location from current environment alone. ACT / bounded-now.
- **Status:** revised native provider base to expose a credential-free location identity, fixed local base-path capture, and connected a durable restore-upload journal. Native reference publication retains the journal fence through a database trigger. Scheduled maintenance and local crash-staging cleanup remain separate work.


## portable-recovery-runtime-placement — friction
- **What:** Installation-wide maintenance needs the recovery engine without depending on an EE server runtime or active tenant discovery.
- **Where:** portableRestoreUploads, maintenanceJobFanout system jobs, PG Boss/Temporal registration and operator compatibility entries.
- **Gate:** A concrete scheduled caller exposed the wrong placement of an otherwise shared database/storage engine. ACT / bounded-now.
- **Status:** moved recovery and installation authority to the shared co-managed package, retaining EE compatibility exports; used the existing system-maintenance dispatch instead of a separate timer.


## portable-local-staging-lifecycle — pattern
- **What:** Four private-directory producers disposed normal completion but left no durable ownership or expiry evidence after process exit.
- **Where:** Archive sealing/extraction, native blob staging, remote meeting staging and installation archive capture.
- **Gate:** Four established identical filesystem lifecycles; sensitive crash remnants cannot be recovered by the remote provider-maintenance worker. ACT / bounded-now.
- **Status:** Extracted a private directory lease and bounded, resumable local sweeper. All four producers use it; application startup runs one process-local recovery timer. Prepared download admission checks the same lease expiry.


## storage-stream-length-and-replay — friction
- **What:** The upload interface discarded a source length already known by both streaming callers, while S3 retried non-replayable bodies together with receipt reads.
- **Where:** Portable restore staging, native uploadStream, StorageProvider options and S3 PUT/HEAD transport.
- **Gate:** Actual loopback execution failed in the installed SDK with an undefined decoded-content-length header; a consumed-body retry could overwrite previously uploaded bytes. ACT / bounded-now.
- **Status:** Added optional exact content_length, forwarded both known-length streaming callers, and split S3 replay policy by body type and receipt operation. Existing buffer callers remain compatible; live provider/multipart validation remains separate.


## portable-authored-reference-boundary — friction
- **What:** Native file and document IDs were remapped, but editor URLs still addressed source IDs; generic string replacement would also alter prose, code and external links.
- **Where:** Portable file preparation and declared document/comment/task/KB content columns.
- **Gate:** A concrete native restore showed usable copied bytes behind broken embedded references. Source document routes and editor formats are established. ACT / bounded-now.
- **Status:** Added explicit route mapping and editor-field traversal, plus parser-position replacement for Markdown/HTML. The file adapter supplies verified file/document mappings after allocation. Literal content and unknown external references remain outside rewriting authority.
