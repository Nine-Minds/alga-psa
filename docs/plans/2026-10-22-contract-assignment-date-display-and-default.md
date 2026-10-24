# Client contract assignment dates: off-by-one display and UTC today default

Status: design of record for the Design Session step. Decisions here are binding for Draft Implementation.

# Client contract assignment dates: one calendar-date rule

Scope: assignment start/end dates displaying a day early in the client Billing view,
and the assignment dialog opening on a UTC "today".

## Corrections to the card's analysis

1. **The value is not a date-only string at the client.** `client_contracts.start_date`
   is `table.timestamp('start_date')` — `timestamp without time zone`
   (`server/migrations/20251008000001_rename_billing_to_contracts.cjs:250-251`), never
   altered to `date`. `packages/db/src/lib/knexfile.ts:28` installs
   `setTypeParser(1114, str => new Date(str + 'Z'))`, so reads yield a **`Date` at UTC
   midnight**. Mechanism right, input type wrong — and that matters: `formatDateValue`
   does not take its date-only branch for a `Date`
   (`packages/ui/src/lib/i18n/formatDateValue.ts:130`, asserted at
   `formatDateValue.timezone.test.ts:62`).
2. **`ContractDetail` is not fully right.** Its `formatDate`
   (`packages/billing/src/components/billing-dashboard/contracts/ContractDetail.tsx:114-127`)
   anchors at **UTC** noon: correct west of UTC, wrong at UTC+13/+14
   (`Pacific/Auckland` in DST, `Pacific/Kiritimati`). Core's `toCalendarDisplayDate`
   (`packages/core/src/lib/dateTimeUtils.ts:86`) anchors at *local* noon and is correct
   in every offset. "Adopt the existing helper" means that one, not this copy.
3. **The dialog shows today for a second reason.** `typeof initialStartDate === 'string'`
   (`ClientContractDialog.tsx:64`, `:94`) is false for the `Date` it receives, so it
   discards the real date and falls through to
   `new Date().toISOString().split('T')[0]` (`:65`, `:96`). The UTC default is a separate
   defect; both must be fixed.

Also: `packages/clients/src/models/clientContract.ts:34-45` holds a drifted
`normalizeDateOnly` accepting **only** strings, so for real rows it returns `undefined`
and `decision_due_date`/`assignment_status`/`evergreen_review_anchor_date` are computed
with no dates; the maintained copy (`shared/…/clientContracts.ts:32-45`) handles `Date`.

## The canonical rule

1. **Storage.** Date-only fields live in `timestamp` columns but carry no time. Treat
   them as calendar dates, never instants.
2. **Boundary.** Every server read emits `YYYY-MM-DD` (or `null`) for a date-only field.
   The types already claim `ISO8601String` (`packages/types/src/lib/temporal.ts:3`).
3. **Parse.** Never `new Date('YYYY-MM-DD')`. Use `toPlainDate` /
   `toCalendarDisplayDate` from `@alga-psa/core` (`dateTimeUtils.ts:203`, `:86`), or
   `dateFromString` for `DatePicker` values (`packages/ui/src/lib/dateInput.ts:7-10`).
4. **Format.** In React: `useFormatters().formatDate(value, options)`
   (`packages/ui/src/lib/i18n/client.tsx:525-531` → `formatDateValue.ts:124-150`). It
   forces `timeZone: 'UTC'` for `YYYY-MM-DD`, is tenant-country ordered via
   `DateFormatProvider` (`server/src/app/msp/MspLayoutClient.tsx:249`), and handles real
   instants. Without a hook: `formatCalendarDate` from `@alga-psa/core`
   (`dateTimeUtils.ts:106`).
5. **Serialize.** `toCalendarDateString` (`dateTimeUtils.ts:134`) or `dateToString`
   (`ui/lib/dateInput.ts:19`).
6. **Defaults.** `getCurrentDateInUserTimeZone()` (`dateTimeUtils.ts:250`).

No new helper. Four private re-implementations of rule 4 get deleted, not extended:
`Contracts.tsx:54-64`, `ContractHeader.tsx:44-56`, `ClientContractsTab.tsx:300-315`,
`ContractDetail.tsx:114-127`.

## API/DB boundary (verified)

| Layer | Today | Target |
|---|---|---|
| Column | `timestamp` at `00:00:00` | unchanged |
| pg driver | `Date` @ **server-local** midnight (`client_contracts` dates are DATE columns, no 1082 parser); read with local getters | unchanged |
| `normalizeClientContract` | computes `normalizeDateOnly` at `shared/…/clientContracts.ts:259-260` and `models/clientContract.ts:240-241` but **never assigns it back** | assigns `start_date`/`end_date` as strings |
| Wire type | declared `ISO8601String`, actually `Date` | `YYYY-MM-DD \| null` |

The fix depends on this: once the boundary emits strings, `formatDate`'s date-only
branch handles the columns and every consumer (`DatePicker`, `toPlainDate`, string
comparison) sees one representation.

Genuine `date` columns are **not** in this class: pg has no type-1082 parser
(`server/src/lib/api/services/TimeSheetService.ts:50-54`), so they arrive as
local-midnight `Date` and `.toLocaleDateString()` renders them correctly. Do not
"fix" those.

## What changes

**Server**

1. `shared/billingClients/clientContracts.ts:226-300` — after `:259-260` assign the
   normalized values onto the row (`start_date` when defined; `end_date` when defined or
   null). This is the single read-boundary fix.
2. `packages/clients/src/models/clientContract.ts:207-289` — delete this copy plus its
   private helpers (`:34-205`) and import `normalizeClientContract` from
   `@alga-psa/shared/billingClients/clientContracts`. Verified: exported from models but
   imported nowhere else; shared already exports the compute helpers. If split into its
   own PR, leave `// LEVERAGE: pattern normalize-client-contract — second copy`.
3. `models/clientContract.ts:574` and `shared/…/clientContracts.ts:637` compare
   `updateData.start_date !== existing.start_date`; with a `Date` on one side that is
   always true, so every update of an active assignment can trip "Start date cannot be
   changed for active contracts". Confirm with a test; step 2 makes it a correct string
   comparison. Do not otherwise restructure the update path.

**Client**

4. `ClientContractAssignment.tsx:218-224` — delete `formatDate`, use
   `useFormatters().formatDate`. Keep the Ongoing label at the two columns (`:337`,
   `:342`): `value ? formatDate(value) : t('clientContractAssignment.ongoing', …)`.
   `getRenewalSummary` (`:226-246`) uses the same call.
5. `ClientContractDialog.tsx:63-66` and `:92-96` — default to
   `getCurrentDateInUserTimeZone()` and drop the `typeof === 'string'` rejection. The
   prop stays `string`, now guaranteed by the boundary. The `DatePicker` wiring
   (`:252-260`, `:278-287`) already round-trips through `dateFromString`/`dateToString`
   and does not change.
6. Migrate the four private copies. `ContractDetail.tsx:1812`/`:1816` render
   `created_at`/`updated_at` — real instants that the current `toPlainDate` path renders
   as the **UTC** date; `formatDate` fixes those too. `Contracts.tsx` drops its
   `locale` parameter.

**Other same-pattern sites (separate PR).** `new Date(x).toLocaleDateString()` is broken
only when `x` is date-only *and* timestamp-backed. Candidates: `CreditExpirationInfo.tsx:136`,
`TaxComponentEditor.tsx:289,292` (real `date` column — check first),
`client-portal/…/ProjectDetailView.tsx:231,239` (verify column). Find them with
`rg "new Date\([^)]*\)\.toLocaleDateString\(" packages`.

## The dialog default: which "today"

**Chosen: the browser-local calendar day**, via `getCurrentDateInUserTimeZone()` — the
day the `DatePicker` beneath it shows and the day the user means by "today", via an
existing helper. No tenant IANA zone is reachable from the client tree
(`toCalendarDateStringInTimeZone` is server-only, e.g.
`client-portal/src/actions/client-portal-actions/client-billing.ts:1406`). Rejected: a
server-computed tenant-local today passed as a prop — that pipes tenant settings into
every contract dialog for a value that is only a *default*, visible in the picker and
overridable before save.

Consequence: a user in Tokyo assigning for a US-West tenant gets Tokyo's today. Still
one unambiguous calendar day, on screen before save; the current UTC default is worse
because it is invisible and can be a day ahead.

## Order of work

1. Server boundary: assign normalized dates in `shared/…/clientContracts.ts` and delete
   the `models/clientContract.ts` copy. Tests first — these own the contract everything
   else relies on.
2. Formatting: `ClientContractAssignment.tsx`, then the four copies.
3. Dialog default + dropped string guard.
4. Fix/verify the `start_date !== existing.start_date` comparison.
5. Class sweep in a separate PR, classify-first.

## Non-goals

- No migration of `client_contracts.start_date`/`end_date` to `date`, no data rewrite;
  existing UTC-midnight values already read as the intended day.
- No change to billing calculations, service-period math, recurrence, or
  `deriveClientContractStatus`. No global pg type-parser change. No `DatePicker` or
  `dateInput.ts` change.


## Risks

- **Date-only vs datetime.** `created_at`/`updated_at` are true instants in the same
  rows and must not be routed through calendar-date handling; after the boundary fix
  they are the only `Date` values left, so mistakes surface instead of hiding.
- **Half a fix.** Client-only leaves `ISO8601String` a lie; server-only leaves the
  dialog's string guard discarding the value.
- **Hydration.** `formatDate` reads `DateFormatProvider`, resolved server-side from the
  tenant country, so both passes agree. `getCurrentDateInUserTimeZone()` reads the
  browser zone — call it in the open/reset effect (`:92`), which is client-only.
- **Noon anchor flavour.** Keep `toCalendarDisplayDate` (local noon); do not propagate
  `ContractDetail`'s UTC-noon variant.
- **Stale test mocks.** `ClientContractAssignment.test.tsx:67-71` mocks the i18n client
  with `useTranslation` only — adding `useFormatters` breaks it until the mock exports
  it. Fixtures already use `'2026-01-01'` (`:151`, `:246`, `:254`).

## Test plan

Existing files to extend:
`packages/clients/src/components/clients/ClientContractAssignment.test.tsx`,
`packages/billing/tests/clientContractEffectiveRenewalSettings.test.ts`,
`packages/core/src/lib/dateTimeUtils.test.ts`,
`toCalendarDateString.test.ts`, `formatDateValue.timezone.test.ts`. No
`ClientContractDialog` test exists — add one.

1. **Boundary (unit).** `normalizeClientContract({ start_date: new Date('2026-04-01T00:00:00Z'), end_date: null })`
   returns `start_date === '2026-04-01'` plus `decision_due_date`/`assignment_status`
   derived from it, under `TZ=America/Los_Angeles`.
2. **Date-only render.** Same TZ, row `start_date: '2026-04-01'` → cell reads 4/1/2026,
   not 3/31. Repeat with a UTC-midnight `Date` to prove the boundary protects the view.
3. **End-date column.** `end_date: '2026-12-31'` renders 12/31 under
   `TZ=Pacific/Auckland` (UTC+13 in DST) — catches the UTC-noon variant.
4. **Null end date.** Still "Ongoing" in both columns and in the renewal summary.
5. **Dialog default, US-West evening.** `TZ=America/Los_Angeles`, clock
   `2026-08-26T02:30:00Z` (8/25 19:30 local) → field is `2026-08-25`; today's code yields
   `2026-08-26`. This is the regression test for the card's "08/25" observation.
6. **Dialog edit path.** `initialStartDate='2026-03-31'`, open plus effect re-run → field
   reads `2026-03-31`, never today.
7. **Instant path.** A `created_at` instant renders the viewer's local day, confirming
   the instant/calendar split was not collapsed.
