# Recurring ticket definitions: REST API and MCP

Customer: Joymode Business Solutions (Munjal Thakkar), PSA ticket alga-2026-0002909.
Card: 875e96d2 "Recurring ticket definitions REST API + MCP".

Joymode keeps recurring maintenance obligations, such as the yearly Apple APNs certificate renewal, in Alga and runs them from ChatGPT through the Alga MCP connector. Recurring ticket definitions are only reachable through the UI today, so the connector cannot create or manage them. This plan exposes them under `/api/v1`. MCP only needs the routes to be in the generated API registry: the connector's `search_api_registry` and `call_api_endpoint` tools work over that registry and have no per-resource code.

**Done when** an MCP client can create the APNs-renewal definition for one client end to end, pause and resume it, and read its next occurrences and its history.

## 1. What exists today

| Piece | Where | Notes |
|---|---|---|
| Server actions (sole entry point) | `packages/tickets/src/actions/recurringTicketActions.ts` | `withAuth`-wrapped; each checks `recurring_ticket:<action>` itself and returns `TicketActionError` values for expected failures |
| Input schemas | `packages/tickets/src/lib/recurring/definitionInput.ts` | `recurringTicketDefinitionInputSchema` (strict), `recurringTicketClientUpdateSchema`, `recurringSchedulePreviewInputSchema`, `recurringOccurrenceFiltersSchema` |
| Override schema | `packages/tickets/src/lib/recurring/effectiveFields.ts` | `recurringTicketOverridesSchema`: `board`, `priority`, `category` and `assignment` groups |
| Recurrence rule | `shared/lib/recurrence/rule.ts` | `recurrenceRuleSchema`: daily, weekly, monthly and yearly rules, each with an `end` |
| Result types | `packages/tickets/src/lib/recurring/types.ts` | `RecurringDefinitionListItem`, `RecurringDefinitionDetail`, `RecurringOccurrencePage`, `RecurringSchedulePreview`, … |
| RBAC | `server/migrations/20261002120000_add_recurring_ticket_permissions.cjs` and `utils/permissions/catalog.cjs` | `recurring_ticket` read, create, update and delete. PSA: Admin, Manager and Dispatcher get all four; Technician gets read. AlgaDesk: Admin gets all four; Agent gets read |
| API routes | none | nothing under `server/src/app/api/v1` |
| Registry / MCP | none | no entries in `server/src/lib/mcp/registry.generated.ts` (CE) or `ee/server/src/chat/registry/apiRegistry.generated.ts` (EE) |

Closest precedent: ticket templates (`/api/v1/tickets/templates`, alga-2026-0002965). `ApiTicketTemplateController` authenticates the API key, runs the existing package actions inside `runWithApiKeyContext` (so `withAuth`/`getCurrentUser` resolve the API-key user through `getApiKeyUserOverride`), and maps returned action errors with `createServerActionErrorResponse`. It contains no SQL. This plan follows that pattern exactly.

## 2. Route shape

Base path: **`/api/v1/tickets/recurring`**. This mirrors the UI route `/msp/tickets/recurring` and the sibling `/api/v1/tickets/templates`. A static segment beats `tickets/[id]` in the App Router, as `templates`, `stats` and `search` already show. `{definitionId}` is the definition UUID. **`{clientId}` is the client's `client_id`, not `definition_client_id`** (see §2.2).

| Method | Path | Action(s) reused | RBAC | MCP approval |
|---|---|---|---|---|
| GET | `/api/v1/tickets/recurring` | `listRecurringTicketDefinitions(status)` | `recurring_ticket:read` | no |
| POST | `/api/v1/tickets/recurring` | `createRecurringTicketDefinition` then `getRecurringTicketDefinition` | `recurring_ticket:create` + `ticket_template:read` (in action) | no |
| POST | `/api/v1/tickets/recurring/preview` | `previewRecurringTicketOccurrences` | `recurring_ticket:read` | no |
| GET | `/api/v1/tickets/recurring/{definitionId}` | `getRecurringTicketDefinition` | `recurring_ticket:read` | no |
| PUT | `/api/v1/tickets/recurring/{definitionId}` | `updateRecurringTicketDefinition` then `get…` | `recurring_ticket:update` (+ `ticket_template:read` when the template changes, in action) | **yes** |
| DELETE | `/api/v1/tickets/recurring/{definitionId}` | `archiveRecurringTicketDefinition` | `recurring_ticket:delete` | **yes** |
| POST | `/api/v1/tickets/recurring/{definitionId}/pause` | `setRecurringTicketDefinitionActive(id, false)` then `get…` | `recurring_ticket:update` | no |
| POST | `/api/v1/tickets/recurring/{definitionId}/resume` | `setRecurringTicketDefinitionActive(id, true)` then `get…` | `recurring_ticket:update` | **yes** |
| GET | `/api/v1/tickets/recurring/{definitionId}/upcoming` | `getRecurringTicketDefinition` then `previewRecurringTicketOccurrences` | `recurring_ticket:read` | no |
| GET | `/api/v1/tickets/recurring/{definitionId}/occurrences` | `listRecurringTicketOccurrences` | `recurring_ticket:read` | no |
| POST | `/api/v1/tickets/recurring/{definitionId}/clients` | `addClientsToRecurringTicketDefinition` then `get…` | `recurring_ticket:update` | **yes** |
| PUT | `/api/v1/tickets/recurring/{definitionId}/clients/{clientId}` | `updateRecurringTicketClient` | `recurring_ticket:update` | **yes** |
| POST | `/api/v1/tickets/recurring/{definitionId}/clients/{clientId}/pause` | `setRecurringTicketClientActive(…, false)` | `recurring_ticket:update` | no |
| POST | `/api/v1/tickets/recurring/{definitionId}/clients/{clientId}/resume` | `setRecurringTicketClientActive(…, true)` | `recurring_ticket:update` | **yes** |
| DELETE | `/api/v1/tickets/recurring/{definitionId}/clients/{clientId}` | `removeClientFromRecurringTicketDefinition` | `recurring_ticket:update` (the action uses update, not delete) | **yes** |

The approval rule: any write that makes Alga start creating real tickets for a customer, or that replaces or removes configuration, asks first. That is the same rule the template endpoints follow (PUT, DELETE and instantiate need approval; create does not). A definition with no clients is inert, so creating one needs no approval; adding a client is what starts generation. Pausing only stops generation, so it needs no approval; resuming restarts it, so it does.

### 2.1 Request bodies and query parameters

The bodies are **exactly** the existing schemas. Nothing is re-declared (§3).

- **POST / PUT `/{definitionId}`**: `recurringTicketDefinitionInputSchema`. Required: `name`, `ticket_template_id`, `recurrence`, `start_date`. Defaults: `is_active` true, `overrides` `{}`, `status_id`/`assigned_to`/`assigned_team_id` null, `additional_agent_ids` `[]`, `create_time` `08:00`, `due_time` `17:00`, `lead_days` 0, `non_business_day_policy` `keep`, `open_previous_policy` `always_create`, `notify_client_on_create` false. The schema is strict: ticket content (title, description, checklist, tags) belongs to the ticket template and is rejected here. **PUT replaces the whole definition** because that is what the action does. Omitted fields go back to their defaults; they do not keep their current values.
- **POST `/preview`**: `recurringSchedulePreviewInputSchema`, a draft schedule that is not saved.
- **POST `/{definitionId}/clients`**: `{ client_ids: uuid[] }` (1–100). This is a thin envelope because the action takes a bare array. Clients already on the definition are ignored (`ON CONFLICT … IGNORE`). The response carries `added` and the refreshed detail.
- **PUT `/{definitionId}/clients/{clientId}`**: `recurringTicketClientUpdateSchema`, a full replace of `overrides`, `contact_id`, `location_id` and `asset_ids` (all required; send `{}`, `null` or `[]` to clear).
- **GET `/`**: `status` = `active` | `paused` | `archived` | `all` (default `all`, which is the action's default, archived included), plus `search` (name substring), `page` and `limit`.
- **GET `/{definitionId}/occurrences`**: `status` = `created` | `skipped` | `missed` | `failed`, `client_id`, `page`, `limit`. The controller maps `limit` to the action's `pageSize`.

Example: create the APNs renewal (yearly, due 1 March, created 30 days early):

```json
POST /api/v1/tickets/recurring
{
  "name": "Apple APNs certificate renewal",
  "ticket_template_id": "<template uuid from POST /api/v1/tickets/templates>",
  "recurrence": { "frequency": "yearly", "month": 3, "day": 1, "end": { "type": "never" } },
  "start_date": "2027-03-01",
  "lead_days": 30,
  "non_business_day_policy": "previous"
}
```

Then `POST /api/v1/tickets/recurring/{id}/clients { "client_ids": ["<Joymode client uuid>"] }`. A yearly rule is `{ frequency, month, day, end }` (`shared/lib/recurrence/rule.ts`) and has no `interval`. The rule objects are not strict, so an `interval` sent on a yearly rule is silently dropped rather than refused. The create description should say "every year" explicitly.

### 2.2 Why `{clientId}` and not `definition_client_id`

The per-client actions key on `definition_client_id`, a surrogate key that an agent never sees anywhere else. An agent knows `client_id` from `GET /api/v1/clients`, and `(tenant, definition_id, client_id)` is unique on the table (the action's `onConflict` target). The controller therefore resolves `{definitionId}` + `{clientId}` to `definition_client_id` by reading `getRecurringTicketDefinition(definitionId).clients`. A missing pair is a 404. The lookup also enforces that the client belongs to the definition in the path, **which the actions themselves do not check** (§7, M3). This is a lookup, not business logic, and it reuses the read action.

### 2.3 Responses

All responses use the standard envelope: `createSuccessResponse` / `createPaginatedResponse`.

- Definition reads and writes return **`RecurringDefinitionDetail`**: `definition`, `clients[]` (with `client_name`, `asset_ids`), `next_due_at`, `time_zone`, `effective_fields`. Writes re-read through `getRecurringTicketDefinition`, so every write returns the same shape, as the template controller does. Create returns 201.
- DELETE `/{definitionId}` and DELETE `…/clients/{clientId}` return 204. An archived definition stays readable with `definition.archived_at` set and status `archived`.
- List returns paginated `RecurringDefinitionListItem[]`: `status`, `recurrence`, `client_count`, `next_due_at`, `has_failure`, `time_zone`.
- Occurrences return a paginated `RecurringOccurrenceListItem[]`. Each item carries `ticket_id`, `ticket_number`, `status`, `reason` and `attempts`, and `pagination.total` comes from the action's `total`.
- `/preview` and `/upcoming` return `RecurringSchedulePreview`: the next 5 `{ nominal, due, create_at, due_at }`, `time_zone`, the business-day `calendar` used, and `sample_title`.

Each schema gets real descriptions so `search_api_registry` lands on it. For example, `time_zone` explains that due and create times are wall-clock times in the tenant zone, and `has_failure` explains that it means the latest occurrence for some client failed and the occurrences endpoint has the reason.

### 2.4 Errors

The controller maps the action's `messageKey` (from `ERROR_KEYS` in the actions file), the same way the template controller special-cases `inUseBySchedules`:

| Action error | messageKey suffix | HTTP |
|---|---|---|
| `DEFINITION_NOT_FOUND`, `CLIENT_NOT_FOUND` (row) | `definitionNotFound`, `clientNotFound` | 404 |
| `DEFINITION_ARCHIVED` | `definitionArchived` | **409** (shared mapping would give 400) |
| `INVALID_REFERENCES` | `invalidReferences` | 400, with the joined problem list |
| `CLIENT_NOT_FOUND` from add-clients ("no longer exist") | `clientNotFound` | 400 (the request named a bad client; the path is valid) |
| `permissionError` | — | 403 |
| ZodError | — | 400 via `ValidationError` |

The two `CLIENT_NOT_FOUND` cases share one key but need different statuses. The controller tells them apart by which handler it is in.

## 3. Reuse, no duplication

- **Validation**: the controller imports the schemas from `@alga-psa/tickets/lib/recurring/definitionInput` (resolved to source through the `@alga-psa/tickets/*` path alias, as the template controller already does for `lib/instantiateTicketTemplate`) and calls `validateData` / `validateQuery` with them. No `server/src/lib/api/schemas/recurringTicket.ts` copy of the definition body. The only new zod is for the API's own pieces: the add-clients envelope, the list and occurrences query strings (string to number, like `ticketTemplateListQuerySchema`) and the path parameters.
- **OpenAPI**: `server/src/lib/api/openapi/registry.ts` uses `extendZodWithOpenApi` on the same zod (^4.6.7) the packages use. So `registry.registerSchema('WorkV1RecurringTicketDefinitionBody', recurringTicketDefinitionInputSchema)` documents the real schema. The ticket-template docs do *not* do this: they keep a hand-mirrored `ticketTemplateBodyShape` and a comment saying the two must stay in step. Recurring tickets should not repeat that. Field descriptions are added once with `.describe()` in `definitionInput.ts`, `effectiveFields.ts` and `shared/lib/recurrence/rule.ts`, where the UI picks them up too. `.describe()` does not change parsing.
- **Behaviour**: permissions, reference validation (`findTicketFieldReferenceProblems`), archived read-only, the no-backfill watermark on resume and add-client, and the history that survives client removal all stay in the actions. The controller adds only HTTP: path parsing, the `client_id` to `definition_client_id` lookup, pagination slicing and status mapping.
- **`/upcoming`** builds a preview draft from the saved definition (recurrence, `start_date`, times, `lead_days`, policy, `ticket_template_id`) and calls `previewRecurringTicketOccurrences`. The occurrence maths (`listUpcomingOccurrences`, business-day calendar, tenant time zone) is not reimplemented.

## 4. Authorization

- API-key auth through `ApiBaseController.authenticate`; then `runWithApiKeyContext` makes the key's user the action's user (`getApiKeyUserOverride` in `packages/auth/src/lib/getCurrentUser.ts`).
- The controller runs `checkPermission(resource: 'recurring_ticket', action)` before calling an action, so it can fail fast with 403. The action checks again, and the action's check is the authoritative one. Template-read permission on create and on a template change is enforced only inside the actions (R2), so the API and the UI cannot drift.
- Tenant scope: every action goes through `tenantDb(…, tenant)`, and the tenant comes from the key.
- OpenAPI extensions per route: `x-tenant-scoped`, `x-rbac-resource: recurring_ticket`, `x-rbac-action`, plus `x-rbac-additional-required: ticket_template:read` on POST and PUT, and `x-chat-approval-required` per §2.

## 5. Registry and MCP exposure

The pipeline (`npm run generate:artifacts`):

1. Register the routes in `server/src/lib/api/openapi/routes/workManagementV1.ts`, next to the ticket templates: same `tag` (`Work Management v1`), `security: [{ ApiKeyAuth: [] }]`, `edition: 'both'`. Recurring tickets are not edition-gated: the menu entry only needs `recurring_ticket:read`.
2. `npm run generate:openapi` writes `sdk/docs/openapi/alga-openapi{,.ce,.ee}.{json,yaml}`.
3. `npm run mcp:registry:generate` (`ee/scripts/generate-chat-registry.mjs`) turns each spec into `server/src/lib/mcp/registry.generated.ts` (CE) and `ee/server/src/chat/registry/apiRegistry.generated.ts` (EE). `approvalRequired` comes from `x-chat-approval-required`, and `rbacResource` comes from `x-rbac-resource`. Optional overrides go in `ee/docs/api-registry/tickets.json`. They are not needed if the OpenAPI descriptions are good, and the descriptions are where the effort should go.
4. `scripts/ci/artifact-drift.mjs` fails CI if the committed generated files differ from a fresh run, so all four artifacts are committed together with the routes.

The descriptions are written for an agent picking an endpoint:
- List: "find a schedule by name, see what is paused, see which one is failing".
- Create: "ticket content comes from a ticket template; create one first with POST /api/v1/tickets/templates; a new definition generates nothing until clients are added".
- PUT: "replaces the whole definition".
- DELETE: "archives; history is kept; there is no unarchive".
- Upcoming: "next 5 due dates".
- Occurrences: "history, with the ticket number each created".

The create description should also point the template endpoints back here: the template list description should say "schedule a template with POST /api/v1/tickets/recurring". That is the one edit to existing docs text.

## 6. Test plan

**Contract test** `server/src/test/unit/api/recurringTicketsApiMcp.contract.test.ts`, modelled on `ticketTemplatesApiMcp.contract.test.ts`:
- Every operation in §2 is in both the CE and EE OpenAPI specs, with a non-empty description.
- The POST body in the spec has `required` ⊇ `name, ticket_template_id, recurrence, start_date` and lists every key of `recurringTicketDefinitionInputSchema.shape`. That proves the docs come from the real schema.
- Both MCP registries contain exactly these operations, each with `rbacResource === 'recurring_ticket'`, and the `approvalRequired` map is as in §2.
- The create description mentions `/api/v1/tickets/templates`; the upcoming and occurrences descriptions are findable by the words "next" and "history".

**Controller unit tests** (actions mocked):
- Path parsing and the `client_id` to `definition_client_id` lookup, including a client on a *different* definition giving 404.
- The error mapping table in §2.4.
- PUT forwards the body untouched.
- `limit`/`page` map to `pageSize`/`page`.
- `/upcoming` builds its draft from the detail.

**Integration / e2e** `server/src/test/e2e/api/recurringTickets.e2e.test.ts`, alongside `ticketTemplates.e2e.test.ts`, against a real database with an API key:
1. The done-when path. Create a ticket template; POST a yearly definition; add the client; `GET /upcoming` shows 5 yearly dates in the tenant zone; `POST /pause` shows status `paused`; `POST /resume` shows `active` with `evaluated_through` reset (no backfill); run `generateRecurringTicketsForTenant` with a clock inside the lead window; `GET /occurrences` shows one `created` occurrence with a `ticket_number`.
2. RBAC: a Technician key can read and gets 403 on every write. A key without `ticket_template:read` gets 403 on create.
3. Archive: DELETE, then GET shows `archived`, then PUT, pause and add-client each give 409.
4. Validation: an unknown body key (for example `title`) gives 400. A bad template id gives 400 `INVALID_REFERENCES`.
5. Tenant isolation: another tenant's definition id gives 404.

**MCP smoke** (manual, after deploying to the review app): from the Alga MCP connector, `search_api_registry("recurring ticket")` returns the list and create endpoints; `call_api_endpoint` runs the create, add-client, pause, resume, upcoming and occurrences flow.

## 7. Mismatches between the card and the code

These come from reading the code at the card's starting commit (`0184722cd6`):

- **M0. No implementation on the branch.** The order said the implementation already exists at HEAD. It does not. The branch is identical to `main` at `0184722cd6`: there is no route under `server/src/app/api/v1/tickets/recurring`, no controller, and no registry entry. This plan is the design for work that has not started.
- **M1. "Upcoming preview" is for drafts.** `previewRecurringTicketOccurrences` previews an *unsaved draft*. No action returns upcoming dates for a saved definition; the closest is the single `next_due_at` on get and list. `/upcoming` composes get + preview (§3). Consequences: the count is fixed at 5 by the action, and the preview ignores pause state, client pause state and occurrences already generated. A paused definition still shows dates. The response should say so, or the endpoint returns 409 or an empty list when the definition is paused. **Decision needed**; the recommendation is to return the dates plus `definition_status`, so an agent can explain them.
- **M2. Update is a full replace, not a patch.** The card says "update definitions". The action is a full replace (strict schema plus defaults), and so is the client update. PUT is the honest mapping. An agent that sends a partial body silently resets omitted fields to their defaults. The PUT description must say so loudly. A PATCH would need merge logic over the stored record, which the action does not have. Deferred unless MCP usage shows agents getting it wrong.
- **M3. Per-client actions do not check the definition in the path.** `updateRecurringTicketClient`, `setRecurringTicketClientActive` and `removeClientFromRecurringTicketDefinition` take only `definition_client_id`. The REST path carries both ids, and the controller lookup (§2.2) enforces that they match.
- **M4. Two errors have the wrong status.** The shared message-based mapping (`getActionErrorStatus`) turns `DEFINITION_ARCHIVED` into 400 and "One or more selected clients no longer exist" into 400. The first should be 409; the second is correctly 400. The controller maps by `messageKey` (§2.4).
- **M5. Archive cannot be undone.** "Delete maps to archive" is as the card says, but there is no unarchive action, so DELETE cannot be reversed through either the API or the UI. That is the reason it requires approval.
- **M6. No `requireInternal` guard.** The ticket-template actions call `requireInternal(user)`; the recurring actions do not. In practice a client-portal user's roles hold no `recurring_ticket` grant, so RBAC denies them, but the guard is absent. Recommendation: add `requireInternal` to the recurring actions in the same change. The card says UI actions are reused, so the change fixes UI and API together and does not fork them. **Flagged for the captain**, because it changes a UI action.
- **M7. No pagination or search in the list action.** `listRecurringTicketDefinitions` returns every definition, with no paging or search, and its default `all` includes archived definitions. The controller pages and filters by name in memory, as the template list does. This is fine at realistic definition counts; it would need pushing into the action if tenants ever have thousands.
- **M8. `CLIENT_ALREADY_ADDED` is never raised.** The error code exists in `errors.ts`, but `addClients…` ignores conflicts instead. The API adopts that: adding is idempotent and reports `added`.
- **M9. Template docs duplicate their schema.** The ticket-template OpenAPI docs hand-mirror their schema. This plan deliberately does not copy that precedent (§3). Worth a `// LEVERAGE: friction openapi-mirrored-schemas` marker at `ticketTemplateBodyShape` when the implementation touches that file.

## 8. What does not change

- The UI keeps calling the server actions directly. Nothing in `packages/tickets/src/components/recurring/*` changes, and no UI code moves behind the REST API.
- No schema migration. The tables, the `recurring_ticket` permissions and the default role grants stay as they are.
- The generator (`generateRecurringTicketsForTenant`), the occurrence maths, the business-day calendar and the override cascade are untouched.
- The MCP connector code is untouched. Exposure is registry-only.
- `/api/v1/tickets/templates` behaviour is untouched. Only its list description gains a pointer to recurring schedules.
- Out of scope: `listRecurringTicketsForClient` (client-page view) and `getRecurringSourceForTicket` (ticket badge). A natural follow-up is `GET /api/v1/clients/{clientId}/recurring-tickets`, but the done-when path does not need it.

## 9. Files the implementation will touch

- `server/src/app/api/v1/tickets/recurring/route.ts`, `preview/route.ts`, `[definitionId]/route.ts`, `[definitionId]/{pause,resume,upcoming,occurrences}/route.ts`, `[definitionId]/clients/route.ts`, `[definitionId]/clients/[clientId]/route.ts`, `[definitionId]/clients/[clientId]/{pause,resume}/route.ts`
- `server/src/lib/api/controllers/ApiRecurringTicketController.ts` (new)
- `server/src/lib/api/schemas/recurringTicket.ts` (new; API-only pieces: query strings, add-clients envelope, path parameters)
- `server/src/lib/api/openapi/routes/workManagementV1.ts`
- `packages/tickets/src/lib/recurring/definitionInput.ts`, `effectiveFields.ts`, `shared/lib/recurrence/rule.ts` (`.describe()` only)
- Generated: `sdk/docs/openapi/*`, `server/src/lib/mcp/registry.generated.ts`, `ee/server/src/chat/registry/apiRegistry.generated.ts`
- Tests per §6
- Optional (M6): `packages/tickets/src/actions/recurringTicketActions.ts` (`requireInternal`)
