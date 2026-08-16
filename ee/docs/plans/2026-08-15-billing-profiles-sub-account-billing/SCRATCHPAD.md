# SCRATCHPAD — Billing Profiles (Sub-Account Billing Within a Client)

Working memory for this effort. Append discoveries, decisions, commands, and gotchas
as they come up; revise earlier notes when decisions change.

- Design source: [`docs/plans/2026-08-15-billing-profiles-sub-account-billing-plan.md`](../../../../docs/plans/2026-08-15-billing-profiles-sub-account-billing-plan.md)
- PRD: [`PRD.md`](./PRD.md) · Features: [`features.json`](./features.json) · Tests: [`tests.json`](./tests.json)

---

## Decisions (with rationale)

| # | Decision | Why |
|---|---|---|
| D1 | One entity across both phases — the profile ships in phase 1 as a reporting segment and gains billing powers in phase 2 | The alternative (location-based reporting now, a separate AR entity later) leaves two segmentation dimensions with duplicated rollup logic and a reconciliation problem |
| D2 | Per-charge resolution, not contract-line granularity | The one-legal-entity-many-facilities shape runs a single shared contract; contract-line granularity would force them to restructure contracts, re-creating the exact pain the feature exists to remove |
| D3 | The work item carries the profile, not the time entry; soft-defaulted, never required | A technician logging time does not think about billing profiles. They already state which site the work was for. Requiring a per-entry choice guarantees bad data |
| D4 | A contract assigned to a profile always beats the work item | Billing correctness: a charge cannot land on Profile A's invoice when Profile B's contract priced it. Also makes all three customer shapes fall out of one chain with no mode flag |
| D5 | Billing cycle becomes per-profile rather than fanning out at generation time | Invoice generation keeps its shape and simply runs more times. Fanning out would complicate credit/prepayment application and every one-invoice-per-cycle assumption in AR. Per-profile billing frequency comes free |
| D6 | Invisible until a second profile exists | ~All clients will only ever have one profile. Gating on `count == 1` is self-disabling and strictly better than a feature flag for phase 1 |
| D7 | Credits, prepayments, aging, statements are profile-scoped with client-level rollup | Sibling profiles often have different cards and different owners; a credit silently paying another entity's invoice is a real AR defect |
| D8 | Attribution is explainable — every charge records which chain step won | The chain has five steps and the pre-existing disambiguation already fails silently |
| D10 | Profiles must ship profile-aware contract-line disambiguation; ambiguous items stop being silently billed at catalog rate | Parallel per-profile contracts carrying the same service are exactly the >1-eligible-line case, so this plan *creates* ambiguity. Shipping it without the remedy would degrade billing accuracy for the customers the feature targets. Sole authorised T013 carve-out, bounded by T052 |
| D9 | Tax **region chain** unchanged (profile does not participate); tax **exemption / certificate / tax ID / reverse charge** become profile-scoped | Region and exemption are different questions. Region only diverges when bill-to and delivery jurisdictions differ, which none of the target shapes produce, and destination sourcing favours delivery anyway. Exemption is per legal entity, and `is_tax_exempt` living on `clients` is what currently makes the one-site-many-entities shape unbillable inside one client |

### Constraint that shaped the whole model

A billing profile **must be its own entity, not a property of location**. One customer
shape is N locations mapping 1:1 to N profiles; another is *one* location carrying *N*
profiles. Any model hanging billing off location cannot express both. Locations and
profiles are independent layers that point at each other.

---

## Discoveries about existing code

Established by a full trace of the time-entry → charge path. These are the facts the
design rests on; re-verify before relying on a line number, as the tree moves.

### The charge attribution choke point

`invoice_charges.location_id` is derived **100% from `clientContractLine.location_id`**.
Seven stamp sites in `packages/billing/src/lib/billing/compute/*.ts` funnel into
`invoiceService.ts:1038`:

```
computeTimeBasedCharges.ts:306
computeUsageBasedCharges.ts:229
computeFixedCharges.ts:411, 555, 656
computeBucketCharges.ts:277
computeRecurringQuantityCharges.ts:155
```

**Consequence:** two time entries on tickets at *different* sites, billed through the
same hourly line, get the **same** `location_id`. Existing location reporting is
contract-line-granular, not per-work-item. This is why D2 exists.

The same seven sites are where `billing_profile_id` must be stamped.

### `contract_lines.location_id` is not presentation-only

It resolves tax region via `getLocationTaxRegionCode` (`billingEngine.ts:546-572`),
consumed through `loadChargeComputeTaxContext` (`billingEngine.ts:628-690`). Current
precedence: **service tax region → contract-line location region → client default region**,
expressed as a `??` chain repeated in each compute module (e.g.
`computeTimeBasedCharges.ts:219-222`).

Migration for the column: `server/migrations/20260415120200_add_location_to_contract_lines.cjs`.

**Per D9 this chain does not change.** Profile does not join it. F089 exists specifically
to hold it still, and T033 proves profile assignment cannot perturb it.

### Tax state is four separate client-scoped things

| Attribute | Defined in | Scope after D9 |
|---|---|---|
| Region chain | `compute/*.ts` `??` expressions | unchanged, client/location |
| `clients.is_tax_exempt`, `clients.tax_exemption_certificate` | `20241004080400` | **profile**, client fallback |
| `clients.tax_id_number` | `20241004163300` | **profile**, client fallback |
| `client_tax_settings.is_reverse_charge_applicable`, PK `(tenant, client_id)` | `20241004163300`, re-created `20251003000004:1002` | **profile**, PK gains `billing_profile_id` |

**The structural trap:** `loadChargeComputeTaxContext` (`billingEngine.ts:628-690`) reads
`input.client.is_tax_exempt` and builds **one context per client**. Profile-scoped
exemption means it must build **per resolved profile** — one invoice can legitimately
carry exempt and non-exempt lines. That is a change to the function's contract, not a
field swap. The `createDefaultTaxSettings` side effect at `billingEngine.ts:668` must
likewise provision for the resolved profile.

### Time entries have no client and no location

`time_entries` carries `work_item_id` + `work_item_type` (polymorphic, no ticket FK),
`service_id`, and a nullable `contract_line_id`. Client is derived at query time via
`work_item → tickets.client_id` or `→ project_tasks → project_phases → projects.client_id`.

**`tickets.location_id` already exists** (`20250613190110_add_location_to_tickets.cjs`)
and the billing engine **already joins `tickets`** at `billingEngine.ts:3739-3745` —
but selects only `title`. Adding the work-item profile to that select is a one-line
change, which is what makes step 4 of the chain cheap.

### Which charge types can carry a segment at all

| Charge type | Source record | Segment-bearing field? |
|---|---|---|
| Hourly / time | `time_entries` | Via ticket (`location_id`) or asset→location — reachable |
| Manual / ad-hoc | none (request payload) | Caller already passes `location_id` at `invoiceService.ts:478` |
| Fixed / recurring | none (contract line + recurring periods) | **No per-occurrence record exists** |
| Usage | `usage_tracking` | Has `client_id` but **no location/segment field** |
| Bucket | `bucket_usage` | **None** |
| Project schedule | `project_billing_schedule_entries` | **None** — and `persistProjectScheduleCharges` (`invoiceGeneration.ts:430-446`) sets no `location_id` at all today |

So only time and manual charges can reach chain step 4. Everything else stops at the
contract. This limitation is documented in the UI rather than hidden (F070).

### The disambiguation insertion point

`determineDefaultContractLine` → `getEligibleContractLines` →
`resolveDeterministicContractLineSelection` in
`packages/billing/src/lib/contractLineDisambiguation.ts` already picks a contract line
by `service_id` at time-entry create (`packages/scheduling/src/actions/timeEntryCrudActions.ts:449-491`),
returning **null when more than one line matches**.

Rule today (`contractLineDisambiguation.shared.ts:8-51`): 1 candidate → pick it;
>1 → pick the single one carrying a Bucket overlay; otherwise **null**.

**CORRECTION to an earlier reading in this file.** Unresolved entries are *not*
invisible to users. `AutomaticInvoices.tsx:354` already renders them as selectable
"Unresolved time entry" / "Unresolved usage record" rows, and they are billed opt-in
per item via `include: selectedNonContractSelections.length > 0`
(`invoiceGeneration.ts:1414`). The real defects are narrower:

1. **Unresolved items bill at `service_catalog.default_rate`**
   (`billingEngine.ts:2170-2176`) — no contract rate, no rounding config, no minimums,
   no overtime, no pricing schedule. The comment at `billingEngine.ts:2156-2159`
   acknowledges the rounding gap outright.
2. **The reason is computed and discarded.** `ambiguous` (>1 line) vs `no_match`
   (0 lines) is decided at `billingEngine.ts:2137-2151` and written to `console.info`
   only. The dashboard just says "Unresolved."

**This plan makes defect 1 worse (D10).** A multi-profile client with parallel
per-profile contracts each carrying the same service *is* the >1 case, so profiles
generate ambiguity. Profile-aware narrowing (F133–F136) is mandatory, and the fix to
the catalog-rate fallback (F137–F142) keys off the ambiguous/no_match distinction:
no_match keeps catalog rate (honest — nothing covers it), ambiguous never gets it
silently.

### Blast radius of the phase-2 cycle change

11 non-test consumers of `client_billing_cycles`:

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

Plus ~59 test files. Most need only a default profile in fixtures — F100 exists so that
diff stays mechanical rather than 59 hand edits.

### Tables the phase-2 work touches

- `payment_methods` — `server/migrations/20241117193906_create_payment_methods_table.cjs`,
  currently keyed `(tenant, payment_method_id)` with index `[tenant, company_id, is_deleted]`.
- AR — `transactions` + `credit_allocations` (`20241125124900`, `20241125125000`),
  `credit_tracking` (`20250226125411`). Note `20260728120000_derive_credit_balance_drop_cache_and_reconciliation.cjs`:
  balance is **derived**, so the derivation query becomes profile-aware — there is no
  cache to migrate.
- QBO — mappings in `tenant_external_entity_mappings` (`20250502173321`), keyed
  `(tenant_id, integration_type, external_entity_id, external_realm_id)`. Client code
  in `packages/integrations/src/lib/qbo/qboClientService.ts`; routes under
  `server/src/app/api/v1/integrations/quickbooks/customers/`.
- Precedent for the backfill marker:
  `server/migrations/20260321150000_add_system_managed_default_contract_marker.cjs`.

---

## Decisions taken during implementation

### S2-D1 — every client needs a default profile, not just the backfilled ones

**Found by a failing test, not by review.** The S1 backfill gives a default
profile to every client that existed *at migration time*. Nothing gave one to
clients created afterwards, so the first integration run against a
fixture-created client failed with "no default billing profile" — and that
would have been every newly created client in production.

Nothing in F001–F015 covers this; it is now **F143**, with **T054** as its test.
Two mechanisms, deliberately both:

- **Eager**, at each client-creation path (`clientActions` ×2, `inboundActions`,
  `xeroCsvClientSyncService`, `ClientService`, `shared/models/clientModel`), so
  the profile carries the client's name from the start. These are exactly the
  six sites that already call `ensureDefaultContractForClientIfBillingConfigured`.
- **Lazy**, in the chain's terminal step (`getClientDefaultBillingProfileId` →
  `ensureClientDefaultBillingProfile`), following the `createDefaultTaxSettings`
  precedent already in the engine. Client rows arrive from paths nobody
  enumerates — CSV import, onboarding, seeds, test fixtures, direct SQL — and an
  invariant that holds only when every one of them cooperates is not an
  invariant.

The lazy net is also what keeps the ~59 existing billing test files working
unchanged, which is the outcome F100 was written to buy.

Not done as a DB trigger despite the F002 precedent: a trigger on `clients`
would have to insert into the *colocated* `client_billing_profiles` shard, and
resolving that shard name from inside a worker-side trigger is fragile. The
app-level pair behaves identically on Citus and plain Postgres.

### S2-D2 — project-schedule charges resolve at the work-item step, not the contract step

The design source's charge-type table lists project schedule as having no
segment-bearing source record. That was true before F010 added
`projects.billing_profile_id`: a project billing schedule entry hangs off a
*project*, and a project now carries a profile. Attributing milestones and
deposits to the client default while F048 offers a profile picker on the project
would be an obvious defect — the user sets a profile and the invoice line
ignores it.

So project-schedule charges resolve `work item → client default` (they have no
contract line at all, so steps 2 and 3 are structurally absent). **T005's wording
was corrected** to match: usage, bucket, fixed, and recurring-quantity stop at
the contract step; project-schedule reaches the work item. F070's documented
limitation still applies to the four that genuinely cannot carry a segment.

### S2-D3 — the unresolved *reason* gets its own column, not a source value

`contract_line_source` records **how the line was chosen**;
`contract_line_unresolved_reason` records **why no line was**. They answer
different questions and a row can only carry one source, so folding
`ambiguous`/`no_match` into the source enum would have destroyed the very
distinction the unresolved-item fix is built on. Migration
`20260818000000_add_contract_line_attribution_reasons.cjs` adds the reason
column to `time_entries` and `usage_tracking`, plus `auto_billing_profile` to
the source value set (profile-aware narrowing is a genuinely new way to reach an
answer, and collapsing it into `auto_unique_service` would make the attribution
inspector lie).

### S8-D1 — the fixture seam is `TestContext.createEntity`, not 20 call sites

F100 asked for "a shared test fixture helper so existing billing tests need only
mechanical changes". The mechanical change turned out to be **zero** for most of
them: `client_billing_cycles` inserts funnel through `TestContext.createEntity`,
so filling `billing_profile_id` there covers every infrastructure suite at once.
The ~14 files that insert cycles directly use `seedBillingCycle` from
`server/test-utils/billingProfileTestHelpers.ts`.

The golden-output harness is the deliberate exception: it is copied verbatim into
a **pre-S1 worktree** to re-derive the baseline, so it may not import anything
that postdates S1. It inlines the profile behind a `hasColumn` probe instead.

### S9-D1 — only `payment_methods` gets NOT NULL; the ledger stays nullable

F102 asks for a non-null `billing_profile_id` on `payment_methods` and that is
right: a stored card belongs to exactly one paying entity, and the F104
uniqueness index is keyed on the profile, so a null would silently opt a card
out of "one default per profile".

F107/F108 ask only that `transactions` and `credit_tracking` *gain* the column,
and they stay nullable deliberately. A transaction is a ledger entry whose
profile is a property of the invoice or credit it references, not an independent
fact about the money; NOT NULL would force ~20 unrelated ledger call sites to
answer a question the ledger never asks, and any path that was missed would
throw inside a payment rather than degrading. Every write path this feature
touches populates it, and the migration backfills every existing row, so a null
in practice means only "issued before profiles existed".

### S10-D1 — a credit with no profile stays spendable anywhere in its client

This is the one place strict scoping would have done harm. F111 constrains credit
application to the issuing profile, and the T013 gate caught the consequence
immediately: the golden client's prepayment credit stopped applying, and its
invoice came out with `credit_applied: 0`.

The rule that resolves it has two halves. Credit that *carries* a profile can
only pay that profile's invoices — that is F111, and it is the AR defect decision
D7 exists to prevent. Credit that carries **no** profile belongs to the client as
a whole and remains spendable on any of its invoices; narrowing it would strand
money a client already holds. The prepayment invoice now stamps its own profile
(F096) so newly-issued credit is never in that state to begin with.

For *reporting* the null bucket is kept separate — `getUnattributedCredit`
alongside `getAvailableCreditByProfile` — and folded into the default profile's
row. Counting it once per profile instead would make the breakdown exceed the
client total, which is exactly the "rows disagree with the total" failure F115
exists to rule out.

### S10-D2 — aging and statements land on the surfaces that already exist

F113 and F114 have no dedicated host: there is no AR aging report and no
statement feature in the product. Aging *is* computed, in the client command
centre's money pulse, so that is where the per-profile breakdown went — the
bucketing moved to `shared/billingClients/billingProfileAr.ts` so the pure part
is testable without a database, and the card shows the split only when
`isSegmented` (D6). Statements got the primitive rather than a UI:
`buildProfileStatement` produces one profile's opening balance, lines, and
closing balance for a period, behind `getBillingProfileStatement`. A statement is
a demand addressed to whoever pays it, so the profile is a required argument, not
an optional filter.

### S11-D1 — a profile-level mapping needed no schema change

`tenant_external_entity_mappings` is already keyed on `(alga_entity_type,
alga_entity_id)` with `alga_entity_type` a free-form `varchar(50)` and no check
constraint. F116 therefore cost nothing: `billing_profile` sits alongside
`client` in the same table, and one client can have a parent-customer mapping
and several sub-customer mappings that cannot collide.

The narrow part is *which* profiles get one. Only a profile that bills
separately, is not the client's default, and belongs to a client with more than
one profile. The default profile **is** the client in accounting terms and bills
on the parent customer; giving it a sub-customer too would split one entity
across two QuickBooks records. A reporting-only segment issues no invoice at
all, so its sub-customer would be an empty record someone has to reconcile
against nothing. Both exclusions are asserted in T042.

Sub-customer display names are qualified as `Client:Segment`, because
QuickBooks requires `DisplayName` to be unique across the whole file — a bare
"Site B" collides the moment a second client has one.

### S8-D2 — the mixed-currency guard is per *invoice*, not per profile

F098 says "per profile", but the guard's job is to stop one invoice carrying two
currencies. Profiles that do **not** bill separately share the client's invoice,
so grouping strictly by profile would let a genuinely mixed-currency invoice
through. The buckets are therefore: one per separately-billing profile, plus one
shared bucket for everything else. With nothing marked separately-billing that
collapses to a single bucket — today's behaviour exactly.

---

## Gotchas

- **Do not model profile as a location property.** It is the one modelling mistake that
  looks reasonable and cannot represent one-location-many-entities. See the constraint above.
- **The `count == 1` invisibility rule must live in exactly one hook** (F042). Scattered
  `profiles.length > 1` checks will drift and leak the feature into single-profile
  clients.
- **`persistProjectScheduleCharges` stamps no segment today.** Easy to miss because
  there is no existing `location_id` line to copy — there is nothing there at all.
- **Backfill must be idempotent** (F005). It will be re-run across environments.
- **Do not ship profile assignment without F133–F136.** Parallel per-profile contracts
  make contract-line selection ambiguous; without profile-aware narrowing the targeted
  customers get *worse* billing accuracy than before the feature.
- **T052 bounds the only authorised T013 carve-out.** The permitted diff is exactly the
  today-ambiguous population. A diff anywhere else is still a defect. The carve-out
  authorises no other deviation, and further pressure to change single-profile output
  needs the same treatment: bounded, boundary-tested, recorded here first.
- **Profile tax fields are nullable scalars, not a `jsonb` blob.** NULL means inherit
  from the client, which is what makes the single-profile case provably identical.
  A blob defaults to `{}` and silently stops inheriting.
- **T013 is a gate that runs after EVERY slice, S1 through S12** — not a phase-1
  checkbox and not owned by any single slice. A slice is not done until it passes.
  Capture the golden baseline **before S1 lands**; after that the baseline is
  unobtainable without reverting. Run it first at S1, where the backfill is the only
  possible cause of a diff. S8 is the highest-risk gate. **A diff is a defect, never a
  baseline to refresh** — if single-profile output genuinely must change, that is a
  scope change and gets recorded here with rationale before the baseline moves.
- **F128 baseline was captured post-hoc from the pre-S1 commit** (see below) — S1 had
  already landed when the harness was implemented, so the "before S1" baseline could
  not be captured from this branch. Method: `git worktree add <tmp> <parent-of-S1>`,
  copy the harness into the worktree, run `GOLDEN_CAPTURE=1` there against the scratch
  test DB (pre-S1 migrations → no `client_billing_profiles` table), copy the generated
  `baseline.json` back, commit it. Then run the harness on the S1 branch in diff mode:
  byte-identical. The fixture client represents "single-profile" differently per tree —
  pre-S1 has no table at all; on S1 the harness inserts the one system-managed default
  profile for the fixture client (mirroring the backfill) but serializes no profile
  data, so both runs must match. That identity is the T013 proof for S1.
- **F002 zero-default guard is a constraint trigger, not the index alone.** The S1
  partial unique index gives at-most-one; `20260817000000` adds a `DEFERRABLE
  INITIALLY DEFERRED` AFTER INSERT/UPDATE/DELETE trigger that rejects any committed
  state where a client has profiles but no `is_default` row. Deferred-to-commit is what
  lets an atomic default switch (unset A + set B in one statement/transaction) pass
  while still making zero-default unreachable. Behavioral tests:
  `server/src/test/integration/billing/billingProfilesDefaultGuard.integration.test.ts`
  (T053).
- **`clientBillingCycleAnchors.test.ts` has 4 pre-existing failures**
  (`createNextBillingCycle` returns `permissionError: billing create required`;
  the file mocks `server/src/lib/auth/rbac` while the action imports
  `hasPermission` from `@alga-psa/auth`). Verified against a clean stash before
  S8 — unrelated to this effort. `src/test/infrastructure/billing/invoices/`
  likewise carries ~70 pre-existing failures; compare against a stashed baseline
  rather than reading the absolute count.
- **Integration runs collide on the shared `test_database`.** Sibling worktrees
  run their own suites against the same `127.0.0.1:5472` and recreate that
  database mid-run, which shows up as `terminating connection due to
  administrator command` or a half-applied migration rather than as a real
  failure. The S2 attribution suite passes an explicit
  `databaseName: 'test_db_billing_profiles'` for this reason. `wireLocalTestDbEnv`
  hardcodes port 5472, so overriding `DB_PORT` alone does not isolate a run.
- **The January cycle bills the December service period.** Contracts in these
  fixtures start `2024-12-01` and bill in arrears, so billable work has to be
  dated in December or the charge simply does not appear — with no error.
- **Citus cannot create triggers on distributed tables.** The F002 trigger is applied
  per-shard via the documented `run_command_on_shards` workaround (function is a
  single coordinator-side `CREATE OR REPLACE FUNCTION` — Citus auto-propagates
  functions to workers — resolving the shard table from `TG_TABLE_SCHEMA/TG_TABLE_NAME`).
  Disclosed limitation, extends the S1 note: triggers applied via `run_command_on_shards`
  must be re-applied after shard rebalancing; the guard is per-shard and sound because
  the table is distributed on `tenant` so one client's profiles all live on one shard.

---

## Pre-existing bugs found during the trace (NOT in scope — separate cards)

1. **Per-`user_type` hourly rates are never applied.** `computeTimeBasedCharges.ts:164-175`
   reads `entry.user_type`, but the production loader never selects it — the `users`
   join at `billingEngine.ts:3687` contributes no columns to the select list
   (`billingEngine.ts:3812-3823`). Only unit tests injecting `user_type` directly reach
   that branch. The `user_type_rates` table (`20250318200000`) is effectively dead in
   real billing.
2. **`custom_rate` is read from a column that does not exist.** `computeTimeBasedCharges.ts`
   reads `entry.custom_rate`; `time_entries` has no such column, and
   `serviceConfig.config.custom_rate` (loaded at `billingEngine.ts:3634`) is never
   consulted in rate resolution.

Both appear to under-bill silently. Raise as their own cards.

---

## Open questions

None outstanding. Settled during the design session and recorded as D1–D10 above.

Resolved most recently: whether the unresolved-item work splits into its own card. It
does **not** — investigation showed the work is coupled rather than orthogonal, because
this plan generates the ambiguity that the work exists to handle (D10).

---

## Commands / runbook

```bash
# find every site that stamps a segment onto a charge
grep -rn "location_id:" packages/billing/src/lib/billing/compute/

# blast radius of the phase-2 cycle change (non-test only)
grep -rln "client_billing_cycles" --include=*.ts --include=*.tsx server/src packages ee \
  | grep -v "/test/" | grep -v "\.test\."

# plan artifact validation
python3 ~/.claude/skills/alga-plan/scripts/validate_plan.py \
  ee/docs/plans/2026-08-15-billing-profiles-sub-account-billing
```

### T013 gate / F128 harness runbook

The gate is `server/src/test/integration/billing/goldenOutput/goldenOutputBaseline.integration.test.ts`.
Run in **diff mode** (the gate) or **capture mode** (`GOLDEN_CAPTURE=1`) from `server/`:

```bash
# gate (default): runs the single-profile scenario, diffs byte-for-byte against
# the committed baseline.json
env DB_HOST=127.0.0.1 DB_PORT=5472 DB_USER_ADMIN=postgres DB_PASSWORD_ADMIN=... \
  DB_USER_SERVER=app_user DB_PASSWORD_SERVER=... \
  npx vitest run src/test/integration/billing/goldenOutput/goldenOutputBaseline.integration.test.ts

# capture: regenerate baseline.json (only for a recorded, justified scope change)
GOLDEN_CAPTURE=1 env DB_HOST=127.0.0.1 DB_PORT=5472 ... \
  npx vitest run src/test/integration/billing/goldenOutput/goldenOutputBaseline.integration.test.ts
```

Baseline provenance is recorded in
`server/src/test/integration/billing/goldenOutput/baseline.provenance.json`
(pre-S1 SHA `fcd7f8cfdf`, its tree hash, and the sha256 of the committed
`baseline.json`) and is independently re-derivable:

```bash
# verify: rebuild a pre-S1 worktree (with @alga-psa/* resolving to the pre-S1
# tree's own packages), re-run the capture, byte-diff vs the committed baseline
server/src/test/integration/billing/goldenOutput/verify-baseline-provenance.sh

# re-capture from the pre-S1 tree (ONLY for a recorded, justified projection change)
server/src/test/integration/billing/goldenOutput/verify-baseline-provenance.sh --capture
```

The projection covers invoice totals, charge lines, tax, credit application,
the accounting-export preview incl. identity fields (invoice number, client
id/name), and portal output (portal invoice list + rendering view model).
The harness file is the only capture-branch input, so later slices must keep
its imports restricted to modules that exist at the pre-S1 commit.

The F002 guard is tested behaviorally by
`server/src/test/integration/billing/billingProfilesDefaultGuard.integration.test.ts`
(T053); the migration is `server/migrations/20260817000000_enforce_client_billing_profile_default_guard.cjs`.
