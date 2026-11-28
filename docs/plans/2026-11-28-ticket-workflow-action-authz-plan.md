# Design — Security: authz in registerTicketActions

## Finding (confirmed on this branch, off current main `292280a750`)

`registerTicketActions` registers ten ticket actions in `shared/workflow/runtime/actions/businessOperations/tickets.ts`. Only four pass through co-managed record-scope / field authority: `add_comment` (`:671`), `update_fields` (`:807`), `assign` (`:1023`), `close` (`:1187`) each call `retainWorkflowTicketAuthority`. The other six perform only coarse role checks and then touch ticket rows/relations directly:

- `tickets.create` — `requirePermission(ticket:create)` only (`:505`), then inserts for an arbitrary `client_id`/`board_id`.
- `tickets.link_entities` — `requirePermission(ticket:update)` only (`:1390`), then reads `tickets` and inserts `ticket_entity_links`.
- `tickets.add_attachment` — `requirePermission(ticket:update)` + `document:create` only (`:1509-1510`), then attaches a document.
- `tickets.find` — `requirePermission(ticket:read)` only (`:1736`), then loads the ticket, comments, attributes, and related display names with no scope or field redaction.
- `tickets.apply_checklist` — `requirePermission(ticket:update)` only (`:1906`).
- `tickets.add_checklist_items` — `requirePermission(ticket:update)` only (`:1980`).

A workflow publisher whose authorization bundle narrows them to client A can drive any of these with client B's `ticket_id` (a tenant-wide ticket event, or a literal in the workflow) and read or mutate that record and its comments/attributes/attachments/links/checklists, then leak the disclosed values through the run output. This is the same concrete bundle-scoped-authority threat the earlier `retainWorkflowTicketAuthority` card closed for the four mutation actions; `registerTicketActions` was never extended to the rest.

Prior art: PR #4125 (`feature/security-authz-in-registerticketactions`, HEAD `7f38c01e`) implemented a full version of this on an older base. Treat it as evidence. This branch is off current main, which has since evolved the `@alga-psa/authorization` package (it already contains `compileResourceReadAuthorizationSql`, `resolveDefaultBuiltinRelationshipRules`, `createTicketRelationshipSqlAdapter`, `createTicketReadScopeFromRules`, and the `hide_sensitive_fields`-as-field-mask fix) and already contains the four-action `retain` work and the `workflowTicketAuthority.ts` adapter. This plan adapts the PR's mechanism to current main rather than cherry-picking it.

## Decision

One structural adapter, not ten per-action checks. Every ticket action registers through a single wrapper, `registerAuthorizedTicketAction`, that drives a **central ticket workflow authorization adapter parameterized by operation** (`read` / `create` / `update`) and by the exact affected/read fields. The wrapper is the only place a ticket action may obtain its transaction and its record authority:

- the wrapper opens `withTenantTransaction`, runs the coarse `requirePermission` check, resolves the co-managed authority, and authorizes the record/selector before the handler's body runs;
- for a served co-managed tenant, the authority is a real `authorize`/`findCandidates` call through the existing `coManagedWorkflowTicketSeam`; for a definite not-served tenant it resolves `null` and native behaviour (coarse role check only) is preserved;
- the handler body runs **after** authorization, receives the already-scoped ticket and its `redactedFields`, and never re-reads the ticket before authority has been exercised.

Enforcement belongs in the **action registry boundary** (the wrapper), not in each handler and not in the existing `retainWorkflowTicketAuthority` helper. `retainWorkflowTicketAuthority` becomes a legacy, mutation-only adapter kept for its existing direct callers and tests; the seam gains operation-aware `authorize` (read/create/update) and `findCandidates` (selector) capabilities on top of it.

Field provenance (which redaction names a logical workflow field can hide — e.g. `comments` hides `conversation.note`, `attributes.external_ref` hides `external_ref`) is declared **once** in a canonical map in `shared/lib/coManagedDelivery.ts`, shared by both the package-side authority and the shared-side redaction projection. The explicit "which columns may a patch touch" set lives in `tickets.ts` (an updatable-column allow-list), so an unsupported patch column is rejected before any data access.

## Operation semantics

| operation | coarse check | ticket lock | authority | redaction handling |
| --- | --- | --- | --- | --- |
| `read` (`tickets.find`) | `ticket:read` | `FOR SHARE` | `read` only | do **not** reject on redaction; return `redactedFields` and project/omit fields at the boundary |
| `create` (`tickets.create`) | `ticket:create` | none (no row yet) | `create` on prospective `{clientId,boardId,assignedUserIds,teamIds}` **plus** `read` on the fields the action returns | reject if any writable/returned field is redacted |
| `update` (8 mutations) | `ticket:update` | `FOR UPDATE` (retain the row in the same transaction the handler uses) | `read` + `update` | reject if any affected/read field is redacted |

Selector-scoped read (`tickets.find` by `ticket_number` or `external_ref`) is authorized in two steps, both fail-closed:

1. **Predicate authorization** — the selector's own fields (`ticket_number`, `attributes.external_ref`, `response_state`) are checked against the publisher's read redactions; if the predicate field is masked the lookup throws `WORKFLOW_TICKET_PREDICATE_FORBIDDEN` (a masked field must never participate in matching, or a masked predicate becomes an oracle).
2. **Candidate scope** — the publisher's ticket-read scope is applied in SQL over the tickets table (reusing `compileResourceReadAuthorizationSql` / `createTicketRelationshipSqlAdapter`), returning only in-scope candidate ids, then each candidate is per-record `authorize`d and its selector values re-checked before any comments/attachments/display-name lookups run.

## Fail-closed rules

- Seam resolves no provider or an unknown verdict for a served/possibly-served tenant → `WorkflowTicketAuthorityUnavailableError` (unchanged from the existing `retain` path; the wrapper reuses the same `resolveWorkflowTicketAuthority`).
- A served tenant whose provider only implements the legacy `retain` (no `authorize`) → the wrapper throws `WorkflowTicketAuthorityUnavailableError('operation-authorizer-missing')`; no `findCandidates` → `'selector-authorizer-missing'`.
- An unsupported selector type inside `findCandidates` → `CoManagedSharedWorkError`.
- An unsupported patch column in `tickets.update_fields` → `VALIDATION_ERROR` before any data read (explicit `WORKFLOW_TICKET_PATCH_FIELDS` / `WORKFLOW_TICKET_UPDATABLE_COLUMNS` allow-lists).
- A redacted affected/returned field on create/update → `CoManagedSharedWorkError` (the run fails, no write).
- An unknown/non-ticket action is untouched (out of scope); the wrapper only governs the ten ticket actions.

## Files and order

### 1. `shared/lib/coManagedDelivery.ts` — seam contract + provenance map
- Add `WorkflowTicketAuthorizationInput` (`operation`, optional `ticketId`, `prospective`, `assignment`, `fields`, `readFields?`, `predicateFields?`) and `WorkflowTicketSelectorInput` (`selector` with `ticketId|ticketNumber|externalRef|responseState`, `predicateFields`).
- Add `WORKFLOW_TICKET_DERIVED_SOURCES` and `workflowTicketFieldSources(field)` — the single source of truth for logical→concrete redaction provenance (port from PR #4125, re-verified against current `tickets.ts` fields, including `company_id`, `contact_name_id`, `response_state`, `due_date`, `recurrence`).
- Extend `CoManagedWorkflowTicketAuthority` with `authorize?` and `findCandidates?`; keep `retain` for legacy callers.

### 2. `packages/co-managed/src/workflowTicketAuthority.ts` — operation-aware provider
- Extend `retainCoManagedWorkflowTicketAuthority` to accept `operation`, `prospective`, `assignment`, optional `ticketId`, `predicateFields`; return `{ redactedFields }`.
- Operation branching as in the table above: `create` builds the prospective record and authorizes `create`+`read` without an existing row; `read` uses `FOR SHARE` and authorizes only `read`; `update` uses `FOR UPDATE` and authorizes `read`+`update`. Team-backed `assignment` projects the persisted team manager into the prospective/updated assignee scope (port PR #4125's team-manager projection).
- Add the `fieldSources` expansion (the current inline flatMap only covers assignment/status_id/tags/custom_fields/due_date/resolution; extend to `attributes.*`, `comments`, `attachments`, `entity_links`, `checklist`, `contact_id`, `description`, `entered_at`).
- Add `findCoManagedWorkflowTicketCandidates` (selector-scoped read): authorize predicate fields, then compile the publisher's read scope over `tickets` and return candidate ids. Reuse `compileResourceReadAuthorizationSql` + `createTicketRelationshipSqlAdapter` + `resolveDefaultBuiltinRelationshipRules` from `@alga-psa/authorization` (do not hand-roll the adapter — see Open questions).

### 3. `packages/co-managed/src/deliveryRegistration.ts` — register the new seams
- Register `authorize` (calls `retainCoManagedWorkflowTicketAuthority` and returns `{ redactedFields }`) and `findCandidates` (calls `findCoManagedWorkflowTicketCandidates`) alongside the existing `retain`.

### 4. `shared/workflow/runtime/actions/businessOperations/shared.ts` — shared entry points
- Extract `resolveWorkflowTicketAuthority(tx)` from the current `retainWorkflowTicketAuthority` body (seam resolve + `serves()` fail-closed).
- Add `authorizeWorkflowTicket(ctx, tx, input)` and `findWorkflowTicketCandidates(ctx, tx, selector)` that forward to the seam's `authorize`/`findCandidates`, throwing `WorkflowTicketAuthorityUnavailableError` when the capability is missing.
- Keep `retainWorkflowTicketAuthority` delegating to `retain` (legacy).

### 5. `shared/workflow/runtime/actions/businessOperations/ticketAuthorization.ts` — new wrapper (port from PR #4125, re-verified)
- `registerAuthorizedTicketAction(registry, def)` where `def` carries an `authority` descriptor (`operation`, `fields(input)`, `readFields?(input)`, `target(input)`) and a handler `(input, ctx, tx, grant) => O`; it wraps `withTenantTransaction`, runs `requirePermission(ticket:<operation>)`, authorizes, and resolves the read ticket (selector candidate path or direct id path).
- `workflowTicketFieldHidden(redactions, ...names)` and `redactWorkflowTicket(ticket, redactions)` for the read projection (masked scalar → `null`, masked `attributes` → omitted, masked derived display name → its lookup is skipped).
- `safeParseAttributes` for serialized-JSON `tickets.attributes`.

### 6. `shared/workflow/runtime/actions/businessOperations/tickets.ts` — convert all ten actions
- Replace every `registry.register({ ... })` with `registerAuthorizedTicketAction(registry, { authority, handler })`; each handler signature becomes `(input, ctx, tx[, grant])` and drops its inline `withTenantTransaction` + `requirePermission` + `retainWorkflowTicketAuthority`.
- Per-action authority: `create` (create, prospective scope, `readFields` = `status_id, priority_id, ticket_number, entered_at`); `add_comment`/`assign`/`close`/`update_fields` keep their current affected-field semantics but gain correct `readFields` and `assignment`/`prospective` scope; `link_entities` (`entity_links`), `add_attachment` (`attachments` + `comments` when a comment is written), `apply_checklist`/`add_checklist_items` (`checklist`), `find` (read, full summary field list + conditional `attributes`/`attachments`).
- Add `WORKFLOW_TICKET_PATCH_FIELDS` (valid patch keys) and `WORKFLOW_TICKET_UPDATABLE_COLUMNS` (valid SQL columns) + `workflowTicketColumnPatch`; `update_fields` validates the patch allow-list before reading the ticket and wraps the `TicketModel.updateTicket` column object.
- `tickets.find` uses `grant.ticket`/`grant.redactedFields` instead of its own query; `loadTicketDisplayNames` gains a `redactions` argument and skips masked lookups; comments/attachments includes are gated on their mask; `attributes` are omitted when any stored alias is masked.

### 7. `server/migrations/20261128120000_add_ticket_external_ref_lookup_index.cjs` — indexed selector (perf/correctness)
- `tickets.find` by `external_ref` now resolves candidates through a scope-narrowed query; add the `(tenant, (attributes->>'external_ref'))` index with `CREATE INDEX CONCURRENTLY`, `transaction: false`, invalid-index recovery, and wrong-definition refusal (reuse PR #4125's migration verbatim — already validated on PostgreSQL 15 and Citus 12.1, and it satisfies `migration-lint`). Include the isolated up/down/repeat/interrupted-recovery integration test.

### 8. Test registration fixups
- Register the native participation resolver (`useNativeCoManagedVerdict`) in integration suites that exercise ticket actions against real DBs but are not co-managed (the PR touched `createWorkflowFromTicket`, `ticketCreatedEventCoverage`, `workflowTicketCreateEvents`); re-derive the exact list against current main.

## Deliberately out of scope

- Non-ticket actions and other registries (only `tickets.ts`).
- Co-managed inbound comment delivery, routing, or any L4/L5 conversation authority (separate cards).
- Changing native (not-served) tenant behaviour — a definite not-served tenant keeps today's coarse role checks.
- The `retain` seam method's removal — kept as a legacy, mutation-only path; a follow-up may delete it once no production caller remains.
- Any UI/designer changes; redaction only affects runtime output, not the action schema.

## Tests that pin each action

New focused suite `shared/workflow/runtime/actions/businessOperations/__tests__/tickets.authorization.test.ts` (port + extend PR #4125's), with a mocked `coManagedWorkflowTicketSeam` provider modeling a publisher narrowed to client A and a tenant-wide event carrying client B's ticket:

1. **Mutations** — for each of `add_comment`, `update_fields`, `assign`, `close`, `link_entities`, `add_attachment`, `apply_checklist`, `add_checklist_items`: an out-of-scope client-B `ticket_id` is denied with `CO_MANAGED_SHARED_WORK_FORBIDDEN` **before any data read or write**, and the `authorize` call is `operation: update` with the correct `ticketId`/fields.
2. **Read** — `tickets.find` on an in-scope ticket succeeds with `operation: read` and no update authority; an out-of-scope `ticket_id` is denied; out-of-scope `ticket_number`/`external_ref` selectors return `null` without touching comments/attachments.
3. **Redaction projection** — masking `tickets.priority_id`, `tickets.client_id`, `attributes.*`, `comments.note`, `attachments.file_id` (and their derived names like `clients.client_name`, `priorities.priority_name`) nulls/omits the value and skips the corresponding display-name/comment/attachment lookups; serialized-JSON `attributes` with a masked stored alias are omitted.
4. **Selector predicate oracle** — masked `response_state`/`attributes.external_ref` predicates reject with `WORKFLOW_TICKET_PREDICATE_FORBIDDEN` whether the value matches or not.
5. **Create** — `tickets.create` authorizes the prospective client/board scope before validation or insertion; out-of-scope client/board is denied; a redacted defaulted `status_id` (or returned `ticket_number`/`entered_at`) is denied before insertion.
6. **Fail-closed** — a served tenant whose provider implements only `retain` (no `authorize`) makes `tickets.find` and every other action fail closed with `WORKFLOW_TICKET_AUTHORITY_UNAVAILABLE`.
7. **Patch allow-list** — `update_fields` rejects an unsupported patch column with `VALIDATION_ERROR` before reading the ticket.

Package-level suite `packages/co-managed/src/__tests__/workflowTicketAuthority.{scopeDenied,selector}.test.ts` pins the provider: read returns redactions instead of rejecting; create authorizes a prospective record with no existing row; team assignment projects the persisted manager; selector candidates are filtered by publisher scope; masked predicate rejects. The **co-managed seat user case** is the `selector` test: a seat (co-managed) publisher under a client-A `selected_clients` bundle issues a tenant-wide `external_ref` selector and only client A's ticket is returned.

Native integration coverage stays green via `useNativeCoManagedVerdict()`; the four already-protected actions' existing tests (`tickets.coManagedAuthority.test.ts`, `tickets.addCommentAuthority.test.ts`) are updated to the new seam shape where their mocks change.

## Risks

- **Default-deny for closed/narrow bundles.** A publisher whose bundle names no client/contact (or a narrower set than before) is now denied on reads and writes it previously performed via coarse role checks. This is the intended fix, but it is a behaviour change for existing workflows in served tenants; release notes must call it out.
- **Read output shape change.** `tickets.find` now returns `null`/omits masked fields; workflows that read `ticket.client_name`, `priority_name`, `attributes.*`, comments, or attachments on a partially-redacted bundle will observe nulls where they previously saw values.
- **`tickets.create` prospective scope.** Workflows that create tickets for arbitrary clients/boards will be denied for out-of-scope clients; the publisher must hold `create` scope for the client/board it creates into.
- **Index migration.** `CREATE INDEX CONCURRENTLY` cannot run in a transaction; the migration must keep `transaction: false` and pass `migration-lint` and the isolated up/down/repeat/interrupted-recovery test (already validated in PR #4125; do not regress it).
- **Team assignment projection.** Resolving a team's manager before authorize issues extra `teams` reads; a team without a manager now fails closed rather than silently authorizing the additional users only.
- **Provider drift.** Two seam methods (`retain` legacy vs `authorize`) must be kept consistent; the field-provenance map is the single source of truth to avoid the mutation/read paths diverging on redaction names.

## Open questions (could not settle from code alone)

1. **Reuse vs re-implement the selector scope.** `packages/authorization/src/ticketScopeAuthorization.ts` already has `createTicketReadScopeFromRules` that compiles exactly the "publisher scope as SQL over tickets" predicate, but it and `createTicketRelationshipSqlAdapter` are not exported from the package barrel. Recommended: export `createTicketReadScopeFromRules` (and the adapter) and reuse them in `findCoManagedWorkflowTicketCandidates` rather than hand-rolling the SQL (PR #4125 hand-rolled it). Confirm whether widening the barrel export is acceptable.
2. **Is the `external_ref` index migration required for this card, or split?** The scope-narrowed selector path is correct without the index (it still filters by client in SQL), but scans the table without it. Recommend keeping it in-scope (reuse the validated migration) but flag it as separable if the reviewer wants the authz change merged independently of the index.
3. **`retain` seam removal.** After all ten actions move to the wrapper, `retainWorkflowTicketAuthority` has no production callers (only direct tests). Confirm it is kept as legacy (this plan's default) versus deleted in the same change.
