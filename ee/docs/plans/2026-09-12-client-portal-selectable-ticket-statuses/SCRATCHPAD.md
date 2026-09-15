# Scratchpad — client portal selectable ticket statuses

Working memory for this effort. Card: `2af7e061-ee33-4c03-a042-0c80fd1a2041`.
Branch `feature/client-portal-restrict-which-ticket-statuses-por`, dev port 3258.

## Status

Implemented on branch `feature/client-portal-restrict-which-ticket-statuses-por`.
`features.json` marks every feature implemented except **F017** (keying the two
adjacent unkeyed `updateTicketStatus` errors), which was deliberately dropped as
the plan permitted. `tests.json` marks T001–T012 implemented.

Review round 1 additions: `updateBoard` and all `boardTicketStatusActions` write
entry points now enforce `ticket_settings:update` before mutating status
configuration; the portal detail picker re-derives its options from the current
status so a restricted status drops out after the ticket leaves it; DB-backed
T008–T010 run against an isolated `portal_selectable_test_db`; T011 is covered by
a TicketList source contract.

---

## Verified against the tree (not assumed)

All of the card's factual claims about current state were re-checked and hold:

- `updateTicketStatus` at `client-tickets.ts:785` checks permission (`:808`),
  visibility via `resolveVisibleTicket` (`:823`), and board membership (`:835-844`).
  **No check on which status.** Confirmed by reading the action.
- `getTicketStatuses` (`statusActions.ts:83`) has no portal awareness.
- `IStatus` (`packages/types/.../status.interface.ts:8`) has no portal field.
- The close-rules bypass comment is at `:857` and is real.

---

## Discoveries that changed the plan

### 1. The MSP server actions are reachable from a portal session (biggest finding)

`withAuth` (`packages/auth/src/lib/withAuth.ts:87-109`) checks session + tenant
only — **no `user_type` check, and `WithAuthOptions` (`:50-56`) has no option for
one** (its only field is `allowUnauthenticated`).

Middleware gates by URL prefix (`middleware.ts:483` `/msp`, `:542` `/client-portal`).
A Next.js server action POSTs to the URL of the page the browser is on, so an
action fired from a `/client-portal/...` page is evaluated against the client-portal
branch and passes. The middleware reads the `next-action` header (`:299`) but only
for a dev-mode 409 (`:308`) and an unauthenticated passthrough (`:502`) — it never
maps the action ID to an owning route.

Why the Next worker map doesn't save us: the MSP action modules are physically in
the client-portal page bundles via a barrel chain —
`portal TicketDetails.tsx:11` → `@alga-psa/tickets/components` barrel
(`packages/tickets/src/components/index.ts:27`) → MSP `TicketDetails.tsx:58-59`
which imports `updateTicket` / `updateTicketWithCache`. `packages/tickets/package.json`
has no `"sideEffects": false` and is transpiled from source (`next.config.mjs:506`),
so the barrel can't be shaken. Direct dispatch, no cross-route forwarding, so
middleware is never re-entered.

`hasPermission(clientUser, 'ticket', 'update')` → **true**: the row is `client: true`
(`20250716144947_...cjs:218`), granted to the client `User` role, and `rbac.ts:69-104`
scopes by the *subject's* user_type with no parameter for which action is asking.

Then `updateTicket` (`ticketActions.ts:672`) fetches by tenant only (`:691`) — no
`client_id` check, no visibility check. `bulkUpdateTicketStatus` (`:2043`) does one
permission check then loops over every supplied ticket ID.

**Asymmetry worth remembering:** MSP ticket *reads* ARE correctly scoped for client
users (`ticketActions.ts:2303`, `:1349`, `authorizationKernel`). Only the writes are open.

**Not empirically confirmed** — there is no `.next` build in this worktree, so the
generated manifest wasn't read. To verify before relying on it:
```
cd server && npm run build
jq 'keys' server/.next/server/server-reference-manifest.json
# then check the workers map for the updateTicket action id contains
# app/client-portal/tickets/[ticketId]/page
```
The conclusion follows from the import chain + no `sideEffects` + `transpilePackages`,
which is strong, but confirm it before writing T007's assertions.

Scope taken: guard the three status-writing actions (F019–F021). Scope refused:
the general audit + a first-class `withAuth({ mspOnly: true })`. **Escalated to XO
as a separate security card** — the cross-client write exposure is much bigger than
this card.

Precedent for the guard shape (there is no shared helper; it's re-implemented
ad hoc ~181 times across packages):
- `packages/billing/src/actions/voidInvoiceActions.ts:35-37` — inline `user_type === 'client'` return, before `hasPermission`
- `packages/jobs/src/actions/job-actions.ts:186-188`
- `packages/email/src/actions/emailLogActions.ts:11-15` — per-file `assert` fn
- `packages/clients/src/lib/authHelpers.ts:22/35/47` — package-local `isMspUser` / `assertMspPermission`

A missing shared layer. Candidate `// LEVERAGE: pattern msp-only-action` marker
when touching F019–F021.

### 2. There are THREE portal status call sites, not one

The card only mentions the detail page. Full set:

| file:line | call | kind | action |
|---|---|---|---|
| `app/client-portal/tickets/[ticketId]/page.tsx:73` | `getTicketStatuses(board_id)` | write picker | filter |
| `TicketList.tsx:235` | `getTicketStatuses(boardId)` per board | write picker (inline row dropdown, `:529-548`) | filter |
| `TicketList.tsx:176` | `getTicketStatuses()` **no boardId** | read filter dropdown | **leave alone** |

The third one is the interesting one — see D3 in the PRD. Filtering it would hide
portal users' own tickets whenever an MSP agent parks one in a restricted status.

### 3. Blast radius of the shared action: 15 MSP call sites vs 3 portal

Settles D2 (new portal action, don't branch inside the shared one). MSP callers
include `QuickAddTicket.tsx:495`, `TicketInfo.tsx:423`, `BentoHero.tsx:414`,
`CreateTicketFromAssetButton.tsx:121`, `ContractDetail.tsx:449`,
`RenewalAutomationSettings.tsx:121`, `PrefillFromTicketDialog.tsx:128`,
`TaskTicketLinks.tsx:238`, `surveyActions.ts:673`, `TicketsSection.tsx:87`,
`service-requests/actions.ts:196`, plus `getStatuses` callers.
`packages/tickets/src/components/ticket/TicketDetails.tsx:70` imports it but never
calls it — dead import.

### 4. Mobile reads statuses through a different path entirely

`ee/mobile/src/api/tickets.ts:223` → `GET /api/v1/tickets/statuses` →
`server/src/app/api/v1/tickets/statuses/route.ts:23-53`, which queries the
`statuses` table **directly**, bypassing `statusActions`. It's an MSP-technician
app and should keep seeing everything — which it does for free, since we're not
touching the shared action or that route.

### 5. The card pointed at the wrong write path for the admin UI

Ticket statuses are never written through `statusActions.createStatus` — that path
explicitly rejects them (`statusActions.ts:110`). Real path:
`packages/tickets/src/actions/board-actions/boardTicketStatusActions.ts`
(`BoardTicketStatusInput:49` → `normalizeBoardTicketStatuses:87` →
`buildStatusInsertRow:189` / UPDATE `~:285`), driven by `updateBoard`/`createBoard`
carrying `ticket_statuses[]`.

The field has to be threaded through **four** `ManagedTicketStatus` mappers in
`BoardsSettings.tsx` (`:77`, `:88`, `:145`, `:168`) or it is silently dropped on
save — which unit mocks will not catch. That's why T009 is DB-backed.

### 6. The existing per-status boolean control is `Switch`, not `Checkbox`

`BoardsSettings.tsx:2395` (`is_closed`) and `:2403` (`is_default`) both use
`Switch` from `@alga-psa/ui/components/Switch`. The card said checkbox; matching
the two neighbours wins. `Checkbox` is also imported in that file (`:54`) and used
elsewhere, so either compiles — this is a consistency call, not a constraint.

Row ids follow `inline-ticket-status-{closed,default}-${index}`; passing `id`
auto-emits `data-automation-id` via `withDataAutomationId`. ESLint
`custom-rules/check-required-props` enforces `id` on `Button` specifically.

Grid at `:2383` is `md:grid-cols-[minmax(0,1fr)_auto_auto_auto]` — needs a 5th track.

### 7. REST API needs nothing — four gates, documented so nobody re-audits

1. `assertInternalApiUser` — `apiMiddleware.ts:231-238`, called from all 8 inline
   auth paths in `ApiTicketController.ts` (`445, 534, 600, 1315, 1389, 1474, 1561, 1703`)
2. client-owned API keys rejected + lazily deactivated — `apiKeyServiceForApi.ts:209`
3. client users can't mint keys — `apiKeyActions.ts:53-56`
4. no session path into `/api/v1/*` — `middleware.ts:390-419`

Existing regression coverage: `apiAuthInventory.contract.test.ts`,
`apiKeyServiceForApi.clientOwner.test.ts`, `apiMiddleware.clientUserRejection.test.ts`.

TicketService status write sites, for reference if this ever changes:
`TicketService.ts:1467` (create), `:1695` (update — primary), `:1720/:1726/:1730`
(closure side-effects), `:1865` (from asset). No bulk method exists;
`ApiTicketController.updateStatus` is a wrapper over `update` (`:1508`).

---

## Migration notes

`statuses` is **distributed on `tenant`** — `20260219000001_create_sla_policies.cjs:49`
(`distributeIfCitus(knex, 'statuses')` → `create_distributed_table('statuses','tenant')`).
Not a reference table. (`standard_statuses` IS a reference table —
`20260610150000_make_standard_statuses_global.cjs:277` — don't confuse them.)

**Do NOT use the select-then-update backfill idiom** the card pointed at
(`20260421130000_add_show_budget_hours_to_client_portal_config.cjs`). That exists
for non-uniform per-row JSONB values. Here the column default backfills uniformly.

Use the house style:
```js
exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('statuses', 'portal_selectable'))) {
    // One subcommand per ALTER: Citus rejects an ALTER carrying two utility
    // subcommands with "cannot execute multiple utility events".
    await knex.schema.alterTable('statuses', (table) => {
      table.boolean('portal_selectable').notNullable().defaultTo(true);
    });
  }
};
```
Models: `20260819120000_add_board_pinning_and_list_view_settings.cjs:36`,
`20260908170000_add_schedule_entry_all_day.cjs`.

**Avoid** a separate `ALTER ... SET NOT NULL` and avoid Knex `.alter()` on a
distributed table — that combination is Issues 1 and 4 in
`docs/architecture/citus-migration-best-practices.md` (stranded coordinator heap
rows after `create_distributed_table` on a non-empty table → spurious "contains
null values"). The counter-example
`20260329120000_add_enable_live_ticket_timer_to_boards.cjs:10-25` uses the
add-nullable→backfill→`.alter()` split; it's the older, riskier style — don't copy it.

`exports.config = { transaction: false }` is **not** needed for a plain ADD COLUMN.

Filename: latest in `server/migrations` is `20260909150000_drop_stale_email_template_unique.cjs`.
Use `20260912120000_add_portal_selectable_to_statuses.cjs` (14-digit, lowercase, `.cjs`).

CI runs `.github/workflows/citus-migration-smoke.yml` against single-node
`citusdata/citus:12.1` and asserts the distributed-table count — this migration
gets smoke-tested there automatically.

---

## Test harness notes

**`client-tickets.boardStatusValidation.test.ts` is a pure Vitest unit test — no
database.** 228 lines, 2 tests (T041 default-status-on-create, T042 wrong-board
rejection). Knex is a hand-rolled callable `trx` factory; nothing is seeded; the
tenant is the literal string `'tenant-1'`.

Gotchas when extending it:
- The action is imported lazily *inside* each test (`await import('./client-tickets')`
  at `:183`, `:220`) so `vi.mock` factories apply first. Keep that.
- The `trx` factory **throws `Unexpected table: ${table}`** (`:144`) for any table
  without a branch. The existing `statuses` branch (`:136-142`) returns a
  `.where().first()` shape — a new *list* action needs a `select`/`orderBy`-capable
  builder, so that branch has to be extended, not reused as-is.
- Mocked modules that must stay: `@alga-psa/auth`, `@alga-psa/db`,
  `@alga-psa/validation`, `@shared/models/ticketModel`, `@alga-psa/event-bus`(+`/publishers`),
  `@alga-psa/analytics`, `@alga-psa/formatting/blocknoteUtils`,
  `@alga-psa/tickets/actions/ticketBundleUtils`, `@alga-psa/tickets/lib/liveUpdates`,
  `@alga-psa/user-composition/actions`.

T001–T007 fit this mock harness. **T008/T009/T010 must be DB-backed** — the
silent-drop failure mode in the normalize/insert chain is exactly what mocks hide.
Harness to copy: `server/src/test/integration/boardSpecificTicketStatusesMigration.integration.test.ts`
(`createTestDbConnection` from `../../../test-utils/dbConfig`, `require` the
migration file by path, `HOOK_TIMEOUT = 180_000`, tenant cleanup sets).
Also relevant: `ticketCreateBoardStatusValidation.integration.test.ts`.

---

## i18n notes

- Portal errors: namespace `client-portal`, file `server/public/locales/en/client-portal.json`,
  block `errors.tickets` at **:977-980** (currently only `notFoundOrDenied`,
  `invalidData`). New key goes here.
- `expectedClientTicketActionError(message, messageKey?, messageParams?)` is defined
  in the same file at `client-tickets.ts:69-75`. **13 of its call sites pass no key**
  (English-only), including `:832` and `:844` — the two right next to our change.
- Localization happens server-side at the `withAuth` boundary —
  `packages/auth/src/lib/localizeActionError.ts:65-87`. Components receive an
  already-localized string, so **no component changes are needed** to render the
  new message. Portal consumers: `TicketDetails.tsx:534-554` (banner `:558-562`),
  `TicketList.tsx:404-426`, `page.tsx:57-71`.
- Admin labels: namespace `msp/settings`, `ticketing.boards.fields.ticketStatuses.*`
  at `msp/settings.json:622`; siblings `statusName` (:630), `closed` (:631),
  `default` (:632).
- **10 locale dirs**: `de en es fr it nl pl pt xx yy`. `xx`/`yy` are pseudo-locales
  **generated** by `scripts/generate-pseudo-locales.cjs` — never hand-edit.
  Parity enforced by `scripts/validate-translations.cjs`; run `npm run test:i18n`.

---

## Type sites to touch

1. `packages/types/src/interfaces/status.interface.ts:8` — canonical `IStatus`
2. `server/src/interfaces/status.interface.ts:5` — byte-identical duplicate except
   it lacks the `StatusItemType` alias. **Effectively dead**: nothing imports
   `IStatus` from it (all 32 real import sites use `@alga-psa/types`), but the file
   can't be deleted because `server/src/interfaces/project.interfaces.ts:4` still
   pulls `ItemType`/`IStatus`/`IStandardStatus` from it. Keep in sync rather than
   deepening the drift. There's a contract test guarding the sibling duplication
   pair: `server/src/test/unit/interfaces/projectStatusPhaseId.contract.test.ts:21-22`.
   → `// LEVERAGE: friction duplicate-status-interface` candidate.
3. `boardTicketStatusActions.ts:49` `BoardTicketStatusInput`, `:59` `NormalizedBoardTicketStatus`
4. `BoardsSettings.tsx:77` `ManagedTicketStatus` + mappers `:88`, `:145`, `:168`, `:743`
5. `server/src/lib/api/schemas/status.ts:10/30/42` Zod create/update/response
   (note: response schema already omits `board_id`, `color`, `icon` — pre-existing drift)

Not touching: `ee/mobile/src/api/tickets.ts:101 TicketStatus` (separate DTO,
doesn't need the field), project-status shapes in
`packages/projects/src/schemas/project.schemas.ts:25` and its duplicate at
`server/src/lib/schemas/project.schemas.ts:25`.

---

## Open items to resolve before/while implementing

1. Confirm the server-reference-manifest claim empirically (see §1 command) before
   writing T007.
2. Decide whether F019–F021 ship as a separate commit on this branch so the
   security fix can be cherry-picked independently. Recommended.
3. Confirm with the XO that the broader MSP-action audit is being tracked as its
   own card and is not expected here.
4. Sibling card "Contact-scoped ticket visibility" also edits `client-tickets.ts`.
   Whichever lands second rebases. Our footprint is `updateTicketStatus` + one new
   action, so the conflict should be small.
