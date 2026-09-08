# Co-managed IT requirement audit: T08–T15

Reviewed 2026-09-08 against the approved opening requirements and behavioral table in `2026-09-06-co-managed-it-plan.md`; updated after the routing, billing, requester portal/email and task disclosure follow-ups. Evidence below combines source review with focused Node and isolated migrated-PG runs. No full build, complete suite, live provider send or browser journey is claimed.

The previously identified routing notification, billing-profile selection, actual invoice-generation, requester task portal/email and posted task attachment gaps are closed. Explicit task disclosure is committed in `a29642ce49`, with seven task PG journeys, five ticket regressions and 51 UI/action checks passing. Remaining release validation includes browser journeys and actual scheduler execution; it does not indicate a newly discovered implementation defect.

## T08 — Shared ticket lifecycle

**Implemented:** `packages/co-managed/src/ticketHandoffs.ts` atomically changes responsibility, retains an immutable operation receipt and shared handoff note, creates/reuses an MSP reference, and applies the SLA transition. It does not create an MSP ticket or change the customer board. `ticketQueue.ts` separates oversight from working placement. `ticketEditing.ts` uses the canonical ticket mutation/close path. `ticketBulkHandback.ts` executes qualified commands independently and returns per-item failures. The browser uses `CoManagedTicketPanel`, `CoManagedTicketEditor`, and `CoManagedTicketBulkHandback` in the MSP shell.

**Existing validation:** “atomically escalates one canonical ticket … reuses the original work identity on re-escalation”; “uses the canonical close and reopen paths with qualified audit, event and live attribution”; “bulk handback retains individual authorization and receipts …”; rollback, stale revision/session, revoked grant, and lifecycle cases surround these tests.

**Closure:** `ticketRoutingNotifications.ts` and the existing durable notification/channel recovery paths now retain canonical handoff, handback and assignment obligations in the command transaction. Current routing chooses the qualified assignee/team or configured board manager, with current authority/redaction and stable delivery dedupe. Committed in `71c15ba517`; 10 new PG cases, 22 combined routing/handoff/assignment PG cases, and 36 focused Node checks passed.

**Scope distinction:** The implemented bulk handback satisfies the stated per-item bulk authorization behavior. Arbitrary bulk field editing or bulk escalation was not separately required by the approved behavioral table.

## T09 — Content audiences

**Implemented:** `ticketConversation.ts`, `ticketCommentCreation.ts`, `ticketCommentMutation.ts`, and `privateTicketConversation.ts` combine customer canonical and MSP-private stores with qualified attribution and strict root/reply audiences. Ticket draft publication and explicit thread disclosure have their own commands. `conversationAttachments.ts` now accepts ticket and task parents and authorizes bytes through the actual comment/root and store. Task comments use `projectTaskConversation.ts` and `projectTaskAudience.ts`. Ticket portal readers/downloads, comment search/event consumers, customer/MSP notifications, email recovery, and portable export have audience-aware adapters. Task technician notifications/email/search are already implemented through `projectTaskEvents.ts`, `taskCommentNotification.ts`, and the conversation outbox consumers.

**Existing validation:** Conversation cases cover pagination across stores, legacy private notes, foreign names, redaction, hidden/deleted parents, exact retries, and disclosure. Attachment cases cover actual provider adapters, current grants, immutable retries, parent deletion and publication. Task cases include “task conversations preserve canonical ownership, separate private stores, and durable foreign authorship”, “task notifications keep customer-private content local”, “task email keeps private customer notes local”, and delayed search-event rejection. The new task attachment cases cover both private stores and retained MSP bytes.

**Closures:**

- Posted task attachments now support actual canonical and private task parents, current root/audience admission, qualified download, immutable retries, and retained MSP bytes through the shared attachment engine and task conversation UI.
- `requesterTaskConversation.ts` provides portal read/create/reply and inherited attachment download. `requesterTaskAccess.ts` shares current same-client/contact/project/show-tasks and portal-role admission with background delivery, while writes retain tracked-session authority. The portal milestone is `3dc122e90c`.
- `requesterTaskEmail.ts`, the existing requester delivery queue, event subscriber and email renderer provide durable task comment delivery to the project's portal contact and current thread participants. Every send rechecks current audience, root deletion and recipient access; retries retain identity. Task mail uses a portal link, without ticket reply tokens. The project view selects the linked task's phase once and opens its conversation inside the release UI boundary; committed in `c180b4dc14`. Twelve new email and nine portal PG behaviors passed, along with three existing ticket-mail PG regressions and the updated task replay case. Focused email/UI/download/deep-link checks passed 74/74.
- Explicit task disclosure now extends `threadDisclosure.ts`, private transfer/disclosure and the task UI with preview, confirmation, immutable operation receipts and metadata-only audience invalidations. Seven task and five ticket PG cases and 51 UI/action checks passed, including verified transferred-file download, integrity/path rejection, archive retention and session expiry after transport; committed in `a29642ce49`. Audience changes do not retroactively email historical comments, and pending creation delivery rechecks the current audience.

**Remaining:** Broader browser/provider journeys remain deferred validation; no requester task access/delivery or explicit task disclosure implementation gap remains in this audit.

**Scope distinction:** Pre-publication task attachment drafts are a useful composition implementation, not an independently enumerated release requirement. They must preserve audience/atomicity if included. Do not reopen already implemented task technician email/search/notifications as missing work.

## T10 — Canonical routing

**Implemented:** `ticketEditing.ts` resolves owner-tenant statuses/priorities and requires field baselines. `ticketHandoffs.ts` keeps local MSP queue placement in `co_managed_ticket_references`; `ticketAssignments.ts` and `sharedWorkAssignees.ts` qualify eligible MSP collaborators without exposing the full directory. `policy.ts` maintains explicit customer-to-MSP SLA priority mappings. Qualified routes and queue keys include customer tenant and relationship.

**Existing validation:** “rejects foreign status/priority choices, incomplete baselines and unsupported edit fields”; “keeps same-number same-UUID tickets from two customers separate”; “applies MSP client and queue policy projections … never compares customer board UUIDs as local boards”; assignment candidate policy and SLA mapping tests.

**Remaining:** No concrete owner-FK/routing identity defect found. Routing notifications are closed under T08. The approved destination is chosen during provisioning; changing it later, multiple destination choices, and extra queue filters are product enhancements unless added explicitly to scope. Snapshotting an existing SLA obligation is not a silent priority remap.

## T11 — Consolidated views

**Implemented:** `ticketQueue.ts` creates one authorized SQL union before search, sorting, pagination, counts, and export. It rechecks relationship/staff authority and applies home policy/redaction before result-derived metadata. `projectTaskQueue.ts` provides the corresponding task queue. `CoManagedTicketQueue.tsx` offers workspace/view/state/search/sort controls, counts, qualified navigation, and a complete filtered CSV via `coManagedTicketQueueActions.ts`. Dedicated ticket/project/task routes stay under `/msp/co-management/`; their actions preserve the original browser actor.

**Existing validation:** Mixed native/shared ordering/counts, same-number/UUID collisions, stale grants, session lock waits, redacted search/counts, independent task assignments, and UI stale-request handling have tests. Queue export uses the same relation without independently concatenated page reads.

**Remaining:** No concrete unmet behavior found for the stated T11 query contract. A browser journey across two customer workspaces remains required release validation. Richer dashboard widgets, automatic polling, assignment/queue/SLA filters, and Excel output are not required to establish the already implemented combined-view behavior.

## T12 — Project collaboration

**Implemented:** Explicit `co_management_project_scopes` gate actual project/phase/task membership. `projectTaskEditing.ts` edits the canonical task name, due date and phase-valid status with optimistic baselines and immutable audit attribution. `projectTaskAssignments.ts` maintains independent MSP user/team participation without replacing native customer assignment. `projectTaskQueue.ts` only places assigned shared work in working view. `CoManagedProjectTasks`, task editor/assignment/history/conversation, and effort/time controls provide routine collaboration without switching sessions.

**Existing validation:** “pages shared project tasks without copying assignments … loses access immediately on unsharing”; competing edit/assignment revisions; wrong-phase status rejection; shared/unassigned versus working task queues; qualified history pagination and revocation; customer native assignment remains intact.

**Remaining:** Core T12 sharing/assignment/work/revocation is present. Task conversation audience/requester follow-up closures are recorded under T09. MSP creation/restructuring of phases, dependencies, and every native task field is not asserted complete by this implementation; the behavioral requirement does not enumerate parity for each such operation.

## T13 — Time and billing

**Implemented:** Operational customer time uses the existing writer with service-free, non-invoiceable identity and optional timesheet lifecycle. MSP entries use `work_item_type='co_managed'` and an MSP-owned `co_managed_time_work_references` row. `timeWorkSource.ts` retains current source authorization for new work and local authority for existing effort. `packages/billing/src/lib/billing/timeEntryWorkContext.ts` joins only the MSP's retained evidence; `computeTimeBasedCharges.ts` stores qualified customer provenance in native invoice snapshots. Shared manual/API/timer saves use native contract selection, bucket/hour-block accounting, approval and deletion paths. `CoManagedTimeEntry.tsx` opens the existing time dialog.

**Existing validation:** Service-free customer saves and invoice-denial constraints; native save/API/timer source selection; contract-backed and catalog charges; explicit wrong-client contracts; bucket draws and reversals; approval/invoiced edits; source UUID collisions. “MSP time billing work reaches the existing catalog charge engine …” checks actual charge loading, then manually sets `invoiced=true` to check exclusion.

**Closure:** MSP-authorized billing-profile selection and the existing time-entry UI now use active home-client profiles, preserving qualified source/client ownership, commercial privacy, approved/invoiced immutability and native billing semantics. Committed in `3a286a5607`, with five focused migrated-PG cases passing.

**Actual invoice evidence:** `coManagedInvoiceJourneyCases.ts` invokes real native invoice creation for approved catalog and contract-backed shared effort alongside ordinary native work. Two migrated-PG journeys prove only MSP effort is invoiced, local client/profile/contract attribution, immutable qualified source receipts, concurrent creation and retry dedupe. The journey fixed narrow catalog loading, contract reconciliation and source-receipt defects in `f13f1d9b47`; 59 focused Node checks also passed. These cases do not simulate billing by setting `invoiced=true`. The contract journey uses advance timing and preserves the existing native arrears window behavior. No concrete T13 implementation gap remains in this audit; retention after customer deletion is tracked under T20.

## T14 — Effort totals

**Implemented:** `effortTotals.ts` sums completed native customer entries and independently owned MSP entries in one SQL snapshot. It follows actual task-to-project membership, includes performed effort irrespective of billing/approval, applies aggregate field restrictions, and returns no private notes, rates or approval details. `CoManagedEffort.tsx` and `CoManagedProjectEffortProvider.tsx` supply shared and native customer views. Revoked sharing stops MSP reads and removes ongoing MSP totals from customer results.

**Existing validation:** Completed customer/MSP totals; non-billable effort; actual save edits/deletes; private field redactions; ticket/task UUID collisions; project task moves; grant withdrawal; native task effort action identity; optional native timesheet lifecycle tests.

**Remaining:** No concrete missing aggregate behavior found. A browser check that saves refresh the visible totals remains release validation. Detailed cross-organization timesheets or inclusion of running timer estimates would widen the approved visibility/total definition.

## T15 — SLA independence

**Implemented:** `ticketSla.ts` starts an MSP-owned obligation only on escalation, resolves explicit MSP policy/priority/calendar, and composes handback/awaiting-client pauses. It preserves elapsed time/breaches on re-escalation, accepts actual qualified MSP requester/shared-IT contributions, and records canonical close/reopen transitions. `shared/lib/sla/organizationSlaClock.ts` retains a separate calendar/clock; customer ticket SLA fields remain native. Minute maintenance observation is registered through PG Boss handlers and Temporal `setupSchedules.ts`, both using `coManagedSlaObservationHandler`. Warning/breach receipts and email retries are durable. `CoManagedTicketSla.tsx` shows the two obligations separately.

**Existing validation:** `coManagedOrganizationSlaClock.test.ts` covers holiday/DST calendars, partial minutes, repeated pauses, qualifying authors/audiences, and breach persistence. PG cases cover mapped escalation, pre-escalation display, close/reopen rollback, simultaneous observers, threshold retries, requester portal/email, API/workflow/bundle writers, and independent awaiting-client behavior. Maintenance fanout and SLA transport have focused unit coverage.

**Remaining:** No concrete missing independent-clock transition found in the inspected paths. Actual end-to-end scheduler execution on both backends remains required evidence; source registrations and shared reducer tests alone do not prove deployment scheduling. Queue SLA columns/polling and policy-change reconciliation are not automatically release blockers: current detail display and retained obligation semantics already implement the approved independence contract.
