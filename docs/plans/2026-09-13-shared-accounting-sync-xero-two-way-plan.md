# Shared accounting sync and Xero two-way reconciliation — implementation plan

Card: Complete shared accounting sync and Xero two-way reconciliation
Worktree branch: `feature/complete-shared-accounting-sync-and-xero-two-way` (stacked on `feature/co-managed-it`)
Date: 2026-09-13

## Final mitigation takeover: manual export default

The three final-round repairs are present at `642ca29d60`. Independent review
passed the ambiguity guards, mapping relink/conflict tests, and the real
mapping-action → invoice export → inbound payment/replay DB journey. A new
regression remains: an unset saved default gives the export selector an
`absent` outcome and it creates a batch with no target realm.

Repair plan:

- Make the shared I/O selection helper resolve the first connected Xero
  connection for absent or unmatched defaults, preserving the existing
  provider-scoped fallback (including a saved QBO default). Retain the pure
  helper's distinct raw outcomes and never fall back for ambiguity.
- Delegate the connection-ID-only helper to that same usable selection.
  Settings, catalogs and manual exports then receive the same connection.
- Reject manual export creation before persistence when no connection can be
  selected, and keep explicit batch targets authoritative.
- Add composed behavioral coverage through actual credential/settings
  selection and batch creation for absent, QBO, stale, canonical, historical,
  ambiguous and disconnected cases. Re-run focused QBO/Xero tests, the isolated
  DB acceptance/guard suites, affected typechecks and the billing build.

The branch stays on Co-Managed IT at `0af97e5c61`. No schema, authorization,
financial-write, publication, or unrelated environment changes are required.

## Planning note (missing committed design plan)

The Design Session step recorded its plan as a durable card fact and a review
packet, not as a file on this branch, and this branch has no committed
`docs/plans/` entry of its own. This document is therefore written from the
work order plus the recorded design-session fact:

> provider-neutral inbound/operation contracts, Xero fetchChanges polling with
> cursor-after-apply, adapter/organisation selection fixes (drop hardcoded
> quickbooks_online), Xero payment/credit/void gating, behavioral+DB
> validation. Stacked on feature/co-managed-it. Excludes catalog price sync and
> mapping dropdowns.

`docs/plans/2026-07-14-xero-inbound-sync-plan.md` is historical input only.

## Non-goals

- Catalog price synchronization and recurring-contract repricing.
- Searchable mapping dropdowns (own card).
- Implementing Xero outbound payment/credit/void writes. The approved shape is
  explicit capability gating, not a new Xero write surface.

## Architecture

### 1. Provider-neutral inbound contract

`AccountingExternalChange` gains an optional `normalized` field carrying a
provider-neutral payload:

- `NormalizedExternalPaymentPayload` — `reference`, `txnDate`, `currency`,
  `totalCents`, `unappliedCents`, `allocations[]` of
  `{ externalInvoiceId, amountCents }`, `isCreditApplication`, and an opaque
  `providerMetadata` bag.
- `NormalizedExternalDocumentPayload` — `totalAmount`, `docNumber`,
  `isVoided`, and `providerMetadata`.

Each adapter translates its own payload into `normalized` at the adapter
boundary. The raw `payload` is retained so historical mapping metadata and the
existing QBO simulator keep working. Shared appliers prefer `normalized` and
fall back to the legacy QBO shape only when `normalized` is absent (historical
compatibility). This makes shared logic provider-neutral without a flag-day
migration for stored QBO data.

`providerMetadata` carries provider-specific fields that are useful for
diagnostics (e.g. `qbo_payment_kind`, `qbo_txn_date`, Xero status) without the
shared applier branching on provider field names.

### 2. Provider operations + capability gates

The adapter interface gains:

- Capability flags `supportsOutboundPayment`, `supportsOutboundCredit`,
  `supportsOutboundVoid`.
- `providerOperations?(tenantId, targetRealm): Promise<AccountingProviderOperations>`
  with `readDocument`, `getCreditRemainingCents`, `recordPayment`,
  `applyCredit`, and `voidDocument`.

QBO implements all of them by wrapping `QboClientService` inside the adapter
(the adapter is already the sanctioned billing→integrations bridge). Xero
declares every outbound flag `false`; the shared appliers gate on the flag and
mark the operation terminally failed with an observable
`accounting_sync_export_error` exception with reason `outbound_operation_unsupported`. No shared path constructs a
`QboClientService` for a Xero connection once the appliers dispatch through the
adapter.

The legacy QBO-specific safety logic (auto-apply-credits conflict, unapplied
payment detection, mapping tombstone/realm guards) is preserved. Only the
remote call boundary moves behind the provider-operation interface.

### 3. Xero inbound polling

`XeroClientService` gains paginated read helpers:

- `listChangedInvoices(modifiedAfter, page)`
- `listChangedPayments(modifiedAfter, page)`
- `listChangedCreditNotes(modifiedAfter, page)`

Each requests 100 records per page (Xero's page size) and reports whether the
page was full. `XeroAdapter.fetchChanges` loops pages until a short page,
normalizes records, and returns one `AccountingChangeSet`.

Normalization:

- Invoice → `Invoice` change with `NormalizedExternalDocumentPayload`
  (`Total`, `InvoiceNumber`, `VOIDED`/`DELETED` → `isVoided`/`deleted`).
- Payment → `Payment` change with `NormalizedExternalPaymentPayload`; the
  invoice link becomes one allocation. `Status: DELETED` → `deleted`.
- CreditNote → `CreditMemo` document change, plus one synthesized
  `Payment` credit-application change per AllocationID, keyed by
  `creditnote:<CreditNoteID>:alloc:<AllocationID>`. When IDs are absent,
  allocations are aggregated per invoice under `creditnote:<CreditNoteID>:inv:<InvoiceID>`. The payment applier applies these
  through the same idempotent ledger path as QBO credit applications.

Cursor strategy: `fetchedAt` is the poll's start instant, only persisted
after a successful apply. Overlapping polls are absorbed by the 5-minute
cursor overlap plus idempotent appliers (mapping `sync_token` equality). If the
change set is `truncated`, the cycle keeps the pre-poll cursor instead of
advancing, so a pathologically large page cannot skip changes.

Xero sends the UTC cursor as `If-Modified-Since`. The adapter fully paginates
before the cursor may advance, without a fixed page ceiling; repeated pages
fail the poll with no cursor advance. Allocation removal on a credit note is
reconciled best-effort by re-deriving the current allocation set for each
changed credit note; a credit note that stops appearing in the change feed is
not reversed until its next change event.

### 4. Routing

- `resolveConnectedAccountingIntegration` stays the single resolver.
- `accountingSyncActions` drops the module-level
  `SYNC_ADAPTER_TYPE = 'quickbooks_online'`; Sync Now, queueing, drift
  resolution, sync status and health resolve the connected adapter +
  organisation/connection.
- `runAccountingSyncCycle` runs outbound drains even when the adapter does not
  support change polling, so an export-only adapter is never stranded.
- The scheduled handler enumerates every connected QBO realm and Xero
  connection, independently of the interactive default provider.

## Validation

- Behavioral unit tests for normalized inbound payloads, provider-neutral
  dispatch, Xero normalization/pagination/cursor, and capability gating.
- Cycle-service tests for outbound-only adapters and truncated-cursor
  preservation.
- Existing QBO tests (cycle service, appliers, QBO simulator scenarios) remain
  green as the regression guard.

DB-backed happy/guard paths are exercised by the existing
`*.db.test.ts` suites and the QBO simulator; a Xero DB-backed reconciliation
test is added where the harness allows, otherwise the limitation is recorded.

## Historical review round 1 (cursor proposal superseded below)

- Fixed `XeroAdapter.findRemovedCreditAllocations`: the JSON extraction is a
  bound raw predicate (`(metadata->>'xero_credit_note_id') = ANY(?)`), asserted
  against the real database including organisation isolation.
- Xero `deliver` now persists the same delivery snapshot QBO does
  (`exported_total`, `doc_number`, `sync_token`); the drift detector explicitly
  adopts the first observed document as the baseline for legacy mappings
  instead of silently ignoring later changes.
- Cursor recovery: adapters capture a conservative pre-poll watermark, expose
  `changeSet.nextCursor` on truncation, and the cycle resumes from it. The
  cycle repository falls back to the most recent `cursor_before` when no cycle
  has succeeded, so a failed first poll does not skip its window.
- Xero dates are parsed from `/Date(ms+offset)/`; credit allocations use
  AllocationID identity (or explicit per-invoice aggregation) so duplicate
  allocations survive replay and removal.
- Xero auth failures (expired refresh, 401, missing connection) are classified
  as reconnect-required and abort the cycle with a connection exception and no
  cursor advance; polling request errors are normalized.
- Organisation selection: `resolveConnectedAccountingIntegration` accepts a
  preferred target and honours the settings-selected realm; the scheduled
  handler fans out to every connected Xero organisation; invoice status and
  health counts are organisation-scoped and tombstones excluded.
- UI: `InvoiceSyncStatus` carries provider identity; the badge/preview gate
  QuickBooks links and copy on the provider; the health panel is
  provider-labelled and never loads QBO catalogs for a Xero connection.
- Producers route through the connected provider with an echo guard for any
  accounting-originated payment; non-QBO adapters can no longer fall back to a
  QBO client.
- Validation adds `server/src/test/integration/accounting/xeroInboundReconciliation.integration.test.ts`
  (real export → poll → apply, AR rows, balances, cursor, real allocation
  query) and QBO provider-operation regressions against the simulator.

## Historical review round 2 (page ceiling and UI composition superseded below)

- Cursor safety: a truncated poll no longer advances to any timestamp. A
  single stored cursor cannot describe an unfinished feed, and a newer
  completed feed must not supply the boundary. Adapters no longer emit a
  `nextCursor`; the cycle leaves the cursor untouched and re-polls the same
  window until the source stops truncating. Paging caps were raised
  (Xero 1000 pages). The cycle records the un-overlapped resume base as
  `cursor_before` so failed-first-cycle fallbacks no longer subtract the
  overlap repeatedly.
- Credit replacement: the cycle orders deletions before applications, so an
  allocation that fully settled an invoice is reversed before its replacement
  is applied. DB-backed tests cover single and multiple replacements, legacy
  aggregate→AllocationID migration, split reversal/application recovery, and
  replay, asserting real invoice balances, statuses and transactions.
- Organisation selection fails closed: an explicitly requested provider or
  organisation that is gone returns null (never another target). Authenticated
  actions accept the selection and surface an actionable unavailable error;
  the health panel exposes Make default for Xero and passes the selected
  organisation to Sync Now; the scheduler enumerates every connected target
  across both providers.
- UI/translations: the health/Sync Now slot is mounted in the Xero settings
  flow, and provider-aware `{{provider}}` translation keys are added to the
  real locale resources with tests asserting interpolation against the English
  resources.
- Token classification: revoked refresh credentials (400 invalid_grant, 401)
  are classified reconnect-required at the client boundary while transient
  failures stay retryable; HTTP-boundary tests cover polling headers,
  organisation selection, paging and token-refresh classification.


## Final takeover repair

The focused acceptance checklist is in `ee/docs/plans/2026-09-13-accounting-sync-takeover/`.

- Separate QBO and Xero health slots carry the selected provider from server composition through integrations settings to the authenticated health action. Xero provider-only resolution honors the saved second organisation even with QBO connected. Unavailable connections disable Sync Now; failed Make default actions surface their error. Open exception health counts filter the selected realm.
- Sync Now only reports success for a succeeded, complete cycle with no failed operations. Persisted cycle errors and truncated results remain visible, including reconnect errors.
- Xero finishes all numbered pages, including histories exceeding the former 1000-page cap. Repeated page identities or empty continuing pages fail the poll, retaining its cursor. Progress is independent of timestamp ordering, ties or missing update timestamps. QBO truncated CDC responses still preserve the cursor and show incomplete status.
- A real DB test interrupts replacement after reversal and after the new AR writes but before their ledger insert. The new writes roll back; replay restores the paid balance with exactly two payment transactions and one reversal, with no further replay effect.
- HTTP-boundary tests mock axios; DB integration tests mock the Xero client factory. Neither exercises a live external Xero account.

## Mitigation round 2026-09-13 (four smoke failures)

The scope-enforcing smoke run against `0a6d4c9cd8` (evidence under
`/tmp/alga-smoke-evidence/shared-accounting-xero-20260913-2130`) passed routing,
export, payment/credit reconciliation, pagination and capability gating, and
failed four narrow acceptance checks. This round repairs only those four and
keeps every prior invariant.

### 1. Xero payment polling needs `accounting.payments.read`

`DEFAULT_XERO_SCOPES` omitted the Payments scope because no pre-polling flow
called `/Payments`; inbound polling now does. Add `accounting.payments.read`
(read-only — outbound payment/credit/void stay gated). Connection scope is
already persisted from the token response, so existing reduced-scope
connections are detectable:

- `computeMissingXeroScopes(grantedScope, required)` accepts legacy broad
  scopes (`accounting.transactions`, `accounting.transactions.read`,
  `accounting.payments`, `accounting.settings`) as satisfying their granular
  replacements, and returns `[]` for an unknown/absent stored scope so legacy
  connections are never falsely blocked.
- `XeroConnectionSummary` carries the granted `scope` and any `missingScopes`.
- `getXeroConnectionStatus` surfaces an actionable reauthorization error
  (reconnect grants the updated set; a token refresh does not) and reports the
  connection as not usable.
- A persistent 401 on `/Payments` when the stored scope is known to lack the
  payment read scope throws `XERO_SCOPE_INSUFFICIENT`, which the cycle treats as
  reconnect-required (no cursor advance); transient failures stay retryable.

### 2. One mapping identity: the Xero connection id

The canonical target is the connection id; `xeroTenantId` is the API tenant
header. The UI mapping context persisted `xeroTenantId` while export resolution
looked up the connection id, so a UI-created mapping never resolved.

- `XeroLiveMappingManager` sets `realmId = connectionId` (as QBO already does),
  so list/create/update and catalog calls all use the connection id.
- A shared `resolveXeroRealmAliases(tenantId, targetRealm)` returns the ordered
  accepted realm ids: the connection id first, then its `xeroTenantId` only
  when ownership is verified unique within the tenant. Unknown or ambiguous
  targets return the exact id only (fail closed), never another organisation's.
- `AccountingMappingResolver`, `KnexInvoiceMappingRepository`, the
  `SyncMappingLedger` realm scope and `XeroAdapter.findRemovedCreditAllocations`
  accept the alias set, preferring the exact connection id and keeping the
  existing NULL-realm fallback for catalog defaults.
- Historical org-keyed rows therefore still resolve for the owning connection
  and remain invisible to every other tenant and organisation.

### 3. Persisted provider-scoped default selection

`getXeroConnectionStatus` and the catalog helpers used `summaries[0]` /
first-key ordering, ignoring the persisted `settings.accountingSync.defaultRealm`
that `resolveConnectedAccountingIntegration` already honours.

- `resolveDefaultXeroConnectionId(tenantId)` reads the persisted default and
  returns it when it names a connected Xero connection (accepting a historical
  org id owned by exactly one connection); otherwise it falls back to the first
  connection.
- Status, catalog load and default-dependent helpers all use it. Explicit
  connection requests stay authoritative and fail closed when unavailable.
- The settings-UI event `accounting-default-realm-changed` reloads the Xero
  settings panel when the health panel changes the default. QBO's own
  ordering-derived default is untouched.

### 4. Terminal failed operations count as errors in health

`markFailedTerminal` writes `status = 'failed'`, but `getAccountingSyncHealth`
counted only `skipped`, so a capability-gated Xero operation showed as zero
errored ops. Count `failed` alongside `skipped`; the counts remain scoped to
tenant + provider + target realm.

### Validation

- HTTP-boundary tests with a scope-enforcing provider: fresh authorization
  requests the payment read scope and Payments polling succeeds; a known
  reduced-scope connection gets `XERO_SCOPE_INSUFFICIENT` with the missing
  scope; a revoked refresh is still reconnect-required and a 5xx stays
  retryable.
- DB-backed tests: UI-identity mapping resolves for export; a historical
  org-keyed mapping resolves for its owning connection and for no other
  tenant/org; an ambiguous org owner aliases nothing.
- Action/UI tests: selected B persists and status + catalog + mapping route to
  B with QBO also connected; explicit unavailable selection fails closed.
- Health tests: `skipped` + `failed` counted, other-org failures excluded.
- Focused QBO regressions, replay/reversal, pagination-failure cursor
  preservation and reconnect classification remain green.

### Mitigation round results (2026-09-13)

Implemented in this round and verified with behavioral tests, no live vendor
call and no full Next.js build (billing `tsup` build ran):

- `packages/integrations`: 810 passed / 2 pre-existing unrelated
  `teamsPackageActions` mock failures. New: real local HTTP scope-enforcing
  boundary (Payments 401 unless a payment scope is granted) passes with the
  shipped default scopes, denies a reduced grant with
  `XERO_SCOPE_INSUFFICIENT`, and accepts a legacy `accounting.transactions`
  grant; polling/refresh classification unchanged.
- `packages/billing` accounting-sync unit set: 290 passed, including the QBO
  simulator scenarios, capability gating, pagination/cursor and health counts.
- DB-backed (`TEST_DB_NAME=test_shared_acct_mitigation*`, serial): mapping
  realm/alias 13, Xero payment reconciliation 6, cycle repository 2, Xero
  fail-closed 2, QBO unlink-export mapping suppression 2 (the pre-existing
  `qboAdapterUnlinkExport.db.test.ts` suite itself fails on an unseeded
  `invoices` row, unrelated to this round), plus the server Xero inbound
  reconciliation integration 11 and Xero live-export/mapping integration 12.
- `packages/integrations`, `packages/billing` and `packages/types` typechecks
  pass with `NODE_OPTIONS=--max-old-space-size=12288`; `packages/emulators/xero`
  typecheck and tests pass; changed-file ESLint reports 0 errors.
- Pre-existing, out of scope: 5 billing curated suites fail on locale-pack
  parity (`integrations.qbo.sync.autoProvisionCustomersLabelProvider` and
  contract-lines/credits keys), and the `teamsPackageActions` suite fails on a
  partial `@alga-psa/core/secrets` mock. Neither is touched by this round.

Validation used a local HTTP simulator and DB fixtures only — no live Xero or
QBO account. Billing `npm run build` (tsup) passed; no full production Next.js
build was run.

## Review round 2026-09-13 (four reviewer issues on the mitigation commit)

1. Historical mappings were visible to export resolution but not to the
   mapping screen. `getExternalEntityMappings` now accepts the same
   ownership-validated alias set (canonical connection id plus the uniquely
   owned organisation id, exact-first) as resolution. Delete tombstones the
   whole identity group for the entity, so a hidden organisation-keyed sibling
   cannot resurface as the export fallback; create rejects a second live
   representation under the alias; update rewrites a historical row's realm to
   the owning connection id. Covered by
   `packages/billing/src/services/accountingSync/xeroHistoricalMapping.db.test.ts`
   (UI create → resolver/export → inbound payment, alias read, cross-org/tenant
   isolation, delete-fallback, create conflict).
2. The persisted selection was normalized for settings but not for sync
   routing. `resolveConnectedAccountingIntegration` now normalizes
   `settings.accountingSync.defaultRealm` with the same helper as
   `resolveDefaultXeroConnectionId`, so a historical organisation id routes
   both to the owning connection (and wins over a connected QBO default).
   Ambiguous ownership is rejected, not guessed. Shared pure helpers live in
   `packages/integrations/src/lib/xero/xeroRealmIdentity.ts` so no test mock of
   the client transport can desynchronise them. Covered by
   `connectedAccountingIntegration.xeroSelection.test.ts`.
3. `accounting.transactions.read` no longer satisfies `accounting.invoices`.
   Only the read+write broad scope covers invoice export; a read-only legacy
   grant can still poll Payments but connection status reports the missing
   invoice-write permission and `XeroClientService.createInvoices` refuses the
   write with `XERO_SCOPE_INSUFFICIENT` before any HTTP call. Covered in
   `xeroClientService.scopes.test.ts`, `xeroClientService.scopeEnforcement.test.ts`
   and `xeroActions.test.ts`.
4. Locale resources, not just `defaultValue`, were updated: the Xero
   connection-success, how-it-works, mapping and reauthorization copy in `en`,
   the seven real locales and the regenerated pseudo-locales; the missing
   `qbo.sync` provider keys were also translated so
   `validate-translations.cjs` and `audit-all.cjs` pass. A new
   `XeroIntegrationSettings.localeResources.test.tsx` renders the panel
   against the real English resource and fails on stale "first organisation"
   copy.

Validation: integrations 821 passed (2 pre-existing `teamsPackageActions`),
billing curated 1268 passed / 3 pre-existing unrelated failures (contract-line
renewal, usage config, a ContractLines source-string assertion), the DB suites
above, server Xero inbound/export integration 16, internal Xero integration 12,
types/integrations/billing typechecks, emulator tests, changed-file ESLint 0
errors, locale parity and quality audits pass. No live vendor call; no full
Next.js build.

## Final builder round 2026-09-13 (three remaining review issues)

1. Ambiguity is its own selection state. `resolveXeroDefaultSelection` returns
   `resolved | absent | ambiguous | unknown`; an organisation owned by more
   than one connection is `ambiguous` and never falls back to another
   connection. It propagates as: `getXeroConnectionStatus`
   (`errorCode: 'SELECTION_AMBIGUOUS'`, actionable copy, no default
   connection), catalog actions (`errors.xero.organisationAmbiguous`),
   `createBatchFromFilters` (`ACCOUNTING_EXPORT_XERO_SELECTION_AMBIGUOUS`), and
   `resolveConnectedAccountingIntegration` (returns null for both
   preferred-provider and generic routing). An absent default still falls back
   to the first connection; settings, catalogs, export and sync share one
   helper.
2. The create-mapping conflict check now runs before the tombstone-relink
   branch and the tombstone lookup is scoped to the requested connection's
   validated alias set. A canonical tombstone plus a live historical
   organisation-keyed row therefore rejects the second representation instead
   of producing two live mappings, while other organisations' tombstones are
   preserved and delete-then-recreate still relinks.
3. The acceptance test now drives the real flow: the service mapping is created
   through `createExternalEntityMapping`, the invoice is delivered through the
   real export service, and the inbound payment goes through the real
   `runAccountingSyncCycle`/`recordExternalPayment`, writing real
   `invoice_payments`/`transactions` rows and moving the invoice to `paid`, with
   replay remaining idempotent. Only the Xero HTTP/client boundary is mocked.

Validation: the reviewer's three reproductions now pass (the intentionally
stale old selector test asserting fallback is superseded by the new fail-closed
assertions in the permanent suite). xeroHistoricalMapping DB 8/8, selector
preview 14/14, server Xero integration 12/12, integrations 823 passed (2
pre-existing teamsPackageActions), billing curated 1268 passed (3 pre-existing
unrelated), catalog/status component rendering, typechecks, changed-file ESLint
0 errors, billing tsup build, locale parity/quality audits. No live vendor call;
no full Next.js build.

## Final mitigation takeover validation

- Shared selection now resolves absent/unmatched saved defaults to the connected Xero default consistently. The ID-only helper delegates to it; ambiguous selections remain unavailable, and disconnected manual exports fail before preview or batch creation.
- New composed selection-to-batch suite: six cases failed before the repair; all ten now pass, covering first use, QBO/stale defaults, selected and historical identities, ambiguity with an explicit override, missing/cross-tenant connections, and QBO routing.
- Current-turn checks: 368 non-DB behavioral tests pass (24 selector tests, 284 accounting/QBO regressions, 49 Xero scope/settings tests, 11 adapter polling tests). Serial isolated DB suites pass 20/20 (8 mapping guards and 12 real export/payment/credit/replay scenarios).
- Integrations, billing and types typechecks pass with a 12 GB Node heap. Billing tsup build passes. Changed-file ESLint has zero errors; existing warnings remain. No live vendor call, full production Next.js build, or new browser smoke run is claimed.
- Existing smoke artifacts and the port-3004 environment are preserved. The temporary `test_xero_final_takeover` database is removed after validation. Parent merge base remains `0af97e5c61` and the board dependency is unchanged. Keep the commit local; do not push or open a PR.
- Review first: the shared `getXeroDefaultSelection` fallback and its composed manual-export regression suite; previous mapping conflict/ambiguity and real financial-write acceptance repairs remain intact.

## P1 mitigation round 2026-09-13 (manual export carries another provider's realm)

The retained cross-provider smoke (`/tmp/alga-smoke-evidence/shared-accounting-xero-r2-20260913-2315`,
HEAD `1fab424783`) reproduced one release-blocking regression: with Xero A/B
connected and B default plus QBO connected, the New Export dialog loaded realms
once on mount from the *globally default* provider and never reloaded them when
the adapter changed. Selecting QuickBooks Online therefore kept Xero A/B in the
company picker and persisted `adapter_type=quickbooks_online,
target_realm=smoke-conn-b`, which could then never resolve QBO realm mappings.

### UI connection lifecycle

`AccountingExportsTab` now loads connections scoped to the selected live
adapter and reloads whenever the adapter changes or the dialog opens:

- On every adapter change the previous provider's `availableRealms` and
  `targetRealm` are cleared before the new request starts.
- `getAccountingSyncHealth({ preferredAdapterType })` uses the selected
  provider's own default-selection rules (the resolved `isDefault` realm),
  preserving Xero connection-id, historical-alias, absent-fallback and
  ambiguity handling because it reuses the shared server resolver — no second
  implementation.
- A monotonically increasing request token drops any response from a provider
  the user has since left, so a late QBO response cannot repopulate the picker,
  change the target, or clear/raise the loading state after switching to Xero.
- File adapters (CSV/desktop) clear the realm and submit no `target_realm`.
- Create Batch is disabled while a live provider's connections are loading or
  unresolved, and `onCreate` re-checks before submitting.

### Server target validation

`createBatchFromFilters` (the shared boundary behind both the
`createAccountingExportBatch` action and the runtime helper) now validates an
explicit target before preview or persistence:

- Live adapters route the explicit target through the same
  `resolveConnectedAccountingIntegration` used by sync routing and health. The
  target must be a connected integration for the authenticated tenant and match
  the selected provider; unknown, disconnected, cross-provider and cross-tenant
  targets throw `ACCOUNTING_EXPORT_TARGET_UNAVAILABLE`. There is no silent
  fallback to a default connection for an explicit invalid target.
- Provider-specific defaults are unchanged when no target is supplied: QBO
  keeps `getDefaultQboRealmId`, Xero keeps `getXeroDefaultSelection` with its
  `ACCOUNTING_EXPORT_XERO_SELECTION_AMBIGUOUS` / `..._CONNECTION_REQUIRED`
  failures.
- File adapters discard any stale realm instead of failing, so CSV exports stay
  usable without an accounting realm.

### Validation

- Composed UI coverage (`packages/billing/tests/accounting/accountingExportsTab.adapterSelection.test.tsx`):
  selecting QBO shows and submits only `smoke-realm-a`; switching to Xero
  replaces the options/default with `smoke-conn-b`; a late QBO response cannot
  overwrite the chosen Xero connection; CSV hides the picker and submits
  without a realm; Create is disabled until connections resolve.
- Action/selector coverage (`accountingExportTargetValidation.test.ts`) drives
  the real action and selector against the real provider resolver: cross-
  provider, unknown and cross-tenant targets all reject before `createBatch` /
  `appendLines`; valid QBO and Xero pairs persist the correct adapter/target;
  CSV ignores a stale realm.
- DB-backed coverage added to
  `server/src/test/integration/accounting/invoiceSelection.integration.test.ts`:
  three invalid explicit pairs throw `ACCOUNTING_EXPORT_TARGET_UNAVAILABLE` and
  leave `accounting_export_batches` / `accounting_export_lines` counts
  unchanged. The same file's Xero no-target and QBO realm-100 fixtures were
  made deterministic with connection mocks (they previously depended on
  machine-local tenant secrets), so the suite is 7/7 green.
- Non-DB regressions: billing accounting unit/component set 87 passed;
  382 accounting/QBO/Xero behavioral tests passed via the server config;
  `invoiceSelection`, `exportDashboard` and `auditTrail` DB suites pass in
  isolated `TEST_DB_NAME` databases. Billing and server typechecks pass with a
  12 GB heap; billing tsup build passes; changed-file ESLint reports 0 errors
  (warnings only). No live vendor call, full production Next.js build, or new
  browser smoke run is claimed in this round.
- Out of scope and untouched: catalog pricing, recurring-contract repricing,
  searchable mapping dropdowns, and the pre-existing index that rejects mapping
  a second service to the same Xero revenue account.
- Keep the commit local; do not push or open a PR. Parent merge base remains
  `0af97e5c61`.
