# Client portal: restrict which ticket statuses portal users can set

## Problem statement

Client portal users can move a ticket into **any** status that exists on the
ticket's board. There is no way — by configuration or by RBAC — to keep them out
of a subset of statuses.

This matters because status transitions drive SLA measurement. An MSP that uses
statuses like "Waiting on Vendor" or "Resolved — Pending Confirmation" to stop or
start an SLA clock has no way to prevent a customer from setting them directly,
which corrupts the metric. The only lever available today is to revoke
`ticket:update` from the client role, but that is the wrong axis: it also removes
commenting, which is the portal's primary purpose.

### Why RBAC cannot express this

Permissions in this codebase are `(resource, action)` pairs
(`packages/auth/src/lib/rbac.ts:69`). There is no `ticket:close` distinct from
`ticket:update`. Denying status changes therefore also denies commenting. The
restriction being asked for is about **which** target values are permitted, not
**who** may act — a data-model axis, not a permissions axis.

## Goals

1. An admin can mark any board ticket status as not selectable by client portal
   users.
2. The portal never offers a non-selectable status in a status **picker**.
3. The portal server action **rejects** a non-selectable target status even when
   called directly, bypassing the UI.
4. MSP-side behavior is completely unchanged: every status remains readable and
   settable from MSP surfaces.
5. Deploying the change is a no-op. Every existing status is selectable until an
   admin says otherwise.

## Non-goals

- **from→to transition rules per board.** Strictly more expressive, but there is
  no transition-rules engine to hang it on. `enforceTicketCloseRules` is a
  close-time gate, not a general transition model. A per-status flag is a
  forward-compatible subset of a transition model if one is ever needed.
- **Reinstating `enforceTicketCloseRules` for portal users.** The bypass at
  `client-tickets.ts:857` is deliberate and audited — customers cannot satisfy
  internal-hygiene gates like time entries. It stays.
- **Splitting `ticket:update` into finer RBAC actions.** Wrong axis, and it would
  touch permission seeding for every existing tenant.
- **Contact-scoped ticket visibility.** Separate card.
- **Any change to SLA calculation.**
- **A general audit of MSP server actions for portal-caller reachability.** See
  "Discovered adjacent defect" — this plan closes the three actions that would
  bypass *this* control, and nothing more.

## Target users and flows

**MSP administrator** — Settings → Ticketing → Boards → edit board → "Priorities &
statuses". Each status row gains a control for whether portal users may select it.
Default on.

**Client portal user** — Ticket detail page and ticket list. The status picker
shows only selectable statuses. Attempting to set a restricted status by any other
means fails with a clear message.

## Design decisions

### D1 — Per-status boolean on `statuses`, not a transition table

`portal_selectable BOOLEAN NOT NULL DEFAULT true`. The ask is about reachable
targets, not from→to pairs. Defaulting `true` makes the deploy a no-op.

### D2 — A portal-specific read action, not a branch inside the shared one

`getTicketStatuses` (`packages/reference-data/src/actions/status-actions/statusActions.ts:83`)
has **15 MSP call sites** against **3 portal ones**. Adding a `user_type === 'client'`
branch inside it would make a heavily-shared action behave differently based on
caller identity — invisible at every call site and easy to break.

Instead: a new `getClientPortalTicketStatuses(boardId)` in
`packages/client-portal/src/actions/client-portal-actions/client-tickets.ts`, which
is already the portal's ticket-action module. The shared action is not touched, so
MSP behavior cannot regress. The mobile app reads statuses through a completely
separate path (`/api/v1/tickets/statuses`) and is likewise unaffected.

### D3 — Filter **pickers**, not **filters**

This distinction is not in the card and is important.

The portal ticket list has *two* status surfaces:

| Surface | File | Kind | Filtered? |
|---|---|---|---|
| Ticket detail status picker | `page.tsx:73` → `TicketDetails.tsx:598` | **write** | **Yes** |
| List inline per-row status picker | `TicketList.tsx:235` → `:529` | **write** | **Yes** |
| List status **filter** dropdown | `TicketList.tsx:176` | **read** | **No** |

A ticket can legitimately *be* in a non-selectable status — an MSP agent put it
there. If the filter dropdown were also filtered, portal users could not filter to
find those tickets, which hides their own tickets from them. Restricting what a
user may *set* must not restrict what they may *see*. The filter dropdown keeps
calling the shared `getTicketStatuses`.

### D4 — The picker must still render the ticket's current status

If a ticket sits in a non-selectable status, filtering it out of the detail-page
picker leaves `CustomSelect` with a `value` that matches no option, rendering
blank. `getClientPortalTicketStatuses` therefore takes an optional
`currentStatusId` and returns `portal_selectable = true OR status_id = currentStatusId`.

Re-selecting the current value is a no-op (`onValueChange` only fires on change),
so this does not create an enforcement hole.

### D5 — New statuses default to selectable

Consistent with the migration default and with "no-op on deploy". An admin opting
a board into restrictions will not silently have new statuses locked down.

### D6 — `Switch`, not `Checkbox`

The card suggested a checkbox. The existing per-status boolean controls in that
exact row (`is_closed`, `is_default`) are
`Switch` from `@alga-psa/ui/components/Switch`
(`BoardsSettings.tsx:2395`, `:2403`). Matching the two neighbours it sits beside
matters more than the card's incidental word choice. Passing `id` emits
`data-automation-id` automatically via `withDataAutomationId`.

### D7 — Write persistence goes through the board status actions, not `createStatus`

The card pointed at `statusActions.createStatus`, but ticket statuses are never
written there — that path explicitly rejects them
(`statusActions.ts:110`, `msp/settings:errors.status.manageFromBoard`). The real
write path is `packages/tickets/src/actions/board-actions/boardTicketStatusActions.ts`
(`BoardTicketStatusInput` → `normalizeBoardTicketStatuses` → `buildStatusInsertRow`
/ UPDATE block). The field must be threaded through all of them or it is silently
dropped on save.

## Discovered adjacent defect — MSP server actions are reachable from a portal session

**This is the most significant finding of the investigation and it changes the
scope of the card.**

Without addressing it, the enforcement this card adds is bypassable in about five
minutes, and the plan's central test ("direct call is rejected") would give false
confidence.

### The chain

1. `withAuth` (`packages/auth/src/lib/withAuth.ts:87-109`) checks **session
   presence and tenant only**. It has no `user_type` check and no option for one.
2. `server/src/middleware.ts` gates by URL path prefix (`:483` for `/msp`, `:542`
   for `/client-portal`). A Next.js server action POSTs to *the URL of the page the
   browser is on*, so an action invoked from `/client-portal/tickets/<id>` is
   evaluated against the `/client-portal` branch and passes. The middleware never
   inspects which action is being invoked.
3. The MSP ticket action modules are present in the client-portal page bundles via
   a barrel chain: portal `TicketDetails.tsx:11` imports from
   `@alga-psa/tickets/components`, whose barrel (`packages/tickets/src/components/index.ts:27`)
   re-exports the MSP `TicketDetails`, which imports `updateTicket`,
   `updateTicketWithCache` (`packages/tickets/src/components/ticket/TicketDetails.tsx:58-59`).
   `packages/tickets/package.json` has no `"sideEffects": false` and is transpiled
   from source, so the bundler cannot drop it. The action resolves by direct
   dispatch — no cross-route forwarding, so the middleware is never re-entered.
4. `hasPermission(clientUser, 'ticket', 'update')` returns **true** — the
   permission row is `client: true` (`20250716144947_update_client_portal_permissions.cjs:218`)
   and is granted to the client `User` role. `hasPermission` scopes by the
   *subject's* user_type and has no parameter describing which action is asking
   (`rbac.ts:69-104`), so it cannot distinguish an MSP action from a portal one.
5. The MSP write actions then operate on **any `ticket_id` in the tenant**:
   `updateTicket` (`ticketActions.ts:672`) checks permission at `:686` then fetches
   by tenant only at `:691` — no `client_id` comparison, no visibility check, no
   board/status validation. `bulkUpdateTicketStatus` (`:2043`) does one permission
   check then loops over every ticket ID supplied.

Note the asymmetry: MSP ticket **reads** are correctly scoped for client users
(`ticketActions.ts:2303`, `:1349`, plus `authorizationKernel`). Only the **writes**
are unguarded.

### Scope taken here

Add a `user_type !== 'internal'` rejection ahead of the permission check in the
three actions that can set a status — `updateTicket`, `bulkUpdateTicketStatus`,
`updateTicketWithCache`. This follows established in-repo precedent
(`packages/billing/src/actions/voidInvoiceActions.ts:35`,
`packages/jobs/src/actions/job-actions.ts:186`,
`packages/email/src/actions/emailLogActions.ts:11`). MSP users are unaffected.

### Scope explicitly **not** taken

The same chain reaches many other MSP actions, and the underlying issues — that
`withAuth` cannot express "MSP only", and that MSP ticket writes are tenant-scoped
rather than caller-scoped — are broader than this card. **Recommend a separate
security card** for a systematic audit and for a first-class `withAuth({ mspOnly: true })`
option. Flagged to the XO rather than absorbed here.

## REST API audit — no change required

The card asked whether a portal-authenticated token could PUT a status via
`server/src/lib/api/services/TicketService.ts`. **It cannot.** Four independent
gates, recorded here so this does not need re-auditing:

1. `assertInternalApiUser` (`server/src/lib/api/middleware/apiMiddleware.ts:231-238`)
   rejects any non-`internal` user; called by every ticket controller auth path
   (`ApiTicketController.ts:445, 534, 600, 1315, 1389, 1474, 1561, 1703`).
2. A client-owned API key is rejected and lazily deactivated at validation
   (`apiKeyServiceForApi.ts:209`).
3. Client users cannot mint API keys at all (`apiKeyActions.ts:53-56`).
4. There is no session fallback into `/api/v1/*` (`middleware.ts:390-419`).

Regression coverage already exists (`apiAuthInventory.contract.test.ts`,
`apiMiddleware.clientUserRejection.test.ts`). No work needed.

## Data model

```sql
ALTER TABLE statuses ADD COLUMN portal_selectable BOOLEAN NOT NULL DEFAULT true;
```

`statuses` is a **Citus distributed table**, sharded on `tenant`
(`20260219000001_create_sla_policies.cjs:49`).

Migration approach — a single `ADD COLUMN ... NOT NULL DEFAULT true`, guarded by
`hasColumn`:

- This is the established house style for boolean columns on distributed tables
  (`20260819120000_add_board_pinning_and_list_view_settings.cjs:36`,
  `20260908170000_add_schedule_entry_all_day.cjs`).
- **No select-then-update backfill is needed.** The card pointed at
  `20260421130000_add_show_budget_hours_to_client_portal_config.cjs` as the idiom,
  but that pattern exists for setting *non-uniform per-row* JSONB values. Here the
  column default backfills every row uniformly.
- It also **avoids** the documented Citus failure modes. A separate
  `ALTER ... SET NOT NULL` is what trips Issue 1 and Issue 4 in
  `docs/architecture/citus-migration-best-practices.md` (stranded coordinator heap
  rows → spurious "contains null values"). A single `ADD COLUMN` with a default
  never scans and sidesteps both.
- **One subcommand per `ALTER`** — Citus rejects an ALTER carrying two utility
  subcommands.

Types to update: `IStatus` (`packages/types/src/interfaces/status.interface.ts:8`);
the dead duplicate at `server/src/interfaces/status.interface.ts:5` (kept in sync
to avoid perpetuating drift); `BoardTicketStatusInput` and
`NormalizedBoardTicketStatus` (`boardTicketStatusActions.ts:49`, `:59`);
`ManagedTicketStatus` and its three mappers (`BoardsSettings.tsx:77, 88, 145, 168`);
and the Zod schemas in `server/src/lib/api/schemas/status.ts:10, 30, 42`.

## Enforcement

**Read (presentation).** `getClientPortalTicketStatuses(boardId, currentStatusId?)`
returns board ticket statuses where `portal_selectable = true OR status_id = currentStatusId`.

**Write (authority).** In `updateTicketStatus`
(`client-tickets.ts:785`), extend the existing board-validation `.first()` at `:836`
with `portal_selectable: true`. Keeping it as one query means there is exactly one
place a status can be admitted from, rather than a second check that a later edit
could skip.

Failure returns the existing `expectedClientTicketActionError` shape with a new key
`client-portal:errors.tickets.statusNotPortalSelectable`. Note that the two nearby
throws at `:832` and `:844` are currently **unkeyed** (English-only); keying the
new one correctly is the minimum, and keying those two is a cheap adjacent fix.

Localization happens server-side at the `withAuth` boundary
(`packages/auth/src/lib/localizeActionError.ts:65-87`), so no component changes are
needed to render the message.

## i18n

- Portal error: `errors.tickets.statusNotPortalSelectable` in
  `server/public/locales/en/client-portal.json` (block at `:977-980`).
- Admin label: under `ticketing.boards.fields.ticketStatuses.*` in
  `server/public/locales/en/msp/settings.json` (block at `:622`), alongside
  `closed` (`:631`) and `default` (`:632`). Label: "Client portal users can select
  this status" (column header shortened to "Portal selectable").
- 10 locale dirs (`de, en, es, fr, it, nl, pl, pt, xx, yy`). `xx`/`yy` are
  **generated** by `scripts/generate-pseudo-locales.cjs` — do not hand-edit.
  Parity enforced by `scripts/validate-translations.cjs` via `npm run test:i18n`.

## Risks

| Risk | Mitigation |
|---|---|
| The MSP-action bypass makes enforcement theatre | Guarded in this plan (F019–F021) with a dedicated test (T007) |
| Field silently dropped on save through the board editor | Threaded through all four `ManagedTicketStatus` mappers; covered by T009 |
| Ticket stuck in a non-selectable status renders a blank picker | D4 — current status always included |
| Restricting the list **filter** would hide users' own tickets | D3 — filter dropdown deliberately unfiltered |
| Citus `SET NOT NULL` failure | Single `ADD COLUMN ... DEFAULT` never scans; smoke-tested by `.github/workflows/citus-migration-smoke.yml` |
| Rebase conflict with the contact-scoped-visibility sibling card | Both touch `client-tickets.ts`; whichever lands second rebases. Changes here are localized to `updateTicketStatus` and one new action |

## Acceptance criteria

1. Migration applies cleanly on Postgres and Citus; every pre-existing status has
   `portal_selectable = true`.
2. With all statuses selectable, portal behavior is byte-for-byte what it is today.
3. An admin can toggle the flag per status in the board editor and it persists.
4. Portal detail and list pickers omit non-selectable statuses; the list *filter*
   still shows all.
5. `updateTicketStatus` rejects a non-selectable target when called directly, with
   a localized message.
6. A portal session cannot set a status via `updateTicket`,
   `bulkUpdateTicketStatus`, or `updateTicketWithCache`.
7. Every MSP status read returns all statuses regardless of the flag.
8. A non-selectable closed status blocks portal close; a selectable one still
   closes, with the `enforceTicketCloseRules` bypass intact.
9. `npm run test:i18n` passes.

## Open questions

1. **Board-level "restrict portal statuses" master switch?** Not proposed — per
   status is sufficient and simpler. Flagging in case admin UX prefers an opt-in
   per board.
2. **Should the MSP-action guard ship in this card or as its own PR?** It is
   required for correctness here, but it is a security fix with a different blast
   radius. Recommend a separate commit within this branch so it can be cherry-picked.
3. **Key the two adjacent unkeyed errors at `:832`/`:844`?** Cheap and clearly
   right; included as F017 but easily dropped.
