# Hour block / contract-line overlap warning — implementation plan

Card 2424ab84 · PSA ticket alga-2026-0002696 · base `a65fccb78c` (main)

## Problem, grounded in code

`shared/billingClients/hourBlockService.ts` decides whether a time entry draws hour blocks:

- Header (:14-18): blocks only take billable time that isn't matched to a contract line. Contracts always win.
- `getEligibleContractLineCountForServiceAtDate` (:147-170) counts distinct `contract_lines` reached by
  `client_contracts (client_id, is_active, start_date <= d, end_date null or >= d)` → `contracts` →
  `contract_lines` → `contract_line_services (service_id)`.
- `isEntryEligibleForBlockBurn` (:182-207): an entry is ineligible when it has a `contract_line_id`, or when the
  count above is exactly 1 (the billing engine then assigns it to that line deterministically).

That gives three outcomes for a block service S:

| Lines covering S on the work date | Entry with no `contract_line_id` | Entry with `contract_line_id` |
|---|---|---|
| 0 | draws the block | n/a |
| exactly 1 | bills through the line, does not draw | does not draw |
| 2 or more | draws the block | does not draw |

That is why the card has two messages. With one line, *all* time on S skips the block. With several lines, only
time someone assigned to a line skips it.

Nothing in `SellHourBlockDialog.tsx`, `GrantHourBlockDialog.tsx`, `HourBlocksSection.tsx` or
`HourBlockDetailDrawer.tsx` reads contract data today.

## Key decisions

1. **One query, two callers.** Move the join chain and the `client_contracts` activity predicate out of
   `getEligibleContractLineCountForServiceAtDate` into a private builder,
   `coveringContractLinesQuery(db, clientId, { serviceIds, from, to })`. It uses the overlap form
   `cc.start_date <= to AND (cc.end_date IS NULL OR cc.end_date >= from)`. With `from = to = workDate`, that is
   the same SQL as today's point-in-time predicate, so burn behaviour does not change. The count function becomes
   a thin wrapper (`countDistinct` over the builder). The new read helper uses the same builder with a date range
   and selects names. The rule is written once, so there is no second copy to drift. Existing burn DB tests guard
   the refactor.
2. **Classify from the burn rule, not from a raw line count.** For each service, the helper returns the covering
   lines (with their `client_contracts` date ranges, clipped to the window) and `assignment`:
   - `'automatic'`: no two distinct lines' ranges overlap inside the window. On every covered date, the count
     is exactly 1, so `isEntryEligibleForBlockBurn` would reject every entry. This uses the one-line copy, listing
     each line. Lines that follow each other in time are still `automatic`. A plain "lines > 1" check would get
     this wrong and show the "assigned" copy.
   - `'when_assigned'`: at least two lines overlap on some date. This uses the multi-line copy.
   The classification is a pure exported function, `classifyContractLineCoverage(rows, window)`, so it can be
   unit-tested without a DB.
3. **Coverage window.** `from` = the tenant's today, computed with `resolveEffectiveTimeZone` +
   `toCalendarDateStringInTimeZone`, the same way `getAvailableHourBlockMinutes` does at :566-567. `to` = the
   block's `expiration_date`, or `from + 12 months` when there is no expiry. A line that ended before today is
   excluded. A line that starts after `to` is excluded. A line active today, or starting before `to`, is included.
4. **Which services are checked.**
   - Scoped block: the scope services plus the sold-as service, as the card asks ("the block's service, or any
     service in its scope"). The sold-as service only matters if it is in scope. Including it anyway is harmless:
     the warning stays true, and it catches the case where the MSP expects the sold-as service to draw.
   - Unscoped block (all labor): no service filter. The helper returns every service covered by a contract line
     in the window, and the UI lists them.
5. **Only active contract associations count, matching the burn rule.** The filter is `cc.is_active` plus dates.
   No extra `contracts.status` or `contract_lines.is_active` filter is added here. Adding one would fork the rule.
   If the burn rule should honour those columns, that is a change to the shared builder, and both callers pick it
   up.
6. **The warning never blocks.** It is an `Alert variant="warning"` placed above the error alert. The submit
   button keeps its current `disabled={submitting}`. There is no confirmation step, and the server actions
   `createHourBlockPurchaseInvoice` and `grantHourBlock` do not change.
7. **Existing blocks are flagged on `active` and `pending` blocks with `remaining_minutes > 0`.** The card says
   "active". Pending blocks (a draft invoice not yet finalized) are included because finalizing activates the same
   problem, and the MSP can still void the draft. Expired and voided blocks, and blocks with no hours left, get no
   badge.
8. **Coverage is computed on the server and returned with the block.** `listHourBlocks` and `getHourBlockDetail`
   attach `contract_coverage` to each eligible block. For the list, one query loads the client's covering lines
   over the widest window, and each block is then classified in JS against its own window. That is 1 extra query
   per list, not N.
9. **Contract link.** The link goes to `/msp/billing?tab=client-contracts&contractId={contract_id}&clientContractId={client_contract_id}`,
   the same URL `ClientContractsTab.navigateToContract` builds (`ClientContractsTab.tsx:269-283`). Inside the
   dialogs it opens in a new tab so the half-filled form is kept.
10. **All locales, not just en.** CI has a "Missing locale keys" gate (see commit `4ce2365183`). New keys go into
    en with the copy below. de/es/fr/it/nl/pl/pt/sv get translations that use each pack's existing block term, and
    the xx/yy pseudo-locales are regenerated (`scripts/generate-pseudo-locales.cjs`). Then run
    `node scripts/validate-translations.cjs`.

## Changes, in order

### 1. Shared service: `shared/billingClients/hourBlockService.ts`

- Header (:1-28): add `getContractLineCoverageForClient` and `classifyContractLineCoverage` to the list of
  canonical exports, with a note that they read the same coverage rule the burn uses.
- New private `coveringContractLinesQuery(db, clientId, { serviceIds?: string[] | null; from: string; to: string })`
  next to :147. It holds the joins and predicates moved out of `getEligibleContractLineCountForServiceAtDate`.
  `serviceIds` null or omitted means no service filter (the unscoped case).
- `getEligibleContractLineCountForServiceAtDate` (:147-170): its body becomes
  `coveringContractLinesQuery(db, clientId, { serviceIds: [serviceId], from: workDate, to: workDate }).countDistinct(...)`.
  The signature and doc comment stay as they are.
- New exported types: `ContractLineCoverageLine { contract_id, contract_name, client_contract_id, contract_line_id, contract_line_name, start_date, end_date }`
  and `ServiceContractLineCoverage { service_id, service_name, assignment: 'automatic' | 'when_assigned', lines: ContractLineCoverageLine[] }`.
  Put them in `packages/types/src/interfaces/hourBlock.interfaces.ts` so the UI can import them, and re-export
  from types `index.ts` if `IHourBlock` is exported there.
- New exported `getContractLineCoverageForClient(conn, tenant, clientId, { serviceIds, expirationDate, today? })`:
  - resolves the window (decision 3); `today` can be injected for tests
  - reads rows from the builder, left-joining `service_catalog` for `service_name` and selecting
    `c.contract_name`, `cc.client_contract_id`, `cl.contract_line_name`, `cc.start_date`, `cc.end_date`
  - normalises dates with the module's `toDateOnly` (:102), never `toISOString`
  - returns `classifyContractLineCoverage(rows, { from, to })`
- New exported pure `classifyContractLineCoverage(rows, window)`: groups rows by service, dedupes lines, and sets
  `assignment` using decision 2. Output is sorted by service name, then contract name and line name, so the UI is
  deterministic.
- Add `// LEVERAGE: pattern tenant-today — ...` at the new tenant-today call and at :566/:631. This is the third
  copy of the `resolveEffectiveTimeZone` → today snippet in the module. Do not extract it on this card.

### 2. Server action: `packages/billing/src/actions/hourBlockActions.ts`

- Import the new helper next to `getAvailableHourBlockMinutes` (:17).
- New `getHourBlockContractCoverage = withAuth(async (user, { tenant }, input: { clientId; serviceId; scopeServiceIds: string[]; expirationDate: string | null }))`:
  - checks `billing:read`, the same permission as `listHourBlocks`
  - wrapped in `withHourBlockActionErrors`
  - service set: empty `scopeServiceIds` means `null` (all labor); otherwise `[...scope, serviceId]`, deduped
  - returns `{ unscoped: boolean; services: ServiceContractLineCoverage[] }`
- `listHourBlocks` (:666-721): after loading scopes, for blocks that are active or pending with
  `remaining_minutes > 0`, call the helper once with `serviceIds: null` and the widest expiration (any
  `null` → +12 months). Then, per block, filter rows to the block's service set and window, and run
  `classifyContractLineCoverage`. Attach the result as `contract_coverage` (an empty array when there is none).
- `getHourBlockDetail` (:725-811): call the helper for the one block, using the same eligibility and service
  set, and attach `contract_coverage` to the returned `block`.
- `IHourBlock` (`hourBlock.interfaces.ts`): add an optional
  `contract_coverage?: ServiceContractLineCoverage[]` field, documented as a display-only join.

### 3. Shared UI piece: `packages/billing/src/components/hour-blocks/HourBlockCoverageNotice.tsx` (new)

- `buildCoverageMessages(t, coverage, { unscoped })` builds strings from translation keys (decision 1 / copy
  below):
  - scoped service with `automatic`: one line per covering line, `coverage.oneLine`
  - scoped service with `when_assigned`: `coverage.manyLines`, followed by the list of lines
  - unscoped: `coverage.unscopedIntro`, then one bullet per service (`coverage.unscopedService`), each naming its
    contract / line, or "assigned contract lines" for `when_assigned`
- `<HourBlockCoverageNotice coverage unscoped variant="alert" | "badge" />`:
  - `alert`: `Alert variant="warning"` that renders the messages, with each contract name linked (decision 9).
    Used by both dialogs and the drawer.
  - `badge`: `Badge variant="warning"` labelled `coverage.badge`, wrapped in `Tooltip`
    (`@alga-psa/ui/components/Tooltip`) that shows the same messages. Used in the table row.
  - Unscoped lists show the first 5 services, then a `coverage.more` line ("and {{count}} more").
- Stable ids follow the existing `hb-*` pattern: `hb-coverage-warning`, `hb-coverage-badge-{block_id}`.

### 4. Dialogs

`SellHourBlockDialog.tsx` and `GrantHourBlockDialog.tsx` get the same change:

- State: `coverage`, `coverageUnscoped`. Add both to `reset()` (Sell :111-119; Grant has the equivalent).
- A `useEffect` keyed on `isOpen`, `clientId`, `selectedServiceId`, the sorted scope ids joined into a string,
  and the expiration converted with `toCalendarDateString`. It does nothing until a service is selected. It is
  debounced about 250ms, uses the same `cancelled` flag as the services effect (:51-74), and calls
  `getHourBlockContractCoverage`. Action or permission errors, and thrown errors, clear the coverage silently: the
  warning is advisory and must never block selling.
- Render `<HourBlockCoverageNotice variant="alert" .../>` when `coverage.length > 0`, directly above the error
  alert: Sell :258, Grant :239. Footer buttons (Sell :265-270, Grant :246-251) do not change.

### 5. Existing blocks

- `HourBlocksSection.tsx`:
  - In the status column render (:150-154), render `getStatusBadge` followed by
    `<HourBlockCoverageNotice variant="badge" />` when `record.contract_coverage?.length`.
  - Unscoped means `record.scope_service_ids.length === 0`.
- `HourBlockDetailDrawer.tsx`: below the header block (:89-99), render `variant="alert"` when
  `data.block.contract_coverage?.length`. The drawer gets its data from `getHourBlockDetail`, so it already has
  the field.

### 6. Copy: `server/public/locales/en/msp/hour-blocks.json` (new `coverage` object)

The copy follows the tone of `section.description`: plain, present tense, no blame.

```json
"coverage": {
  "oneLine": "Time on {{service}} bills through {{contract}} / {{line}} and will not draw this block.",
  "manyLines": "Time on {{service}} that is assigned to a contract line will not draw this block.",
  "linesLabel": "Contract lines covering {{service}}:",
  "unscopedIntro": "This block covers all labor, but time on these services bills through a contract line and will not draw it:",
  "unscopedService": "{{service}} — {{contract}} / {{line}}",
  "unscopedServiceAssigned": "{{service}} — when assigned to a contract line",
  "more": "and {{count}} more",
  "badge": "Contract overlap",
  "viewContract": "View contract"
}
```

Then the other locale packs and pseudo-locales (decision 10).

### 7. Tests (high value only)

- **Pure unit test**, `shared/billingClients/__tests__/hourBlockService.test.ts`, which always runs.
  `classifyContractLineCoverage` cases:
  - one line → `automatic`
  - two overlapping lines → `when_assigned`
  - two lines back to back → `automatic` with 2 lines
  - empty → `[]`
- **DB test**, `shared/billingClients/__tests__/hourBlockService.db.test.ts`, gated by `HOUR_BLOCK_DB_TESTS`.
  `getContractLineCoverageForClient` with a fixed `today`, using small local seed helpers for contract,
  client_contract, line and line-service:
  - one active line covering S → 1 line, `automatic`
  - two concurrent lines → 2 lines, `when_assigned`
  - a line whose `client_contracts.start_date` is after today but before expiration → included
  - the same line with no expiry but starting 13 months out → excluded
  - a line whose `end_date` is before today → excluded
  - no line → `[]`
  - unscoped (`serviceIds: null`) returns every covered service
  - regression: `isEntryEligibleForBlockBurn` still gives false for one line and true for two lines. This proves
    the builder refactor kept the burn rule.
- **Dialog test**, `packages/billing/tests/hourBlockCoverageWarning.dialog.test.tsx` (jsdom), following the mocking
  style of `hourlyServicesStep.catalogRate.test.tsx`. Mock `getServices` and `getHourBlockContractCoverage`.
  Render `SellHourBlockDialog`, select a service, and assert:
  - the one-line message, with contract and line names and a link `href` containing `clientContractId`
  - the many-line message
  - the unscoped list
  - no warning when coverage is `[]`
  - the submit button stays enabled while the warning shows
  One smoke case for `GrantHourBlockDialog` shows it uses the same notice.
- **Badge test**, `packages/billing/tests/hourBlockCoverageBadge.test.tsx`. Mock `listHourBlocks` to return an
  active block with `contract_coverage` and one without. Assert `hb-coverage-badge-{id}` exists only on the
  first.
- Run `node scripts/validate-translations.cjs`, plus `npm run typecheck` (or the billing/shared package
  typechecks).

## Out of scope

- Changing the burn rule or `isEntryEligibleForBlockBurn` semantics. Contract-issued blocks are card 737bde61.
- The bucket auto-replenishment top-up gap (separate card).
- Blocking Hourly/Usage advance billing (separate card).
- Server-side enforcement or a confirmation step on sell or grant.
- Extracting the tenant-today helper. It gets a LEVERAGE marker only.

## Risks

- **Refactoring a burn-critical query.** Moving the predicate into a builder could change burn behaviour if the
  overlap form is ever not equivalent at `from = to`. Mitigations: keep the select and count shape identical,
  add the regression DB case, and run the existing `hourBlockService.db.test.ts` suite plus
  `hourBlockLockDiscipline` against the local stack before committing. The helper adds no locking; it is a plain
  read outside `FOR UPDATE` paths.
- **Citus routing.** Every relation in the builder already goes through `tenantDb.tenantJoin`. The new selects add
  only a left join to `service_catalog`, also through `tenantJoin`, so routing stays single-shard. No correlated
  subqueries are added.
- **Long unscoped lists.** A client with many fixed-line services could produce a long list. It is capped at 5,
  with "and N more".
- **Sold-as service outside scope** (decision 4) can name a service that never draws the block anyway. The
  statement is still true and costs nothing. Revisit if MSPs find it noisy.
- **Window approximations.** Only `client_contracts` dates are used, as in the burn rule. Lines have no dates of
  their own in that rule. Expired or voided blocks are never flagged, so the badge cannot become stale noise.
- **Copy in 8 translated packs.** Translations follow the existing block terminology. They are review-sensitive
  but do not block.
