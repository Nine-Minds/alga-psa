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
