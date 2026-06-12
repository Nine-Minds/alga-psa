# PRD: QBO Closed-Loop Sync — Slice 4: Payments Out, Class Tracking, Multi-Realm

- **Status:** Draft
- **Owner:** Robert Isaacs
- **Created:** 2026-06-11
- **Design:** `../2026-06-11-qbo-phase2-closed-loop/design.md`
- **Depends on:** Slice 1 (engine, ops queue, payment mapping/echo suppression); slice 2's `record_payment`-adjacent adapter work is independent

## 1. Problem statement & user value

Three remaining asymmetries after slices 1–3. Client-portal Stripe payments
land in Alga but not in QBO, so the bookkeeper re-keys them (or the books
disagree) — the one direction of payment flow still manual. MSPs that segment
their P&L by class or location in QBO get invoices with no `ClassRef`/
`DepartmentRef`, making the integration useless for their reporting. And
tenants with more than one QBO company can connect both but can only operate
the default from the UI.

## 2. Goals

- Stripe/portal payments recorded in Alga appear in QBO as `Payment` objects
  against the right customer and invoice, deposited to a tenant-configured
  account, within one cycle.
- Exported invoice lines carry `ClassRef` (per item mapping, falling back to
  a tenant default) and invoices carry `DepartmentRef` (tenant default).
- Multi-realm tenants can see all connections, switch the default, and pick
  a realm in the batch dialog and wizard.

## 3. Non-goals

- Intuit webhooks (excluded by decision 2026-06-11; plan separately if
  polling latency ever becomes a real complaint).
- Manual payment entry in Alga (no such action exists; when one is added it
  should ride the same `record_payment` op).
- Per-client or per-invoice class/department overrides beyond the item
  mapping metadata (tenant default + per-item is the v1 granularity).
- Prepayment → QBO unapplied-payment mapping (still unscheduled).
- Per-realm divergent mappings UI beyond what slice 1 already scopes by realm.

## 4. Personas & primary flows

- **Client (portal):** pays an invoice by card; minutes later the bookkeeper
  sees a QBO Payment with the Stripe reference in Undeposited Funds (or the
  configured account) — no re-keying, no unexplained paid invoice.
- **MSP billing admin (class tracking):** sets a default class "Managed
  Services" and overrides per item where needed; QBO P&L by class works.
- **MSP billing admin (two companies):** connects both realms, makes the
  right one default, and routes the occasional batch to the second company
  from the batch dialog.

## 5. Functional scope

### 5.1 Alga-originated payments to QBO

- Producer: the Stripe success path in `recordExternalPayment` (provider
  `stripe`) enqueues `record_payment` when the tenant has a connected realm
  and the invoice is mapped; unmapped invoice → op is skipped with a stat
  (not an exception — the invoice may predate go-live).
- Cycle execution: create a QBO `Payment` (CustomerRef from the client
  mapping, `Line` linking the mapped invoice with the paid amount,
  `PaymentRefNum` = Stripe reference, `DepositToAccountRef` from settings).
  The payment mapping row is written at push time — slice 1's echo
  suppression makes the next CDC poll a no-op.
- `getQboAccounts` server action (account list filtered to valid deposit
  targets) feeding a deposit-account picker in QBO settings; unset →
  *Undeposited Funds* resolved at delivery time.
- Failures (deleted invoice in QBO, account invalid) file
  `accounting_sync_export_error` exceptions through the slice-1 framework.

### 5.2 Class & department tracking

- `getQboClasses` / `getQboDepartments` server actions (catalog pattern).
- Tenant defaults (class, department) configured in QBO settings via pickers;
  stored as tenant settings.
- Item mapping metadata accepts `classId`; the mapping dialog's JSON editor
  documents it and the items tab shows a class column when set.
- Invoice transform: per-line `SalesItemLineDetail.ClassRef` from item
  mapping metadata, else tenant default class, else omitted; header
  `DepartmentRef` from tenant default, else omitted. CreditMemos (slice 2)
  get the same treatment.

### 5.3 Multi-realm UX

- Explicit `default_realm` tenant setting consumed by `getDefaultQboRealmId`
  (replacing first-stored-key ordering); *make default* action on the
  settings connection list, which now renders one row per realm
  (company name, status, last cycle).
- Batch creation dialog and the slice-3 wizard show a realm picker only when
  more than one realm is connected.
- Cycle scheduling registers per realm (slice 1 keyed it per tenant×realm
  already; registration now enumerates realms on connect/disconnect).
- Realm-scoped surfaces (badges, health panel counts, mapping tabs) read the
  selected/default realm consistently; with one realm nothing changes.

## 6. Data model & API notes

- Tenant settings: `default_realm`, `deposit_account_ref`, `default_class_ref`,
  `default_department_ref`. No new tables.
- QBO API surface: Payment create, Account/Class/Department queries (all via
  `QboClientService`).

## 7. Risks & open questions

- Double-entry guard: if a tenant's bookkeeper ALSO records the same Stripe
  payout manually in QBO, CDC will deliver it as a new payment against an
  invoice that Alga already shows paid — the applier's idempotency makes the
  second application a no-op only if amounts align; overlapping different
  payments surface as an exception (already-paid invoice receiving new
  allocation). Verify this path in tests.
- QBO requires Payment currency to match the customer's; multi-currency
  tenants exercise the slice-1 currency-mismatch exception path.
- Realm enumeration on disconnect must deregister only that realm's cycle.

## 8. Acceptance criteria / definition of done

- Features implemented; automated tests green; slices 1–3 suites unaffected.
- Live sandbox smoke: portal Stripe payment appears as a QBO Payment with
  the Stripe reference in the configured account and does not echo back;
  class/department visible on a delivered QBO invoice; second sandbox
  company connected — default switch, realm-routed batch, and per-realm
  health all work.
