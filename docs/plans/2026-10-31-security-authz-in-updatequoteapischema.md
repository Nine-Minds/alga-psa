# updateQuoteApiSchema — remove the lifecycle back door from generic quote updates

Card: `7af68230-a9a2-515d-98b4-ee7970858d93`
Finding: **authz · high** — `server/src/lib/api/schemas/quoteSchemas.ts:103-105`
(`updateQuoteApiSchema`), reviewed on merge `dedce8256173` (PR #3985).

## What is wrong (confirmed on the branch)

`updateQuoteApiSchema` is `partialWithoutDefaults(createQuoteApiSchema).extend({ status: quoteStatusSchema.optional().nullable() })`
(`quoteSchemas.ts:103-105`). `PUT /api/v1/quotes/{id}` therefore accepts **`status`**, and
`ApiQuoteController.update` (`:338-354`) forwards the parsed object to `QuoteService.update`
(`:265-283`), which passes `status` into `Quote.update` (`packages/billing/src/models/quote.ts:291-315`),
whose transition table allows `pending_approval → approved`
(`shared/lib/quotes/quoteStatusTransitions.ts:7-10`).

Meanwhile the dedicated approval route requires **`quotes:approve`** *and* the self-approval policy
(`ApiQuoteController.ts:76-90`, `636-653`). `billing:update` is granted to ordinary Finance users while
`quotes:approve` defaults to Admin only. So a billing editor can approve — including self-approve — any
pending quote through the generic update endpoint, bypassing the approval authority, the self-approval
policy, and the dedicated route's audit.

This is the quote-side twin of the bulk-invoice defect already fixed on this branch family: a lifecycle
transition reachable through a CRUD-shaped door.

## Design

### Rule

**`status` is not an update field.** Every quote lifecycle transition happens through an explicit command
that owns its permission, transition check, lock, audit and side effects. Generic update edits content
only.

### 1. Schema

Drop the `.extend({ status: ... })` — `updateQuoteApiSchema` becomes plain
`partialWithoutDefaults(createQuoteApiSchema)` and `UpdateQuoteApi` loses `status`. A `PUT` carrying
`status` then fails schema parse with 400 (zod's default object is not `.strict()`, so make the rejection
explicit — see §2).

### 2. Service guard (defence in depth)

`QuoteService.update` rejects lifecycle keys before touching the row:

```ts
const { status, ...content } = data as UpdateQuoteApi & { status?: unknown };
if (status !== undefined) {
  throw new BadRequestError('Quote status is not editable; use a lifecycle command (submit, approve, send, cancel)');
}
```

The runtime check matters because `QuoteService.update` is a public service method: schema hardening alone
would leave the next caller free to pass `status` again (this is exactly how the bulk-invoice handler
regressed).

### 3. Lifecycle commands (`QuoteService`)

One small dispatcher, mirroring `quoteStatusTransitions`:

| target status | command | authority |
|---|---|---|
| `pending_approval` (from `draft`) | `submitForApproval(id, ctx)` | `billing:update` |
| `approved` | existing `approve(id, ctx, {selfApproved})` | `quotes:approve` + self-approval policy (unchanged) |
| `sent` | existing `send(id, data, ctx)` (its own route) | existing route's authority (unchanged) |
| `cancelled` | `cancel(id, reason, ctx)` — new | `billing:update`, locks the row, audits with reason, no-op if already cancelled |
| `accepted` / `rejected` / `expired` / `converted` | **not** reachable from an authenticated billing route | portal / public accept-reject / conversion engine |

`cancel` is the only transition that currently has no home and was being performed through generic
update; give it a real command, then nothing legitimate is left behind the removed field.

Each command: `withTransaction` → `SELECT … FOR UPDATE` → re-read status → `canTransitionQuoteStatus`
→ permission already checked by its caller/service method → persist + audit row. Errors are 404/409, not
silent no-ops.

### 4. Controller

`PUT /quotes/:id` keeps its existing `billing:update` + record read checks and simply no longer carries
`status`. `POST /quotes/:id/cancel` is added for the new command (same shape as the existing `send` route).
`POST /quotes/:id/approve` is untouched.

### 5. Regression tests

`server/src/test/unit/api/quoteUpdateLifecycle.test.ts` (fails on main):

1. `updateQuoteApiSchema.safeParse({ status: 'approved' })` → **fails** (main: passes);
2. service-level: `QuoteService.update(id, { status: 'approved' } as any, ctx)` → 400, and the quote row is
   still `pending_approval` (main: it becomes approved);
3. a billing editor (`billing:update`, no `quotes:approve`) hitting approve through any generic path →
   denied; through `/approve` → denied by `checkQuoteApprovePermission`;
4. self-approval policy still enforced on the dedicated route (existing test stays green);
5. content update (`client_notes`, items) still works and does not alter status;
6. `cancel` command: allowed transition succeeds + audit row; illegal source status → 409.

## Order of work

1. `cancel` command + its test (so nothing is lost when the field goes).
2. Remove `status` from the schema/type; add the service guard.
3. Controller cancel route.
4. Lifecycle test file; run the quote schema + controller suites.

## Deliberately not doing

- Not rewriting the transition table or the models' `Quote.update` transition logic — the table is the
  contract; the defect is that a CRUD endpoint could reach it without authority.
- Not adding a generic `POST /quotes/:id/status` — a generic status setter is the same hole with a new
  name. Each transition gets a named command.
- Not touching the public accept/reject path (a different authority model, `publicQuoteOutcome` already
  covers it).

## Risks

- **API clients** that used `PUT status` break with a 400. That is the finding's intent; the error message
  names the command endpoints so the fix is mechanical.
- **Missing transition coverage**: if some UI calls `PUT status='sent'` today, it must move to the existing
  `send` route — check `packages/client-portal`/billing UI call sites before merging.
- **Concurrency**: `cancel` and `approve` both lock the row; keep the lock order (quote row first) identical
  to `approve` or a pending approval and a cancel can interleave.
