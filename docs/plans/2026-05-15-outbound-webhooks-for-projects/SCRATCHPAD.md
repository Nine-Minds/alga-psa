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
- 2026-05-15: Completed F003. Added canonical `PROJECT_TASK_UPDATED` schema
  with `projectTaskId` + `phaseId`, exported `ProjectTaskUpdatedEvent`, and
  emit it from `updateTaskWithChecklist` only when
  `buildProjectTaskWebhookChanges(...)` returns a non-empty diff. Extracted the
  diff builder to `packages/projects/src/lib/projectTaskWebhookChanges.ts` so
  date normalization and no-op behavior are unit tested without a DB/auth
  harness. Added a contract test proving the five out-of-scope task mutation
  entry points do not emit `PROJECT_TASK_UPDATED`. Verification:
  `cd server && npx vitest run ../packages/event-schemas/src/schemas/eventBusSchema.projectTaskUpdated.test.ts ../packages/projects/src/lib/projectTaskWebhookChanges.test.ts ../packages/projects/src/actions/projectTaskWebhookUpdated.contract.test.ts --coverage=false`
  (9/9) and
  `cd server && NODE_OPTIONS='--max-old-space-size=8192' npm run typecheck`.
- 2026-05-15: Completed F008. Interactive `createTag` / `deleteTag` now
  snapshots unique tag text sets before and after mutation and publishes
  entity update events only when the set changes. `project_task` resolves
  `{ projectId, phaseId }` and emits `PROJECT_TASK_UPDATED`; `ticket` emits
  `TICKET_UPDATED`; both carry `changes.tags`. Added
  `suppressEntityUpdateEvent` for `createTag` and use it from
  `createTagsForEntity` so initial tag application does not double-fire;
  `createTagsForEntityWithTransaction` remains bulk-only and never calls the
  entity update publisher. Added a ticket payload regression proving
  `TICKET_UPDATED` tag diffs reach `payload.changes`. Verification:
  `cd server && npx vitest run ../packages/tags/src/actions/tagActions.webhookEmission.contract.test.ts src/lib/eventBus/subscribers/webhook/__tests__/webhookTicketPayload.test.ts --coverage=false`
  (8/8) and
  `cd server && NODE_OPTIONS='--max-old-space-size=8192' npm run typecheck`.
- 2026-05-15: Completed F004. Added project and project-task public events to
  `SUPPORTED_WEBHOOK_EVENTS`, `webhookEventTypeSchema`, and the OpenAPI route
  event enum, preserving `project.completed` as the deprecated
  `project.closed` compatibility alias. Added `WEBHOOK_PROJECT_PAYLOAD_FIELDS`
  and the single `project` payload entity; `project_id` is excluded from the
  selectable list and retained via `ALWAYS_INCLUDED_KEYS_BY_ENTITY.project`.
  Task-only `tags` is present in the combined project field list, with no
  project-level tag field in the future project payload. Verification:
  `cd server && npx vitest run src/lib/webhooks/__tests__/payloadFields.test.ts src/lib/api/schemas/__tests__/webhookSchemas.test.ts src/lib/actions/__tests__/webhookActions.supportedEvents.test.ts --coverage=false`
  (7/7) and
  `cd server && NODE_OPTIONS='--max-old-space-size=8192' npm run typecheck`.
- 2026-05-15: Completed F005. Added `webhookProjectEventMap.ts` with internal
  to public project mappings, including `PROJECT_CLOSED` -> both
  `project.closed` and deprecated `project.completed`. Added
  `webhookProjectPayload.ts` for project and task payload builders, 60s/256
  LRU caches, `project_task` tag resolution for task payloads, status-change
  previous status enrichment, update `changes`, and uncached `phases` /
  `task_counts` helpers. Task URL is implemented as
  `/msp/projects/:projectId?taskId=:taskId`; no existing route reference was
  found in source search, matching the PRD's accepted shape. Verification:
  `cd server && npx vitest run src/lib/eventBus/subscribers/webhook/__tests__/webhookProjectEventMap.test.ts src/lib/eventBus/subscribers/webhook/__tests__/webhookProjectPayload.test.ts --coverage=false`
  (7/7) and
  `cd server && NODE_OPTIONS='--max-old-space-size=8192' npm run typecheck`.
- 2026-05-15: Completed F006. Added live
  `projectWebhookSubscriber.ts`, registered it from subscriber index, and
  widened `WebhookDeliveryQueue` typing from ticket-only to generic webhook
  event/payload because the queue was already runtime entity-agnostic.
  Project events filter on `projectId`; task events filter on
  `projectTaskId`/`taskId` and project allowlist projection passes
  `extraAlwaysIncluded:['task_id']`. Project `phases` and `task_counts`
  opt-ins are fetched lazily once per event and reused for all matching
  subscribers. Verification:
  `cd server && npx vitest run src/lib/eventBus/subscribers/__tests__/projectWebhookSubscriber.test.ts src/lib/eventBus/subscribers/__tests__/subscriberIndex.projectWebhook.test.ts src/test/integration/webhookDelivery.entityIdFilter.test.ts src/test/integration/webhookDelivery.tenantIsolation.test.ts --coverage=false`
  (6/6) and
  `cd server && NODE_OPTIONS='--max-old-space-size=8192' npm run typecheck`.
- 2026-05-15: Completed F007. Added
  `webhookDelivery.projectWebhooks.test.ts` covering project.created projection
  with `phases`, project.task.updated tag-only delivery with `task_id`
  retained, and ticket.updated tag-only parity. The "integration" style matches
  the existing webhook delivery integration tests in this repo: subscriber
  registration, event dispatch, mocked model/payload builders, and queue job
  assertions rather than a live HTTP server/DB row. Verification:
  `cd server && npx vitest run src/test/integration/webhookDelivery.projectWebhooks.test.ts src/test/integration/webhookDelivery.entityIdFilter.test.ts src/test/integration/webhookDelivery.tenantIsolation.test.ts src/lib/eventBus/subscribers/webhook/__tests__/webhookProjectEventMap.test.ts src/lib/eventBus/subscribers/webhook/__tests__/webhookProjectPayload.test.ts src/lib/eventBus/subscribers/__tests__/projectWebhookSubscriber.test.ts src/lib/eventBus/subscribers/__tests__/subscriberIndex.projectWebhook.test.ts src/lib/webhooks/__tests__/payloadFields.test.ts --coverage=false`
  (20/20) and
  `cd server && NODE_OPTIONS='--max-old-space-size=8192' npm run typecheck`.
