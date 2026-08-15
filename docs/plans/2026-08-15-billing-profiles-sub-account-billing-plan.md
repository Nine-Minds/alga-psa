# Billing Profiles — Sub-Account Billing Within a Client

**Branch:** `feature/billing-profiles-sub-account-billing-within-a-cl`
**Date:** 2026-08-15
**Status:** Design settled, awaiting implementation

## Companion ALGA plan

This document is the **design source** — architecture, rationale, and the reasoning
behind each decision. The execution ledger lives alongside it as an ALGA plan:

| Artifact | Purpose |
|---|---|
| [`ee/docs/plans/2026-08-15-billing-profiles-sub-account-billing/PRD.md`](../../ee/docs/plans/2026-08-15-billing-profiles-sub-account-billing/PRD.md) | Product requirements, personas, acceptance criteria |
| [`.../features.json`](../../ee/docs/plans/2026-08-15-billing-profiles-sub-account-billing/features.json) | **127 features**, each atomic and testable, `implemented` flipped as work lands |
| [`.../tests.json`](../../ee/docs/plans/2026-08-15-billing-profiles-sub-account-billing/tests.json) | **43 Pareto-selected tests** mapped back to feature IDs |
| [`.../SCRATCHPAD.md`](../../ee/docs/plans/2026-08-15-billing-profiles-sub-account-billing/SCRATCHPAD.md) | Decisions, code discoveries, gotchas, runbook |

Slice → feature-ID mapping is in §9. The PRD is the scope authority; this document is
the architectural authority. If they disagree, the disagreement is a bug — fix both.

---

## 1. Problem

An MSP's *operational* customer hierarchy does not always match its *accounts-receivable*
hierarchy. Today Alga forces them to be the same: one client is one billing identity,
one invoice per cycle, one card on file.

Three recurring customer shapes break this:

| Shape | Structure | What they need |
|---|---|---|
| **A — Multi-site franchise group** | One owner, N sites (growing), one M365 tenant, one contract per site, a *different card per site* | Separate invoice documents, separate bill-to, separate payment methods — but one client relationship for tickets/assets/portal |
| **B — Shared campus, multiple legal entities** | One physical site, one network, one M365 tenant, N separately-billed entities, one business manager over all of them | Separate invoices per entity; one portal login that shows the whole org *and* which costs belong to which entity |
| **C — Single legal entity, multiple facilities** | One tax ID, one bank account, one management team, N facilities each an operating/profit centre | *Not* separate invoices — cost visibility per facility, consolidated and drill-down |

The workaround is to split into N clients. That solves billing and breaks everything
else: fragmented tickets, assets, portal, and aggregate visibility. It trades a
billing problem for a relationship problem.

**The fix is a billing dimension orthogonal to the client tree.**

### The constraint that shapes the design

A billing profile **must be its own entity, not a property of location**. Shape A is
N locations mapping 1:1 to N profiles. Shape B is *one* location carrying *N* profiles.
Any model that hangs billing off location cannot express both. Locations and profiles
are independent layers that point at each other.

---

## 2. Settled design decisions

These were decided during the design session and are not open for re-litigation
during implementation.

| # | Decision |
|---|---|
| D1 | **One entity, two phases.** `client_billing_profiles` ships in phase 1 as a reporting segment and gains billing powers in phase 2. Not two dimensions to reconcile later. |
| D2 | **Per-charge resolution.** Every charge resolves its own profile through a chain. Not contract-line granularity. |
| D3 | **The work item carries the profile, not the time entry.** `tickets.billing_profile_id` / project equivalent, **soft-defaulted** at create, human-overridable. Never hard-required. |
| D4 | **A contract assigned to a profile always beats the work item.** See §3.2 — this is the property that makes shapes A/B/C fall out of one chain with no mode flag. |
| D5 | **Billing cycle becomes per-profile.** `client_billing_cycles` gains `billing_profile_id`. `generateInvoice` keeps its shape and simply runs once per profile-cycle. |
| D6 | **Invisible until a second profile exists.** Every client gets a system-managed default profile at backfill; no UI appears while `count == 1`. |
| D7 | **Credits, prepayments, aging and statements are profile-scoped**, with client-level rollup for reporting. A credit against one profile cannot pay a sibling profile's invoice. |
| D8 | **Attribution is explainable.** Every charge records *which chain step won*; every time entry records *how its contract line was picked*. |

---

## 3. Data model

### 3.1 New table: `client_billing_profiles`

```
tenant                    uuid  NOT NULL
billing_profile_id        uuid  NOT NULL  default gen_random_uuid()
client_id                 uuid  NOT NULL
name                      text  NOT NULL
is_default                bool  NOT NULL default false
is_system_managed_default bool  NOT NULL default false
is_active                 bool  NOT NULL default true
created_at / updated_at   timestamptz
created_by / updated_by   uuid

PK (tenant, billing_profile_id)
FK (tenant, client_id) -> clients
UNIQUE (tenant, client_id) WHERE is_default    -- exactly one default per client
INDEX (tenant, client_id, is_active)
```

Phase 2 adds to the same table (all nullable, all falling back to the client when unset):

```
bills_separately        bool NOT NULL default false
bill_to_name            text
bill_to_location_id     uuid   -- FK client_locations
billing_contact_id      uuid   -- invoice recipient
tax_settings            jsonb  -- see §6.2 for precedence
po_number / po_required
invoice_delivery_prefs  jsonb
billing_cycle_frequency -- per-profile frequency (falls back to client)
```

`is_system_managed_default` follows the precedent set by
`server/migrations/20260321150000_add_system_managed_default_contract_marker.cjs`.

### 3.2 The resolution chain

Every charge resolves exactly one profile. **First hit wins:**

```
1.  explicit billing_profile_id on the source record
2.  contract_lines.billing_profile_id
3.  client_contracts.billing_profile_id
4.  work item — tickets.billing_profile_id / projects.billing_profile_id
5.  client default profile (is_default = true)   -- always terminates
```

**Why contract beats work item (D4).** A charge cannot land on Profile A's invoice
when Profile B's contract priced it. So the ordering is a billing-correctness
requirement, not a preference. It also makes the three customer shapes fall out of a
single chain:

- **Shape A / B** assign contracts to profiles → resolution stops at step 2/3, the
  contract governs, invoices split correctly.
- **Shape C** leaves contracts unassigned (one shared contract) → resolution falls
  through to step 4, the work item governs, and cost-by-facility reporting is accurate.

No `mode` flag, no per-customer configuration. The assignment *is* the configuration.

**Reachability by charge type** (established by code trace, see §8):

| Charge type | Deepest reachable step | Note |
|---|---|---|
| Hourly / time | 4 (work item) | Engine already joins `tickets` at `billingEngine.ts:3739` |
| Manual / ad-hoc | 1 (caller supplies) | `invoiceService.ts:478` already accepts `location_id` |
| Fixed / recurring | 3 (contract) | No per-occurrence source record exists |
| Usage | 3 (contract) | `usage_tracking` has no location/segment field |
| Bucket | 3 (contract) | `bucket_usage` has no location/segment field |
| Project schedule | 3 (contract) | `project_billing_schedule_entries` has none |

This is an accepted limitation and must be **stated in the UI**, not discovered: for
usage/bucket/fixed charges, per-segment attribution requires one contract line per
segment. The attribution inspector (§4.5) is where that gets communicated.

### 3.3 Assignment columns added

| Table | Column | Phase |
|---|---|---|
| `client_contracts` | `billing_profile_id` nullable | 1 |
| `contract_lines` | `billing_profile_id` nullable | 1 |
| `client_locations` | `default_billing_profile_id` nullable | 1 |
| `tickets` | `billing_profile_id` nullable | 1 |
| `projects` | `billing_profile_id` nullable | 1 |
| `invoice_charges` | `billing_profile_id` + `billing_profile_source` | 1 |
| `time_entries` | `contract_line_source` enum | 1 |
| `client_billing_cycles` | `billing_profile_id` NOT NULL | 2 |
| `payment_methods` | `billing_profile_id` NOT NULL | 2 |
| `transactions` / `credit_tracking` / `credit_allocations` | `billing_profile_id` | 2 |
| `invoices` | `billing_profile_id` | 2 |

---

## 4. Phase 1 — the segment dimension

Phase 1 delivers accurate cost segmentation with **zero change to how invoices are
produced**. One invoice per client per cycle, exactly as today. Every charge on it
simply knows which segment it belongs to.

### 4.1 Slice 1 — schema + backfill

- Migration creating `client_billing_profiles`.
- Migration adding the nullable assignment columns from §3.3 (phase-1 rows only).
- **Backfill**: for every existing client, insert one profile
  (`is_default = true`, `is_system_managed_default = true`, name derived from the
  client name). Idempotent, re-runnable.
- Register the table in `packages/db/src/lib/tenantTableMetadata.ts` (Citus
  distribution) and in `ee/temporal-workflows/src/activities/tenant-deletion-activities.ts`.

**Exit criteria:** migration up/down clean; every client has exactly one default
profile; no behavioural change anywhere.

### 4.2 Slice 2 — the resolver

New module, e.g. `packages/billing/src/lib/billing/billingProfileResolution.ts`:

```ts
resolveChargeProfile(ctx): { billingProfileId, source }
```

Pure, unit-testable, one function, no side effects. `source` is the enum recording
which step won.

Wire it into the seven existing `location_id:` stamp sites in
`packages/billing/src/lib/billing/compute/*.ts`
(`computeTimeBasedCharges.ts:306`, `computeUsageBasedCharges.ts:229`,
`computeFixedCharges.ts:411/555/656`, `computeBucketCharges.ts:277`,
`computeRecurringQuantityCharges.ts:155`), persisting through
`invoiceService.ts:1038` alongside `location_id`.

For the time path, extend the existing `tickets` join at `billingEngine.ts:3739-3745`
to select `tickets.billing_profile_id` (currently only `title` is selected), and the
project path likewise.

Also fill the two attribution gaps found in the trace:
- `persistProjectScheduleCharges` (`invoiceGeneration.ts:430-446`) sets no
  `location_id` today — it must set the profile.
- Sales-order invoicing and `invoiceModification.ts` set neither.

**Exit criteria:** every row written to `invoice_charges` has a non-null
`billing_profile_id` and a `billing_profile_source`. Existing invoice totals are
byte-identical (assert this in tests — it is the safety property of phase 1).

### 4.3 Slice 3 — profile CRUD + assignment UI

- Billing profiles section on the client detail page: create / rename / archive,
  set default. Guard: cannot archive the default; cannot delete a profile with
  charges (archive instead).
- Profile picker on: contract, contract line, location (as `default_billing_profile_id`),
  ticket, project.
- **D6 gating**: every one of these controls is hidden while the client has one
  profile. A single `useClientBillingProfiles(clientId)` hook returning
  `{ profiles, isSegmented }` should be the only place that rule lives.
- Ticket profile soft-defaults at create: location default → client default.
  Never blocks ticket creation.

### 4.4 Slice 4 — MSP spend-by-profile reporting

- Spend by profile over a period, with drill-down into the charges behind each number.
- Sourced from `invoice_charges.billing_profile_id` — no separate rollup table.
- Comparison across periods; export.
- Hidden for single-profile clients.

### 4.5 Slice 5 — attribution explainability

The chain has five steps and the *existing* contract-line disambiguation already
fails silently. This slice makes the machine's reasoning legible.

- `invoice_charges.billing_profile_source` enum:
  `explicit | contract_line | contract | work_item | client_default`
- `time_entries.contract_line_source` enum:
  `explicit | auto_unique_service | auto_bucket_overlay | unresolved | reconciled_at_generation`
  — set at `packages/scheduling/src/actions/timeEntryCrudActions.ts:449-491` and at
  `billingEngine.ts:2093-2110` (the reconcile path).
- **Attribution inspector** on the invoice line and the time entry, rendering a
  plain-language sentence: *"Billed to «profile» because the contract line is assigned
  to it"* / *"Billed to «profile» because the ticket is at that site; no contract
  assignment applies."*
- **The high-value case is `unresolved`.** Today
  `resolveDeterministicContractLineSelection`
  (`packages/billing/src/lib/contractLineDisambiguation.ts`) returns **null silently**
  when more than one contract line matches a service. The entry may or may not get
  swept up later by `calculateUnresolvedNonContractCharges`. Surface these as a
  reviewable queue — this is a pre-existing invisible failure and arguably the single
  highest-value item in phase 1.

### 4.6 Slice 6 — client portal consolidated + segmented views

- Portal shows org-wide totals, with a segment selector once `isSegmented`.
- Drill into per-profile spend, invoices, tickets, services.
- Surfaces under `server/src/app/client-portal/billing` and `.../dashboard`.
- Access control is **phase 2** — in phase 1 every portal user of the client sees all
  segments, which matches all three shapes (each has an all-seeing manager).

---

## 5. Phase 2 — billing profiles as a bill-to entity

Phase 2 makes profiles bill separately. Each slice is independently landable.

### 5.1 Slice 7 — profile bill-to identity

Add the phase-2 columns from §3.1. Every field falls back to the client when unset,
so a profile with nothing filled in behaves exactly like the client does today.

### 5.2 Slice 8 — per-profile billing cycles

The largest slice.

```
client_billing_cycles
  + billing_profile_id NOT NULL          (backfilled to the client's default profile)
  UNIQUE (tenant, client_id, billing_profile_id, period_start)
```

`generateInvoice(cycleId)` keeps its shape — it just runs once per profile-cycle,
with charges scoped to the profile and bill-to read from it.

**Blast radius — 11 non-test consumers** to audit:

```
server/src/lib/api/services/ClientService.ts
server/src/lib/api/services/InvoiceService.ts
packages/billing/src/actions/billingCycleActions.ts
packages/billing/src/actions/billingAndTax.ts
packages/billing/src/actions/invoiceGeneration.ts
packages/billing/src/lib/billing/createBillingCycles.ts
packages/billing/src/lib/billing/billingEngine.ts
packages/clients/src/actions/clientContractActions.ts
packages/clients/src/actions/clientActions.ts
packages/db/src/lib/tenantTableMetadata.ts
ee/temporal-workflows/src/activities/tenant-deletion-activities.ts
```

Plus **~59 test files** referencing `client_billing_cycles`. Most need only a default
profile in their fixtures; a shared test helper should absorb that so the diff stays
mechanical.

Per-profile billing frequency comes free from this change and should be exposed —
franchise-shape customers commonly want staggered billing dates per site.

The existing per-client mixed-currency guard moves to per-profile.

### 5.3 Slice 9 — profile-scoped payment methods

`payment_methods` currently keys on tenant + client
(`server/migrations/20241117193906_create_payment_methods_table.cjs`, index
`[tenant, company_id, is_deleted]`). Add `billing_profile_id NOT NULL`, backfill
existing rows to the client's default profile, and move `is_default` uniqueness to
`(tenant, client_id, billing_profile_id)`.

### 5.4 Slice 10 — profile-scoped AR (D7)

- `billing_profile_id` on `transactions`, `credit_tracking`, `credit_allocations`,
  `invoices`; backfilled to the default profile.
- Credit application is constrained to the issuing profile.
- Aging and statements key on profile; client views sum across profiles.
- Note `20260728120000_derive_credit_balance_drop_cache_and_reconciliation.cjs` —
  balance is *derived*, so the derivation query is the thing that becomes
  profile-aware, not a cache.

### 5.5 Slice 11 — QBO sub-customer mapping

Profiles map onto QuickBooks sub-customers — a genuinely natural fit, since a QBO
sub-customer is exactly "a separate bill-to under one parent relationship."

- Mappings live in `tenant_external_entity_mappings`
  (`server/migrations/20250502173321`), keyed by
  `(tenant_id, integration_type, external_entity_id, external_realm_id)` — extend
  the Alga-side entity reference to address a profile.
- Client → QBO parent customer; profile → QBO sub-customer with `ParentRef`.
- Single-profile clients keep mapping to a plain customer, so existing connections
  are untouched.
- Touches `packages/integrations/src/lib/qbo/qboClientService.ts` and the customer
  mapping/sync routes under
  `server/src/app/api/v1/integrations/quickbooks/customers/`.

If this slice threatens the timeline it is the cleanest one to split into a
follow-up card — nothing else depends on it.

### 5.6 Slice 12 — portal access control

Per-user profile restriction: a site manager sees only their own segment; the owner
sees all. Default remains all-segments so phase-1 behaviour is preserved unless an
MSP deliberately restricts.

---

## 6. Cross-cutting concerns

### 6.1 Backward compatibility

The safety property, asserted in tests at every slice boundary:

> For any client with exactly one billing profile, every invoice, total, tax figure,
> credit application, portal view, and QBO export is **identical** to pre-change output.

### 6.2 Tax precedence

`contract_lines.location_id` is **not presentation-only** — it resolves tax region via
`getLocationTaxRegionCode` (`billingEngine.ts:546-572`), consumed through
`loadChargeComputeTaxContext` (`billingEngine.ts:628-690`). Current precedence:

```
service tax region  ->  contract-line location region  ->  client default region
```

Profile tax settings must slot in **deliberately**. Proposed:

```
service tax region
  -> contract-line location region
  -> PROFILE tax settings          <-- new
  -> client default region
```

Rationale: a contract line pinned to a physical location is a stronger statement about
where the service was delivered than the profile's billing identity. This is a genuine
judgement call and should be confirmed with a tax-aware reviewer before Slice 7 lands.

### 6.3 Feature flagging

Gate the phase-2 invoice split behind a PostHog flag (see the `alga-feature-flags`
skill) so per-profile cycle generation can be enabled per tenant. Phase 1 needs no
flag — D6's `count == 1` rule is a better gate than a flag, because it is
self-disabling.

### 6.4 Testing

- **Unit:** `resolveChargeProfile` against all five chain steps and all six charge
  types; the `contract beats work item` property (D4) explicitly.
- **Fixtures:** the three customer shapes from §1 as named scenarios — N-sites-1:1,
  one-location-N-entities, one-entity-N-facilities.
- **Regression:** the §6.1 identity property, run over the existing billing suite.
- **Integration:** per-profile cycle generation producing N documents with correct
  bill-to; credit isolation between sibling profiles.

---

## 7. Explicitly out of scope

- Cross-profile credit transfer (deferred; D7 chose strict isolation).
- Per-segment splitting of a *single* fixed/recurring charge — requires one contract
  line per segment, which is the documented workaround (§3.2).
- Merging or splitting existing profiles after charges exist.
- Any change to the client tree itself — profiles are orthogonal, clients are untouched.

---

## 8. Pre-existing bugs found during the trace (do not fix here)

Surfaced while tracing the time-entry → charge path. Both are real, both are
unrelated to this feature, and both deserve their own cards:

1. **Per-`user_type` hourly rates are never applied.**
   `computeTimeBasedCharges.ts:164-175` reads `entry.user_type`, but the production
   loader never selects it — the `users` join at `billingEngine.ts:3687` contributes
   no columns to the select list (`billingEngine.ts:3812-3823`). Only unit tests that
   inject `user_type` directly exercise that branch. The `user_type_rates` table
   (`20250318200000`) is effectively dead in real billing.

2. **`custom_rate` is read from a column that does not exist.**
   `computeTimeBasedCharges.ts` reads `entry.custom_rate`; `time_entries` has no such
   column, and `serviceConfig.config.custom_rate` (loaded at `billingEngine.ts:3634`)
   is never consulted in rate resolution.

---

## 9. Sequencing summary

| Slice | Scope | Depends on | Features | Tests |
|---|---|---|---|---|
| **S1** | schema + backfill | — | F001–F015 | T006–T009 |
| **S2** | resolver + engine wiring | S1 | F016–F034 | T001–T005, T010–T017 |
| **S3** | profile CRUD + assignment UI | S1 | F035–F052 | T018–T021 |
| **S4** | spend-by-profile reporting | S2 | F053–F060 | T022–T024 |
| **S5** | attribution explainability | S2 | F061–F070 | T025–T028 |
| **S6** | portal consolidated + segmented | S2, S3 | F071–F078 | T029–T031 |
| **S7** | profile bill-to identity | S3 | F079–F089 | T032–T033 |
| **S8** | per-profile billing cycles ← *largest* | S7 | F090–F101 | T034–T037 |
| **S9** | profile-scoped payment methods | S7 | F102–F106 | T038–T039 |
| **S10** | profile-scoped AR | S8 | F107–F115 | T040–T041 |
| **S11** | QBO sub-customer mapping ← *splittable* | S7 | F116–F122 | T042 |
| **S12** | portal access control | S6 | F123–F127 | T043 |

S1–S6 are phase 1 (segment dimension, no invoicing change); S7–S12 are phase 2
(bill-to entity, invoices split).

**Parallelism:** S3/S4/S5 can run concurrently once S2 lands. S9 and S11 can run
concurrently once S7 lands. S11 is the clean split point if phase 2 needs to shed
scope — nothing else depends on it.

**T013 is not a slice test.** The backward-compatibility identity property (§6.1) must
be re-asserted at *every* slice boundary, phase 1 and phase 2 alike. It is the only
defence against a silent money bug.
