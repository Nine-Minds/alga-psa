# PRD: Outbound Webhooks for Projects

- **Status:** Draft (loop-ready)
- **Owner:** Natallia Bukhtsik
- **Created:** 2026-05-15
- **Source draft:** `.ai/webhook-entity-metadata-registry-plan.md`
- **Branch:** `webhooks_expansion`

## 1. Problem statement & user value

Alga PSA delivers outbound webhooks for tickets but not for projects, even
though internal `PROJECT_*` / `PROJECT_TASK_*` events already fire on the event
bus. MSP integrators cannot react programmatically to project lifecycle changes
(creation, status, assignment, closure) or project-task changes. The outbound
webhook infrastructure (DB tables, vault-stored signing secrets, Redis-backed
`WebhookDeliveryQueue`, HMAC signing, retry, the `AdminWebhooksSetup` UI,
per-subscriber field allowlists) is **already entity-agnostic** — only the
ticket-specific glue is hardwired. This effort adds the project-specific glue so
subscribers can register project webhooks with the same field-allowlist control
they have for tickets.

## 2. Goals

- Deliver outbound webhooks for 5 project-level events and 5 project-task
  events through the existing queue/signing/retry pipeline.
- Per-subscriber field allowlist support for the new `project` entity, reusing
  the Phase 0 single-source `payloadFields.ts` registry and the existing
  projection helper.
- Opt-in sub-entity payload sections (`phases`, `task_counts`) mirroring the
  proven ticket `comments` batched-fetch pattern.
- Backward-compatible public webhook event enum (no breakage for existing
  `webhook_subscriptions` rows referencing `project.completed`).

## 3. Non-goals

- No webhook queue, schema, signing, or UI redesign (infra is reused as-is).
- No new operational tooling (monitoring/metrics/dashboards) — out of scope.
- No project-level tags in the payload (the tag system has no `project`
  tagged_type — see §7).
- `PROJECT_TASK_UPDATED` covers form-edit field changes and interactive tag
  changes only; status/phase-move/reorder/dependency mutations are explicitly
  out of scope (see §7).
- No generic `dispatchEntityWebhooks` abstraction yet (deferred follow-up).

## 4. Personas & primary flows

- **MSP integrator / admin:** In Settings → Security → Webhooks, registers a
  webhook for e.g. `project.created` + `project.status_changed`, selects a
  subset of payload fields (optionally `phases`), and receives signed HTTP
  deliveries when projects change.
- **External receiving system:** Gets the same envelope/signature contract as
  ticket webhooks; payload is projected to the subscriber's allowlist with
  `project_id` (and `task_id` for task events) always retained.

## 5. Scope: events

**Project-level** (entity `project`): `project.created`, `project.updated`,
`project.status_changed`, `project.assigned`, `project.closed`.

**Project-task** (entity `project`, routed via single-entity decision §6):
`project.task.created`, `project.task.updated`, `project.task.status_changed`,
`project.task.assigned`, `project.task.completed`.

Internal sources (verified present):
- `projectActions.ts` already emits `PROJECT_CREATED`, `PROJECT_UPDATED`,
  `PROJECT_STATUS_CHANGED`, `PROJECT_ASSIGNED`, `PROJECT_CLOSED`.
- `projectTaskActions.ts` already emits `PROJECT_TASK_CREATED`,
  `PROJECT_TASK_STATUS_CHANGED`, `PROJECT_TASK_ASSIGNED`,
  `PROJECT_TASK_COMPLETED`. `PROJECT_TASK_UPDATED` does **not** exist and is
  added by this work.

**Tag-driven updates (in scope — projects + tickets, parity).** Adding/removing
a tag on a project task or a ticket currently fires no per-entity event (tag
actions emit only `TAG_DEFINITION_UPDATED`), so it produces no webhook today.
This work adds emission of `PROJECT_TASK_UPDATED` / `TICKET_UPDATED` (with
`changes: { tags: {...} }`) from the interactive tag mutation path. These
surface as the existing `project.task.updated` / `ticket.updated` deliveries —
no new public event types. The ticket side is included for parity (same gap
exists for tickets today).

## 6. Resolved design decisions

1. **Single `project` allowlist entity** (user-confirmed 2026-05-15). Both
   project-level and task-level events route to entity `project`;
   `webhookEntityForEventType()` is unchanged (first-dot slice). Trade-off
   accepted: the field picker for a `project.created` webhook will list
   task-only fields (`task_name`, `phase_id`, …) the event never carries.
   Task events require `applyPayloadAllowlist('project', payload, allowlist,
   extraAlwaysIncluded:['task_id'])` so `task_id` survives projection.
2. **Helper rename:** `projectWebhookPayload` → `applyPayloadAllowlist` (verb
   collides with the new `project` noun domain). Done as an isolated mechanical
   refactor before project code is added.
3. **`project.completed` is a deprecated accepted alias** of `project.closed`
   (and `project.task.completed` retained likewise). The public enum keeps
   them; the event map resolves them to closed/completed semantics. Existing
   `webhook_subscriptions` rows are checked, not broken.
4. **Tag changes trigger webhooks for project tasks AND tickets**
   (user-confirmed 2026-05-15). Emit `PROJECT_TASK_UPDATED` / `TICKET_UPDATED`
   with `changes.tags` from the interactive tag path only. No new public event
   types — reuses `*.updated`. Ticket parity is explicitly in scope.

## 7. Constraints & corrected facts (must hold)

- **Phase 0 is already implemented** (single-source `payloadFields.ts`
  consolidation) and its tests pass. It is a *precondition*, verification-only,
  not buildable work. It should land as its own commit before Phase 1.
- **Tag system:** `shared/models/tagModel.ts` `tagged_type` enum is
  `['client','contact','project_task','document','knowledge_base_article']`.
  → `ProjectWebhookPayload` ships **without** `tags`.
  → `ProjectTaskWebhookPayload` uses `TagMapping.getByEntity(..., 'project_task')`.
- **`PROJECT_TASK_UPDATED` emit scope:** emitted from
  `updateTaskWithChecklist` (form field edits) **and** the interactive tag
  mutation path for `project_task` (F008, `changes.tags`). The other five
  task-mutation entry points (`updateTaskStatus`, `moveTaskToPhase`,
  `reorderTask`, `reorderTasksInStatus`, `updateTaskDependency`) intentionally
  do **not** emit it; they have dedicated events or no webhook-relevant delta.
- **Tag emission must not double-fire (F008).** `createTagsForEntity` runs at
  entity-creation time (`TaskForm.tsx:910`, immediately after
  `PROJECT_TASK_CREATED`). Tag-change emission is scoped to *interactive*
  single-entity mutations (`createTag` :101, `deleteTag` :335, `TagManager`
  onChange) only — never the bulk `createTagsForEntity` :534 /
  `createTagsForEntityWithTransaction` :571. No-op tag writes emit nothing.
- **Ticket parity (F008):** the ticket webhook builder already attaches
  `changes` on `TICKET_UPDATED` (`webhookTicketPayload.ts:143`), so the ticket
  side needs no builder change — only the event emission from `tagActions.ts`.
- **Strict type:** keep `ALWAYS_INCLUDED_KEYS_BY_ENTITY` typed
  `as const satisfies Record<WebhookPayloadEntity, readonly string[]>` — do not
  loosen to `Record<string, …>`.
- The projection helper now lives in `server/src/lib/webhooks/payloadFields.ts`
  (Phase 0 moved it out of `webhookTicketPayload.ts`).

## 8. Data / API integration notes

- New internal event `PROJECT_TASK_UPDATED` in
  `packages/event-schemas/src/schemas/eventBusSchema.ts`: payload
  `{ tenantId, projectId, projectTaskId, phaseId, userId?, occurredAt?,
  changes?: Record<string,{previous,new}> }`; add to event-type enum,
  `EventSchemas` map, inferred type export.
- `ProjectWebhookPayload` (no `tags`): `project_id` (always), `project_name`,
  `wbs_code`, `description`, `status_id`, `status_name`, `is_closed`,
  `previous_status_id?`, `previous_status_name?`, `client_id`, `client_name`,
  `contact_name_id`, `contact_name`, `contact_email`, `assigned_to`,
  `assigned_to_name`, `start_date`, `end_date`, `budgeted_hours`,
  `url=${NEXTAUTH_URL}/msp/projects/${project_id}`, `changes?`, `phases?`,
  `task_counts?`.
- `ProjectTaskWebhookPayload`: project context (`project_id`, `project_name`,
  `client_id`, `client_name`) + `task_id`, `phase_id`, `phase_name`,
  `task_name`, `description`, `status_id`, `status_name`, `is_closed`,
  `previous_status_id?`, `previous_status_name?`, `assigned_to`,
  `assigned_to_name`, `estimated_hours`, `actual_hours`, `due_date`,
  `priority_id`, `priority_name`, `wbs_code`,
  `url=${NEXTAUTH_URL}/msp/projects/${project_id}?taskId=${task_id}` (verify
  route), `tags` (via `project_task`), `changes?`.
- Public OpenAPI schema auto-extends from `WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY`
  (Phase 0 generates the per-entity enum from this map — no manual doc edits).

## 9. Risks, rollout, open questions

- **Rollout:** additive; project webhooks go live only when
  `projectWebhookSubscriber` is registered in `subscribers/index.ts`
  (last feature). Public enum aliasing prevents subscription-row breakage.
- **Risk:** task-payload `url` route shape unverified — confirm
  `/msp/projects/:id?taskId=:taskId` against the app router before shipping.
- **Open question (non-blocking):** product may later want project-level tags;
  requires a tag-system change, tracked as a follow-up, not this plan.
- **Follow-up (deferred):** extract `dispatchEntityWebhooks(entity, event,
  builder)` once ticket + project subscribers both exist (~80% shared body).

## 10. Acceptance criteria / definition of done

- All 10 project/task public events are registrable in the Webhooks UI and the
  public API enum, with `project.completed` / `project.task.completed`
  accepted as deprecated aliases (no existing-subscription breakage).
- Creating/updating/closing a project and creating/updating/completing a task
  produces a signed HTTP delivery and a `webhook_deliveries` row, payload
  correctly projected to the subscriber allowlist with `project_id`
  (and `task_id` for task events) always present.
- `phases` / `task_counts` populate only when in the allowlist or full payload,
  fetched once per event regardless of subscriber count.
- No project-level `tags`; task `tags` resolve via `project_task`.
- `applyPayloadAllowlist` rename complete, all callers/tests green.
- Adding/removing a tag on a project task delivers `project.task.updated`
  with a `changes.tags` diff; on a ticket delivers `ticket.updated` likewise;
  creating an entity with initial tags does not double-fire; no-op tag writes
  emit nothing.
- Full webhook unit + integration suite green; workspace type-check clean.

## 11. Loop execution notes

- 8 coarse features; each is one self-contained commit. Execution order is
  array order in `features.json`:
  `F001 → F002 → F003 → F008 → F004 → F005 → F006 → F007`
  (IDs are stable, not sequential — `F008` runs 4th, right after the
  `PROJECT_TASK_UPDATED` event it depends on exists).
- `F001` is the already-done Phase 0 precondition (`implemented: true`,
  verification + standalone commit only — the loop must not rebuild it).
- Ordering is dependency-safe: rename → event → tag-emission → registration →
  builders → subscriber → tests. Pure-new-code features (`F005`) have no
  callers until `F006` registers the subscriber.
- Per-repo policy, commits/pushes happen only on explicit user request even
  inside the loop.
