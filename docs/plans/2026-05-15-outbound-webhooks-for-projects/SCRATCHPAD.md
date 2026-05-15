# SCRATCHPAD — Outbound Webhooks for Projects

## Decisions (with rationale)

- **2026-05-15 — Single `project` allowlist entity** (user-confirmed via
  AskUserQuestion). Both project- and task-level events route to `project`;
  `webhookEntityForEventType()` unchanged. Accepted cost: field picker for
  `project.created` lists task-only fields. Mitigation: task events pass
  `extraAlwaysIncluded:['task_id']` to the projection helper so `task_id`
  survives even when not selected.
- **2026-05-15 — Rename `projectWebhookPayload` → `applyPayloadAllowlist`.**
  The verb "project" (to project/filter) collides with the new `project`
  entity noun; `projectWebhookPayload('project', …)` is unreadable. Cheap now —
  Phase 0 already moved the function to `payloadFields.ts`.
- **2026-05-15 — Keep `project.completed` / `project.task.completed` as
  deprecated accepted aliases**, not removed. The public enum gates
  subscription create/update validation; removal would break stored
  `webhook_subscriptions` rows and the OpenAPI contract even though project
  webhooks never delivered before.
- **2026-05-15 — `PROJECT_TASK_UPDATED` emitted from
  `updateTaskWithChecklist` AND the interactive tag path (F008).** The other
  five task write paths (status/phase-move/reorder/reorder-in-status/
  dependency) still have dedicated events or no webhook-relevant delta.
- **2026-05-15 — Tag changes trigger webhooks for project_task AND ticket
  (F008), parity** (user-confirmed; largest of the three options). Emit
  `PROJECT_TASK_UPDATED` / `TICKET_UPDATED` with `changes.tags` from the
  interactive tag path. No new public events — reuses `*.updated`. Rationale:
  the no-trigger gap is identical for tickets today; fixing only projects
  would leave the product inconsistent.

## Discoveries (grounded against codebase)

- Phase 0 ALREADY IMPLEMENTED as unstaged changes; tests pass
  (`payloadFields.test.ts` 2/2; `webhookDelivery.*` 3/3). It consolidated MORE
  than the original draft: `payloadFields.ts` also owns
  `payloadFieldsByEntitySchema`, `webhookEntityForEventType`, and the
  projection helper (moved out of `webhookTicketPayload.ts`; deprecated
  `projectTicketWebhookPayload` shim deleted). Treat as precondition only.
- `ALWAYS_INCLUDED_KEYS_BY_ENTITY` shipped as
  `... as const satisfies Record<WebhookPayloadEntity, readonly string[]>`
  (strict). Keep it — compiler forces the `project` key when registry grows.
- Tag system (`shared/models/tagModel.ts`): `tagged_type` enum =
  `['client','contact','project_task','document','knowledge_base_article']`.
  → NO `project` type. Project payload ships without `tags`. Task payload tags
  via `'project_task'`. (Original draft had this inverted.)
- `projectActions.ts` emits: PROJECT_CREATED :986, PROJECT_ASSIGNED :1052,
  PROJECT_STATUS_CHANGED :1089, PROJECT_UPDATED :1101, PROJECT_CLOSED :1532.
- Task mutation entry points in `packages/projects/src/actions/projectTaskActions.ts`:
  `updateTaskWithChecklist` :505 (← emit PROJECT_TASK_UPDATED here only),
  `updateTaskStatus` :688, `moveTaskToPhase` :1559, `reorderTask` :2102,
  `reorderTasksInStatus` :2178, `updateTaskDependency` :2478.
- Current public enum (`webhookSchemas.ts:40-45`): project.created,
  project.updated, project.completed, project.task.created,
  project.task.updated, project.task.completed. Missing:
  project.status_changed, project.assigned, project.closed,
  project.task.status_changed, project.task.assigned.
- OpenAPI route now derives the per-entity payload schema from
  `WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY` → adding `project` auto-extends docs.
- F008 grounding: `packages/tags/src/actions/tagActions.ts` emits only
  `TAG_DEFINITION_UPDATED` (lines 283, 831 — rename/recolor, not per-entity).
  Entry points: `createTag` :101, `deleteTag` :335 (interactive single),
  `createTagsForEntity` :534 + `createTagsForEntityWithTransaction` :571
  (bulk, creation-time), `deleteAllTagsByText` :923 (bulk by text).
- `TICKET_UPDATED` internal event exists (eventBusSchema.ts:160, schema :785);
  ticket webhook builder already attaches `changes` when
  `eventType === 'TICKET_UPDATED'` (webhookTicketPayload.ts:143-144) via
  `normalizeChanges` (:369). → ticket side of F008 needs ZERO builder change,
  only event emission. F005 must mirror this `changes` attach for
  `PROJECT_TASK_UPDATED`.
- ⚠️ DOUBLE-FIRE GOTCHA (F008): `TaskForm.tsx:910` calls
  `createTagsForEntity(taskId,'project_task',pendingTags)` right after the
  task is created (PROJECT_TASK_CREATED already fired). Emitting from the bulk
  create path would double-fire CREATED + spurious UPDATED on every
  create-with-tags. → emit only from interactive single-tag mutations, never
  the bulk creation-time path. Same caution for ticket create-with-tags.

## Open questions / to verify during impl

- Task webhook `url` route shape: confirm `/msp/projects/:id?taskId=:taskId`
  against the Next.js app router before shipping F005.
- Confirm an existing `normalizeChanges`-style helper in the project actions to
  reuse for `changes` (do not roll a new diff util).

## Loop runbook

- Feature order (array order in features.json) =
  F001(verify/commit precondition) → F002 → F003 → F008 → F004 → F005 →
  F006 → F007. Each feature = one commit. F008 runs 4th (needs F003's
  PROJECT_TASK_UPDATED; ticket side uses existing TICKET_UPDATED).
- Per-feature gate before flipping `implemented:true`:
  - `cd server && npx vitest run <relevant specs> --coverage=false`
  - workspace type-check.
- Useful commands:
  - `cd /Users/natalliabukhtsik/Desktop/Desktop/projects/alga-psa/server && npx vitest run src/lib/webhooks/__tests__/payloadFields.test.ts --coverage=false`
  - `... npx vitest run src/test/integration/webhookDelivery.entityIdFilter.test.ts src/test/integration/webhookDelivery.tenantIsolation.test.ts --coverage=false`
- ⚠️ Repo policy: do NOT stage/commit/push without explicit user request,
  even inside the loop. The loop implements + verifies; the user commits.

## Status log

- 2026-05-15: Plan created (PRD + 7 features + 25 tests). Phase 0 done
  (F001 implemented:true, uncommitted). Phase 1 not started.
- 2026-05-15: Added F008 (tag-change webhooks, projects + tickets parity) per
  user decision → 8 features + 30 tests. Runs 4th in execution order.
- 2026-05-15: Completed F002. Renamed `projectWebhookPayload` to
  `applyPayloadAllowlist` in `payloadFields.ts`, updated the ticket webhook
  subscriber and payload-field tests, and added the optional
  `extraAlwaysIncluded` parameter for future task payload projection.
  Verification:
  `cd server && npx vitest run src/lib/webhooks/__tests__/payloadFields.test.ts --coverage=false`
  (4/4) and
  `cd server && npx vitest run src/test/integration/webhookDelivery.entityIdFilter.test.ts src/test/integration/webhookDelivery.tenantIsolation.test.ts --coverage=false`
  (3/3). Source search with coverage excluded has no remaining
  `projectWebhookPayload` references. `npm run typecheck` OOMed under the
  default Node heap; `NODE_OPTIONS='--max-old-space-size=8192' npm run typecheck`
  passed and also satisfies T003.
