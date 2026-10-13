# Ticket API: historical `entered_at` / comment `created_at` for imports — implementation plan

**Card:** Ticket API: allow setting entered_at (and comment created_at) for history imports (PSA `alga-2026-0002678`, client Foreground / Stan Blosser)
**Branch:** `feature/ticket-api-allow-setting-entered-at-and-comment`
**Date:** 2026-10-12
**Grounded in:** `main` at `d6dc22c273`. Every file:line reference below was checked against that commit. The card cites `229a24f2ad`; line numbers have drifted slightly since then, but the behavior it describes is unchanged.

---

## 1. Current state

### 1.1 Ticket create (POST /api/v1/tickets)

- `server/src/app/api/v1/tickets/route.ts` routes to `ApiTicketController.create()`. The controller does not override it, so the request goes through the generic `ApiBaseController.create()` (`server/src/lib/api/controllers/ApiBaseController.ts:326-358`):
  1. authenticate
  2. `checkPermission('ticket','create')`
  3. `validateData(createTicketSchema)`
  4. `TicketService.create`
- `createTicketSchema` (`server/src/lib/api/schemas/ticket.ts:117`) is a non-strict `z.object` with no `entered_at`, so a supplied value is silently stripped. `updateTicketSchema` (`:146`) is derived from it, so PUT can't set the date either.
- `TicketService.createTicket` (`server/src/lib/api/services/TicketService.ts:1711-1840`):
  - maps the request to `CreateTicketInput` (`:1729-1752`) and calls `TicketModel.createTicketWithRetry` with `ticketCreatedPublishedByCaller(...)` (`:1755-1763`)
  - writes a `CREATED` activity row with no `occurredAt`, so it is stamped now (`:1793-1815`)
  - publishes `TICKET_CREATED` after commit through `buildApiTicketCreatedPayload`, with `createdAt = entered_at` (`:1823-1833`)
- `TicketModel.createTicket` (`shared/models/ticketModel.ts:889`):
  - sets `entered_at = updated_at = new Date()` in the generated base row (`:946`, `:973-981`), and the returned output also uses now (`:1104`)
  - `entered_at` deliberately has no input key (`:420-426`). `CREATE_TICKET_FIELD_HANDLING` (`:494-540`) is exhaustive (`-?`), and `closed_at`, `closed_by` and `is_closed` are `excluded` with the reason "tickets are created open".
  - The DB column `tickets.entered_at` has no default (`server/migrations/202409071803_initial_schema.cjs:264`).

### 1.2 Comment create (POST /api/v1/tickets/{id}/comments)

- `ApiTicketController.addComment` (`ApiTicketController.ts:1511-1590`): API-key auth, `assertInternalApiUser`, `hasPermission(user,'ticket','update')` (`:1557`), then `createTicketCommentSchema.parse` (`:1566`).
- `TicketService.addComment` (`TicketService.ts:2501-2760`) stamps one `apiNowIso` (`:2520`) onto:
  - the comment's `created_at` / `updated_at`
  - `comment_threads.created_at` / `last_activity_at` for a new thread (`:2582-2593`)
  - the reply thread's `last_activity_at` (`:2678-2684`)

  It also:
  - runs `applyCommentResponseState` (`:2684`), which may queue `TICKET_RESPONSE_STATE_CHANGED`
  - calls `maybeReopenBundleMasterFromChildReply`
  - bumps `tickets.updated_at = now()`
  - persists a `TICKET_COMMENT_ADDED` publication, or schedules the comment for later publication (`:2724-2745`)
- `comments.created_at` defaults to `now()`; the table has no triggers. The API read (`:2400`), the model (`packages/tickets/src/models/comment.ts:38`) and the UI (`TicketConversation.tsx:646,673` → `CommentThreadList`) all order by `created_at`, so a backdated value sorts correctly with no read-side change.

### 1.3 What a backdated ticket would trigger downstream if `TICKET_CREATED` were published

| Consumer | Effect with a past `entered_at` |
|---|---|
| `slaSubscriber` (`server/src/lib/eventBus/subscribers/slaSubscriber.ts:148-251`) → `startSlaForTicket(createdAt = entered_at)` (`packages/sla/src/services/slaService.ts:98-265`) | Due dates land in the past. The CE poller (`server/src/lib/jobs/handlers/slaTimerHandler.ts:109-207`) marks the ticket breached on its next run and publishes threshold and breach notifications. On EE, the Temporal workflow uses its own `new Date()` (`ee/temporal-workflows/src/workflows/sla-ticket-workflow.ts:152`), so its timers disagree with the DB due dates. |
| `ticketEmailSubscriber`, `internalNotificationSubscriber` | Send "new ticket" email and in-app notices. They honor the suppression flags, but `buildApiTicketCreatedPayload` (`shared/lib/tickets/ticketWorkflowEventPayloads.ts:103-137`) carries none. |
| `webhookSubscriber`, Workflow Runtime V2 stream worker | Always deliver or trigger. No suppression or import flag is checked. |
| `searchIndexSubscriber` | Indexes the ticket (only when `SEARCH_INDEX_LIVE=true`). The `search:reconcile` job (`packages/jobs/src/lib/handlers/searchReconcileHandler.ts`) backfills missed docs. |

No consumer checks an "import" source or origin. Suppression flags only cover email and in-app notices, not SLA, webhooks or workflows. **The only mechanism in the codebase that keeps all of these quiet is not publishing at all:** `silentTicketCreation(reason)` (`shared/lib/tickets/ticketLifecycleEvents.ts:237-315`, documented as "only for bulk historical data"). The in-app CSV import uses it.

Comments behave the same way. `TICKET_COMMENT_ADDED` drives email and in-app notices, webhooks, workflows and SLA first response. `TICKET_RESPONSE_STATE_CHANGED` drives SLA pause and resume plus a webhook.

### 1.4 Precedent: the in-app CSV import (`packages/tickets/src/actions/ticketImportActions.ts`)

- Requires `ticket:create` (`:443`). It has no special permission for backdating.
- Calls `TicketModel.createTicket(..., silentTicketCreation('bulk import of existing tickets'))` (`:789-793`) with `source: 'csv_import'`. As a result:
  - no `TICKET_CREATED`
  - no SLA
  - no notifications, webhooks or workflows
- Then fixes `entered_at` with a raw batch `UPDATE` (`:803-805`, `:882-900`) and `closed_at` / `closed_by` the same way (`:795-802`, `:903-922`).
- Writes a `CLOSE_RULES_BYPASSED` activity row for closed imports on gated boards (`:927-947`).
- Imports no comments.

### 1.5 The card's "closed_at is settable" claim is only half true

`updateTicketStatusSchema` accepts `closed_at` (`schemas/ticket.ts:163-173`). However, `TicketService.update` overwrites it with `new Date()` and `context.userId` whenever the status crosses from open to closed (`TicketService.ts:2033-2043`). That crossing is exactly the case an importer hits. The status endpoint also:
- publishes `TICKET_CLOSED`, which reaches webhooks and workflows
- enforces board close rules

So today, closed history can't be backdated through the API either.

---

## 2. Design decisions

**D1. Supplying `entered_at` means "this ticket is a historical record", and historical creation is silent.**
- No separate flag: a client-supplied open date has no coherent "live" meaning. SLA would start in the past (instant CE breach, EE timer mismatch), and a "new ticket" notification for something that opened months ago is wrong.
- A ticket created with `entered_at` uses `silentTicketCreation`, exactly like the CSV import. As a result it gets:
  - no `TICKET_CREATED`
  - no SLA policy or clock (`sla_policy_id` stays null; the CE poller and the `TICKET_UPDATED` SLA handlers no-op without a policy, `slaService.ts:602`)
  - no email, in-app, webhook or workflow fan-out
- Search catches up through `search:reconcile`.
- The ticket is marked `source: 'api_import'`; `ticket_origin` stays `api`. Imported rows are then identifiable for reports and cleanup, the same way `csv_import` is.

**D2. A historical ticket can be created directly in its final closed state.**
- The schema accepts optional `closed_at` (and an optional `closed_by` user), but only alongside `entered_at`.
- If `status_id` is a closed status, `closed_at` is required, and the row is written with `is_closed = true`, `closed_at` and `closed_by` (default: the API user).
- If the status is open, supplying `closed_at` returns a 400.
- Because the ticket is created silently and already closed, no `TICKET_CLOSED` is ever published, so no survey, webhook, workflow or close-rule run fires.
- On gated boards, a `CLOSE_RULES_BYPASSED` activity row with `bypass_source: 'api_import'` is recorded, matching the CSV import.
- Without D2, an importer would have to close tickets through the status endpoint, which fires `TICKET_CLOSED` side effects; D4 only fixes the date on that path.

**D3. Supplying `created_at` on a comment means "historical comment", and it is also silent.** The comment and its thread keep the given timestamps. In addition:
- No `TICKET_COMMENT_ADDED` publication: no notices, webhooks, workflows or SLA first response.
- No `applyCommentResponseState` and no `maybeReopenBundleMasterFromChildReply` (a historical reply must not reopen a closed bundle master).
- `created_at` cannot be combined with `scheduled_publish_at` / `scheduled_publish_tz` or `cc` / `bcc` (all of these imply future or live delivery). Combining them returns a 400.
- `tickets.updated_at` is still bumped to now, because the row really was modified now.

**D4. Fix the `closed_at` override on the status endpoint (§1.5).**
- On an open→closed crossing, a caller-supplied `closed_at` / `closed_by` wins over the derived now / caller.
- Validation: `closed_at` must not be in the future and must not be before `entered_at` (400 otherwise).
- This path is live, not historical, so events still fire. The caller can pass the existing `suppressContactNotifications` / `suppressInternalNotifications` flags.
- The override applies only to the status endpoint (`PUT /tickets/{id}/status`), via an explicit `honorSuppliedClosure` opt-in on `TicketService.update`. Generic `TicketService.update` (and generic PUT) keeps deriving `closed_at = now` / `closed_by = context.userId` on a close crossing (contract T048). This scoping was a deliberate decision.

**D5. Validation rules.** All checks return 400 `ValidationError` with a field path.

| Field | Rule |
|---|---|
| `entered_at` | `z.string().datetime({ offset: true })`; must not be after the server's now |
| `closed_at` | Same format; `entered_at ≤ closed_at ≤ now` |
| Comment `created_at` | Same format; `ticket.entered_at ≤ created_at ≤ now` (a comment cannot predate its ticket) |
| Reply `created_at` | Must not predate its parent comment |

The format and future checks belong in the zod schemas. The cross-row checks (against ticket `entered_at` and the parent comment) belong in the service.

**D6. Permission: no new permission.**
- Backdating is gated by the permission the endpoint already requires (`ticket:create` for tickets, `ticket:update` for comments) and by the caller being an internal (MSP) user. The comment path already asserts an internal user; ticket create gains the check, returning 403 for a client-portal user that supplies `entered_at`.
- This matches the in-app CSV import, which lets any `ticket:create` holder backdate today. A dedicated permission on the API alone would gate one door and leave the other open.
- If a dedicated permission is wanted, it should cover both doors. See the open question in §6.

**D7. Create-only.** `entered_at` and `closed_at` are omitted from `updateTicketSchema`, the same way `external_links` already is (`schemas/ticket.ts:146-151`). Correcting dates on already-created tickets is not in scope; tickets that need it can be deleted and reimported.

**D8. Layering: the model owns historical creation, not the service or the CSV action.**
- `CreateTicketInput` gains one explicit key:

  ```ts
  historical?: { entered_at: string; closed_at?: string | null; closed_by?: string | null }
  ```

- Its `CREATE_TICKET_FIELD_HANDLING` entry is `resolve`. It derives `is_closed`, `closed_at` and `closed_by`, which are added to `INPUT_DRIVEN_TICKET_COLUMNS`. `createTicket` takes the base row's `entered_at` (and the returned `entered_at`) from `historical.entered_at`.
- The existing `closed_at` / `closed_by` / `is_closed` keys stay `excluded`, so no current caller changes behavior.
- The model enforces the invariants (closed status ⇔ `closed_at` present, ordering, not in the future) and, when `historical` is set, refuses any event publisher other than `silentTicketCreation`. The silence guarantee therefore lives in the lowest layer.
- The CSV import then passes `historical` instead of running its two raw post-insert UPDATE batches. This removes the second copy of "backdate after insert" (see §3, step 8).

---

## 3. Implementation steps

1. **Model**: `shared/models/ticketModel.ts`
   - Add `historical` to `CreateTicketInput` (`:150`), with a doc comment. Extend `INPUT_DRIVEN_TICKET_COLUMNS` with `is_closed`, `closed_at` and `closed_by`, and add the `historical` resolve entry to `CREATE_TICKET_FIELD_HANDLING`. Update the generated-columns comment at `:420-426`.
   - In `createTicket`, compute `enteredAt = historical?.entered_at ?? now`; use it for the base row and the returned output. Keep `updated_at = now`.
   - Validate the D5 ordering and future rules plus the closed-status invariant. Resolve the status's `is_closed` from `statuses`, inside the existing business-rule validation.
   - Throw if `historical` is set and `eventPublisher` is not `kind: 'silent'`.
   - `createTicketWithRetry` passes `historical` through unchanged.

2. **Schemas**: `server/src/lib/api/schemas/ticket.ts`
   - `createTicketSchema`: add `entered_at`, `closed_at` and `closed_by` (uuid) as optional fields. Add a `superRefine`: dates not in the future; `closed_at` / `closed_by` require `entered_at`; `closed_at ≥ entered_at`.
     - **Caution:** `updateTicketSchema` is built from `createTicketSchema.omit(...)`, so the base has to remain a `ZodObject`. Apply the refinement in a separate exported `createTicketRequestSchema = createTicketSchema.superRefine(...)` and point the controller's `createSchema` at it, or restructure equivalently.
     - Omit the three fields from `updateTicketSchema`.
   - `createTicketCommentSchema`: add `created_at` (offset datetime, not in the future), plus a refinement rejecting it together with `scheduled_publish_*`, `cc` or `bcc`.
   - `updateTicketStatusSchema`: add a not-in-future refinement on `closed_at`.
   - The not-in-future checks compare against `Date.now()` at parse time.

3. **TicketService.createTicket** (`TicketService.ts:1711`)
   - If `data.entered_at` is present:
     - require `context.user.user_type === 'internal'` (403 otherwise)
     - build `historical: { entered_at, closed_at, closed_by: closed_at ? (closed_by ?? context.userId) : undefined }`
     - set `source: 'api_import'`
     - call `createTicketWithRetry` with `silentTicketCreation('API historical ticket import')`
   - Map model invariant errors to 400 `ValidationError` with field paths. `throwTicketModelCreateApiError` is the existing seam.
   - Pass `occurredAt: entered_at` to `writeTicketActivity`, and add `historical_import: true` to its details.
   - For a closed historical ticket on a gated board, write `CLOSE_RULES_BYPASSED` with `bypass_source: 'api_import'`. Reuse `getBoardCloseRulesRow` / `closeRulesHaveEnabledGates`, as the CSV import does.
   - Skip the post-commit `safePublishEvent('TICKET_CREATED', ...)`.
   - Keep the `TICKET_EXTERNAL_LINK_ADDED` publications. They record link bookkeeping, are not ticket-lifecycle signals, and an importer that sends `external_links` relies on them for correlation.
   - Add `// LEVERAGE: pattern historical-import-close-bypass-activity` at both the API and CSV sites.

4. **TicketService.addComment** (`TicketService.ts:2501`)
   - When `data.created_at` is present (historical):
     - validate it against `ticket.entered_at`, and against the parent comment's `created_at` for a reply (400)
     - stamp `created_at` / `updated_at` on the comment and `created_at` / `last_activity_at` on a new thread with `created_at`
     - for a reply, set the thread's `last_activity_at = GREATEST(last_activity_at, created_at)`
   - Skip:
     - `applyCommentResponseState`
     - `maybeReopenBundleMasterFromChildReply`
     - `persistCommentPublication` (no `TICKET_COMMENT_ADDED`)
   - Keep:
     - `reconcileCommentAttachments`
     - comment-level external links and their events
     - the `tickets.updated_at` bump
   - The response's `created_at` must echo the stored value.

5. **TicketService.update, status crossing** (`TicketService.ts:2033-2043`)
   - On open→closed, use `cleanedData.closed_at ?? new Date()` and `cleanedData.closed_by ?? context.userId`.
   - Validate `closed_at ≥ ticket.entered_at` (400).
   - Make sure the `TICKET_CLOSED` payload and the SLA `TICKET_CLOSED` handler (which reads `tickets.closed_at`, `slaSubscriber.ts:383-396`) see the stored value. Since the row is the source, this should hold already; verify it.

6. **OpenAPI and MCP registry**
   - `server/src/lib/api/openapi/routes/workManagementV1.ts`:
     - add `entered_at`, `closed_at` and `closed_by` to `WorkV1CreateTicketBody` (`:138-161`)
     - add `created_at` to `WorkV1TicketCommentCreateBody` (`:221-238`)
     - each description states the historical-import semantics: silent, no SLA, no notifications or webhooks or workflows; create-only; not in the future; ordering rules
     - note on `WorkV1TicketStatusUpdateBody.closed_at` (`:194-208`) that it is now honored when closing
   - `ee/docs/api-registry/tickets.json`: make the same additions to the POST `/api/v1/tickets` override (~`:455-528`) and the POST comments override (~`:667-741`). These overrides replace the OpenAPI body in the MCP registry (`ee/scripts/generate-chat-registry.mjs:308`), so skipping this file leaves MCP blind to the fields. Add a short import recipe to the ticket create description: create with `entered_at` (and `closed_at` for closed history), then add comments with `created_at`.
   - Regenerate:

     ```
     cd sdk && npx tsx scripts/generate-openapi.ts --edition ce && npx tsx scripts/generate-openapi.ts --edition ee
     cd .. && npm run mcp:registry:generate
     ```

     Commit the regenerated `sdk/docs/openapi/alga-openapi.*`, `server/src/lib/mcp/registry.generated.ts` and `ee/server/src/chat/registry/apiRegistry.generated.ts`.

7. **Tests** (§4).

8. **Move the CSV import onto the model path** (`ticketImportActions.ts:771-922`)
   - Pass `historical: { entered_at, closed_at, closed_by }` into `createTicket` and delete the `enteredAtUpdates` / `closedUpdates` raw UPDATE batches and their savepoint bookkeeping. The `closedUpdates` list is still needed to drive the `CLOSE_RULES_BYPASSED` loop; keep a slimmer list for that.
   - Preserve current CSV behavior: a closed row with no `closed_at` gets now today. To keep that, pass `closed_at: ticket.closed_at || now`; do not tighten it here.
   - Rows whose `entered_at` is absent keep `historical` undefined for an open ticket. For a closed ticket, use `historical: { entered_at: now, closed_at }` so the closed-status invariant holds.
   - Existing CSV tests (`ticketImport.*.test.ts`, `ticketImportBatchUpdateTenantFacade.contract.test.ts`) must stay green. The batch-update facade test will need updating or retiring together with the code it covers.
   - Done as its own commit.

---

## 4. Tests

Unit and contract tests live in `server/src/test/unit/api/` unless noted.

**Schemas** (extend `ticketCreateFieldPersistence.contract.test.ts`; new `ticketHistoricalImport.schema.test.ts`):
- valid `entered_at` is accepted; a non-ISO string or a date-only value returns 400
- a future `entered_at` is rejected
- `closed_at` without `entered_at` is rejected
- `closed_at < entered_at` is rejected
- the update schema strips or rejects `entered_at`
- comment `created_at`: format, not in the future, and rejected together with `scheduled_publish_at` or `cc`

**Model** (unit, alongside the existing `buildTicketCreateRow` coverage):
- `historical` drives the base `entered_at` and the closed columns
- a closed status without `closed_at` throws
- `historical` with a non-silent publisher throws
- the exhaustive handling map compiles

**Service** (model on `ticketServiceCreateForwardsFields.test.ts` and `ticketService.addComment.threading.test.ts`):
- `entered_at` is forwarded as `historical` with `source: 'api_import'` and the silent publisher
- `TICKET_CREATED` is not published, and is still published when `entered_at` is absent
- the activity row gets `occurredAt`
- a non-internal user with `entered_at` gets 403
- a historical comment:
  - stamps the comment and thread timestamps
  - skips response state, bundle reopen and comment publication
  - rejects `created_at < ticket.entered_at` and a reply that predates its parent
- the status crossing honors the supplied `closed_at`, and `closed_at < entered_at` returns 400

**Integration** (`server/src/test/integration/ticketHistoricalImport.integration.test.ts`, real DB):
- POST a ticket with `entered_at` six months ago on a board whose client has an SLA policy. Assert:
  - the DB `entered_at` and the GET response match
  - `sla_policy_id` / `sla_started_at` are null
  - there is no outbox or publication row for `TICKET_CREATED`
- POST a closed historical ticket: `is_closed`, `closed_at` and `closed_by` are persisted
- POST a comment with `created_at`: it is persisted, ordered correctly among comments, and no publication row exists
- Extend `ticketCreatedEventCoverage.integration.test.ts` so the historical path is an explicitly declared silent creation, not an uncovered one

**Registry** (model on `server/src/test/unit/ticketSilentApiMcp.contract.test.ts`): the generated OpenAPI (CE and EE) and both MCP registries advertise `entered_at`, `closed_at` and `closed_by` on ticket create and `created_at` on comment create.

**Manual / MCP check**:
- run `call_api_endpoint` POST /api/v1/tickets with `entered_at` against the dev server (`http://feature-ticket-api-allow-setting-entered-at-and-comment.localhost:3602`), then confirm in the UI that ticket details show the original open date and the conversation shows backdated comments in order
- confirm the CE SLA poller leaves the ticket alone

---

## 5. Out of scope / follow-ups

- **Silent stripping of unknown keys** on create schemas (the root of the reporter's confusion). Follow-up: make the create schemas `.strict()`, or return a `warnings: ["ignored field: x"]` envelope.
- **Comment author attribution for imports.** Historical comments are attributed to the API user (`author_type` internal), so customer-authored history shows as staff comments. Fully faithful history needs a create-time author override (`contact_id` / `user_id`, internal-only, historical-only).
- **Response state of imported open tickets** stays null because historical comments don't drive it. If wanted, a post-import "recompute response state from the last public comment" endpoint would do it.
- **Correcting dates on existing tickets** (PUT `entered_at`). Excluded by D7.
- **The CSV import writes `ticket_origin: 'INTERNAL'`** (uppercase) against `TICKET_ORIGINS.INTERNAL = 'internal'` (`ticketImportActions.ts:786`). This is a separate small bug, noticed during research.
- **Tickets created in a closed status through the non-historical path** keep `is_closed = false` (closed fields are excluded at create). This is pre-existing and unchanged here.
- **EE Temporal SLA workflow ignores `sla_started_at`** (`sla-ticket-workflow.ts:152`). Imports never start SLA, so this is irrelevant here, but it is a real drift for any ticket whose `entered_at` precedes the subscriber run.

---

## 6. Open question

- **Permission (D6).** The plan gates backdating with the existing `ticket:create` / `ticket:update` plus an internal-user check, for parity with the CSV import. If the captain wants a dedicated `ticket:import` permission instead, it should gate the CSV importer too:
  - a `catalog.cjs` entry with Admin default grants
  - a `reconcileAllTenants` migration on the `20261002120000_add_recurring_ticket_permissions.cjs` template
  - checks in both `TicketService` and `ticketImportActions.ts:443`

  Doing that would remove backdating from non-Admin roles that can import today.
