# REST tag writes, list tag edits and re-anchored lifecycle tests

This round follows [tagfix-f6203caf](../tagfix-f6203caf/README.md). That round guarded the `packages/tags` server actions and both ticket-screen layouts. It left three gaps:

- a departed customer's API key could still create, delete and recolour tags through the REST `TagService`;
- `ClientService` client writes could still rewrite client tags;
- the ticket list still offered inline tag edits.

All three are closed in `ccb29f5087628ffb7a37be19d8d2a2f193bb693e`. The same commit also re-anchors the four lifecycle tests that failed at `ece82ba64e`.

## What runs where

| | |
| --- | --- |
| Application source | `ccb29f5087628ffb7a37be19d8d2a2f193bb693e`, diff fingerprint `da39a3ee5e6b` (clean tree) |
| Build | `build-1792967039963` in `server/.next-review-final-ccb29f50` |
| Origin | `http://feature-co-managed-it.localhost:23374` (production). The sign-in HTML carries the build ID and `/api/health` returns 200 ([runtime-provenance.json](runtime-provenance.json)). |
| Build service | `review-build-prep-ccb29f50:21`, prepare-only, admitted normally and concluded after the build ([build log](raw-logs/review-build-prep-ccb29f50.txt)) |
| Serving service | `review-app:21`, admitted normally with readiness `23374/api/health`. It reused the stamped build ([start log](raw-logs/review-app-21-start.txt), [admission attempts](raw-logs/board-admission-attempts.txt)). |
| Replaced | `f6203caf` / `build-1792963638060`. It was concluded through the board (`review-app:28`) and stopped with `run-card-service.sh review-app --stop`. The card-owned `next-server` it left listening was then sent SIGTERM. |

## What changed

- **`packages/db/src/services/BaseService.ts`** gains `mutationTransaction(context, work)`. It opens one transaction and runs the service's `mutationGuard` as its first step. Custom writers use it so that admission and the write share a transaction.
- **`server/src/lib/api/services/TagService.ts`** sets `mutationGuard` to `assertCoManagedOperationalWrite`, which covers the inherited `create`, `update` and `delete`.
  - Every custom writer now runs inside `mutationTransaction`: `createTag`, `updateTag`, `deleteTag`, `tagEntity`, `untagEntity`, `replaceEntityTags`, `bulkDeleteTags`, `bulkMergeTags`, `bulkUntagEntities`, `updateTagColors`, `updateTagText` and `deleteTagsByText`. `deleteTag` previously wrote on a bare connection.
  - A refusal reaches `handleApiError` as `CO_MANAGED_READ_ONLY` and is answered with 423, the same way TicketService refusals are.
  - `replaceEntityTags` used to call `tagEntity`, which opened a **second transaction** on another connection. Under admission, that inner transaction waits forever for the entitlement lock the outer one holds. Even on a native PSA tenant, re-adding a tag the entity already had waited on the outer transaction's uncommitted delete of the same mapping. The add step now runs in the same transaction. Restoring the nested call makes both positive controls hang until the test timeout ([log](raw-logs/integration-rest-per-guard-mutation.txt), last line).
- **`server/src/lib/api/services/ClientService.ts`** sets the same `mutationGuard`. Client `create` and `update` rewrite client tags in `handleTags`, so both now admit at the start of their transaction, before any row is touched. Admitting inside `handleTags` would take the lifecycle locks after the client row was written.
- **Ticket list.** `server/src/app/msp/tickets/page.tsx` folds the workspace lifecycle into the existing `canUpdateTickets` prop. `TicketingDashboard` passes `tagsReadOnly: !canUpdateTickets` to `createTicketColumns`, and `ticket-columns.tsx` renders the inline `TagManager` with `readOnly`. The same flag already hid bulk move, assign, status, priority, tags and due-date for viewers without update permission. A read-only workspace now gets the same treatment.

## Live check on the admitted build

- **Departed admin** ([recording](live/01-departed-customer-tags-read-only/recording.json), [raw](raw-logs/live-smoke-departed.txt)). Account `depart.admin.1792959853966@cmreview.test`, tenant `d46de2e8`, relationship `38db9e8a` terminated.
  - Ticket `c7c64319` shows `SMOKE ended tag 1792962099027` in Entry and in Grid with 0 add, remove or edit controls.
  - `/msp/tickets` shows the same tag inline under the title, also with 0 controls ([screenshot](live/01-departed-customer-tags-read-only/ticket-list.png)).
  - The workspace's `tag_mappings` are unchanged ([db-receipt](live/01-departed-customer-tags-read-only/db-receipt.json)).
- **Positive controls** ([raw](raw-logs/live-smoke-writable.txt)). Alice (active co-managed, ticket `cfff4242`) and QA (native Oz ticket `68a51c93`) each added a tag, saw it persist across a reload, and removed it through the product. No `SMOKE tagfix` tag remains.
- **REST through a departed-tenant API key: not attempted.** No API key exists for tenant `d46de2e8`, and creating one would add a credential to a customer account, which this round must not change. The REST path is proven only by the PostgreSQL tests below.

Tag `6263f9a0` and mapping `5189148f` (from the original reproduction) are still retained as smoke data. No account, password, grant or API key was changed.

## Tests

- **Lifecycle block in PostgreSQL.** The `co-managed tag lifecycle admission` block has 6 tests, all passing ([log](raw-logs/integration-tag-lifecycle-focused.txt)). The three added this round are:
  - a terminated customer's REST `TagService` writes are all refused with `CO_MANAGED_READ_ONLY`, covering all twelve custom writers plus inherited `create` and `delete`, as are `ClientService.create` and `update` with tags. Both tag tables are unchanged, nothing is published, and REST reads still return the tag;
  - for an active co-managed tenant and for a native PSA tenant, REST `createTag`, `updateTag`, `updateTagText`, `tagEntity`, `replaceEntityTags`, `deleteTag` and `deleteTagsByText` all succeed, and `ClientService.update` retags the client.
- **Per-guard mutation check** ([log](raw-logs/integration-rest-per-guard-mutation.txt)). Each of the twelve `TagService` sites, the inherited `mutationGuard`, and each of the two `ClientService` sites was disabled on its own. Each one turned the denial test red.
- **Re-anchored tests** ([log](raw-logs/integration-reanchored-and-tag-block.txt)).
  - The three ticket-edit tests now expect the server actions (`updateTicket`, `updateTicketWithCache`) to return the lifecycle action error introduced by `56e708a31b`. The expected message is exact for each state: pending acceptance and read-only. The shared transaction core, `updateTicketInTransaction`, must still throw the coded error. The ticket-row, audit and event assertions are unchanged.
  - T004 was a stale test, not a product defect. `33ae41dcae` deliberately moved the disclosed customer assignee from an unread `customerAssignee` side property to `ticketData.ticket.assigned_to_name`, carried by name only. The test now asserts that field. It also asserts there is no `assigned_to` identity and no side property.
- **Full integration file: 1475 / 1475 passed** ([log](raw-logs/integration-full-file.txt)).
- **UI.**
  - `ticket-columns.tagsReadOnly.test.tsx` has 2 tests, both passing ([log](raw-logs/ui-list-tags-read-only.txt)). They render the real `TagManager`. Removing the `readOnly` pass-through turns the read-only test red ([log](raw-logs/ui-list-tags-mutation-check.txt)).
  - Ticket package components and lib: 1059 / 1059 passed ([log](raw-logs/tickets-unit.txt)).
- **Static checks.** Typecheck passes for the server (12 GiB) and for `packages/db`, `tags`, `tickets`, `co-managed` and `ui`. `check:transaction-threading` (754 files) and `check:dist-resolution` (241 modules) also pass.

## Tag writers left unguarded, and why

- **`shared/models/tagModel.ts` through `createTicketWithSideEffects`.** This writes tags as part of *creating a ticket*. Its callers are the workflow-runtime `create ticket` action, the recurring-ticket job (`generateRecurringTicketsForTenant`) and billing renewal tickets. None of these callers admits the ticket creation itself, so a lifecycle gap exists at the ticket-creation layer, not the tag layer. A guard at the tag step would run after the ticket row is written, which breaks the admission lock order, and it would still leave the ticket creation unguarded. That belongs with the ticket lifecycle owners.
- **`shared/models/tagModel.ts` in `customer-tracking-activities` and `tenant-deletion-activities`.** These tag clients in Nine Minds' own management tenant (customer tracking, and a `Canceled` tag at tenant deletion), not in a co-managed customer workspace. Tenant deletion must also keep working for a terminated workspace.
- **Workflow-runtime contact and client actions** (`shared/workflow/runtime/actions/businessOperations/contacts.ts` and `clients.ts`). These write tag mappings inside contact and client workflow actions, none of which is lifecycle-admitted. That is the same ticket-creation-style gap, at the contact and client workflow layer.
- **Other `ClientService` writers** (locations, billing profile and similar). They do not write tags, so they were out of scope this round. Setting `mutationGuard` does admit `ClientService`'s inherited BaseService mutations.

The departed ticket screen still shows other write buttons: Delete, Duplicate, Create Task, Quick invoice, and the Materials and Contact add controls. They remain out of scope as instructed.

## Scripts

[scripts/tag-lifecycle.cjs](scripts/tag-lifecycle.cjs) runs the live scenarios, with `SKIP_DEPARTED` and `SKIP_WRITABLE` to select them. Its harness `runtime.cjs` stays in `/tmp/alga-smoke-evidence/co-managed-it-tagfix-ccb29f50/scripts/` because it embeds a review credential. [scripts/prepare-ccb29f50.sh](scripts/prepare-ccb29f50.sh) is the prepare-only build command the board ran. The opening of [implement-20261025/README.md](../implement-20261025/README.md) was regenerated against this build ([render output](raw-logs/readme-opening-render.txt)). `completion-verdict.json` and the census are unchanged.
