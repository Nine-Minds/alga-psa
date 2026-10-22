# Contract billing-profile & payment-terms traceability

Card `7a9ead2e-49b3-4f04-a775-54ef7051a7a4` — ticket alga0002302, findings 1, 4 and part of 7; branch
`feature/contract-billing-profile-payment-terms-traceabil`, verified at `0c10002bc8`.

## Scope

The card names six defects; line numbers are on this branch.

**1. Single-profile clients see no profile on the contract.**
`packages/billing/src/components/billing-dashboard/contracts/ContractDetail.tsx:207-209`
returns `null` from `AssignmentBillingProfileField` whenever `!isSegmented`. That copies the
"feature is invisible for one-profile clients" rule (D6) onto a *statement of fact*. The rule is
about not offering a choice, not about hiding which profile bills. The same invisibility is applied
to the line picker at `ContractLines.tsx:1562` through `BillingProfilePicker.tsx:76`.

**2. "Use the client's default profile" never names the default.**
`ContractDetail.tsx:232-241` is used both as the picker's unassigned label and the read-only
fallback. The profiles are already loaded at `:205`; `useClientBillingProfiles` already exposes
`defaultProfile` (`packages/ui/src/hooks/useClientBillingProfiles.ts:112,118`). No new lookup is
needed.

**3. Nothing states precedence or effective date.**
The real precedence is two different chains, and the contract shows neither:
- *Which profile*: `resolveChargeProfile` — line → contract → work item → client default
  (`packages/billing/src/lib/billing/billingProfileResolution.ts:64-104`).
- *Which value within a profile*: `resolveEffectiveBillingIdentity` — per field profile, else
  client, with `overriddenFields` recording what the profile actually won
  (`shared/billingClients/billingProfileSettings.ts:117-175`).
- Payment terms additionally fall back to Net 30 when neither level has a known key
  (`shared/billingClients/paymentPreferences.ts:50,86-87`).
- Tax region is deliberately **not** profile-scoped: `service region → contract-line location →
  client default region` (`server/migrations/20260818040000_add_billing_profile_bill_to_and_tax.cjs:14-25`).

**4. `ContractOverview.tsx` has no billing reference.**
`ContractOverview.tsx` renders only "What's Included" from `IContractOverview`
(`packages/billing/src/actions/contractActions.ts:1150-1160`); there is no profile, terms, or
provenance field in the read model.

**5. Profile settings say "Not set" where the engine uses Net 30.**
`packages/clients/src/components/clients/ClientBillingProfileSettings.tsx:184,203` — the inherit
option falls back to `notSetLabel` because `clientValues.paymentTerms` is null. But an invoice
dated under that profile is due Net 30. `BillingConfiguration.tsx:57` masks this on the client form
by coercing `''` to `net_30` on save, so the false label survives mainly on legacy rows.

**6. The simulator never says which profile it priced.**
`ContractScenario.client_binding` carries only `client_id/client_name` or a hypothetical
`tax_region` (`packages/types/src/interfaces/contractSimulation.interfaces.ts:207-209`).
`resolveClientBinding` never reads `client_contracts.billing_profile_id`
(`ee/server/src/lib/billing/simulator/snapshotContractToScenario.ts:1142-1284`), and the workspace
mounts assumptions with no identity (`ContractSimulatorWorkspace.tsx:626`).

## What changes

One read model, one builder, two surfaces. No parallel resolution logic.

**New `shared/billingClients/contractBillingTrace.ts`.**
`buildContractBillingTrace(input)` is pure and unit-testable: it takes the contract currency and
frequency, the client's default profile, assignments (`client_contract_id`, `billing_profile_id`,
name, `is_active`), lines (`contract_line_id`, `billing_profile_id`, `billing_frequency`), the
client's terms/method, and `resolveEffectiveBillingIdentity`'s output. It calls `resolveChargeProfile`
per line instead of re-deriving `line ?? contract ?? default`, and `paymentTermDays` for arithmetic.
`loadContractBillingTrace(knex, tenant, { contractId, clientContractId? })` does the tenant-scoped
reads (contract, `client_contracts`, `contract_lines`, `client_billing_profiles`, `clients`) and
rejects a profile whose `client_id` does not own the assignment (same guard as
`shared/billingClients/clientContracts.ts:490-500`). Shape, in
`packages/types/src/interfaces/contract.interfaces.ts`: `asOf`, `profiles[]` (id, name, source,
lineCount, isActive), `terms { value, source, days, dueDateExample }`, `fields[]`
(`{ key, label, value, source }` for bill-to, payment method, tax exemption, tax region, delivery,
template, PO, currency, cadence), `warnings[]` (`inactive_profile`, `mixed_profiles`,
`line_override`, `work_item_override_possible`), and an optional `workItemProfiles[]` (see below).

**Step 4: the work item's profile.** The chain is line → contract → work item → client default, and
the engine does reach step 4: time entries are loaded with
`COALESCE(tickets.billing_profile_id, projects.billing_profile_id)` (`billingEngine.ts:2812`, `:5880`)
and passed to `resolveChargeProfile` (`computeTimeBasedCharges.ts:329`). So a contract whose lines and
assignment have no profile does not bill time on the client default when the ticket or project carries
another profile. Findings from the engine, which match the resolver doc comment:
- On a contract, only time reaches step 4. Fixed-price, usage, bucket and product/license charges are
  never given a work-item profile. Project milestone and deposit charges are: `calculateProjectScheduleCharges`
  (`billingEngine.ts:2467-2470`) resolves them with the project's `billing_profile_id`. They have no
  contract line, so they are outside the contract trace. Unresolved non-contract time also uses step 4
  and has no contract to trace.
- Time is routed to a line by the engine's time loader (`loadTimeBasedObligation`), which runs for every
  live client contract line. It takes an entry that names the line in `time_entries.contract_line_id`, or
  an unassigned entry whose service belongs to only that line, and it filters on the line's services
  (`contract_line_services`) and never on `contract_line_type`. Rates come from the catalog price, so no
  Hourly config is required. Any line that has services can therefore price time, whatever its type,
  and the trace keys on exactly that: `serviceCount > 0` (rows in `contract_line_services`). A line with
  no services cannot price time and is not flagged.
- A line can reach step 4 only if steps 2 and 3 are both empty, i.e. `resolveChargeProfile` without a
  work item lands on `client_default`. Assigned lines and assigned contracts never raise the warning.
  A client with one profile raises it only if one of its work items carries another client's profile.
- The ticket→project relationship is the engine's `COALESCE(ticket, project)`, where the project is the
  task's project or the single billable-linked project of the ticket. The loader takes the distinct
  non-null `billing_profile_id` of the client's tickets and of its projects. That is a superset of what
  any single charge sees, which is the right size for "profiles this could resolve to".

The trace stays on `resolveChargeProfile`: every candidate is resolved by a call that includes
`workItemBillingProfileId`, then its identity comes from `resolveEffectiveBillingIdentity` and its terms
from the same `buildTerms` (`paymentTermDays`, `dueDateForPaymentTerms`). A candidate that resolves to
where the line already lands is dropped. Shape: `warnings[]` gains
`{ code: 'work_item_override_possible', contractLineIds, candidateProfiles: [{ billingProfileId, name }] }`;
`workItemProfiles?: ContractBillingTraceProfile[]` carries each candidate with `source: 'work_item'`,
its `terms` and the number of affected lines. They are conditional, so they are kept out of `profiles[]`;
`profiles[0]` stays the primary and the client-default entry stays as the real fallback. The warning is
raised even when no work item carries a profile yet, because one can be set at any time, and then
`candidateProfiles` is empty. The due-date sentence for the client default adds "unless the ticket or
project is billed to another profile" whenever the warning is present.

A candidate profile owned by another client of the tenant is kept, not excluded. Nothing ties a ticket's
or project's profile to its client (the FKs are tenant-scoped; a ticket that moves client keeps its
profile), and the engine looks the id up with no ownership check, so it bills with that profile. The
loader therefore queries the client's tickets and projects even for a one-profile client, loads the
foreign rows by id, and the warning fires for a one-profile client only when such a candidate exists.
An id that matches no profile in the tenant still throws. Contract and line pointers still throw on
foreign profiles, because an operator authored them.

`loadContractBillingTrace` is not purely a read: it calls `ensureClientDefaultBillingProfile`, which can
insert the default profile for a client that has none. That is inherited engine convention and is kept.
The step-4 query runs only when at least one line can reach step 4.

**`getContractOverview` (`contractActions.ts:1165`).**
Add `billingTrace: ContractBillingTrace | null` to `IContractOverview`; populate for live contracts,
return `null` for template contracts. One extra query set, same `billing:read` gate and
`createTenantKnex()`.

**`ContractOverview.tsx`.**
Render a new presentational `BillingTermsSection` under the summary stats: profile name(s) with
"client default" / "assigned on contract" / "set on line"; payment terms and the source that won; a
due-date sentence ("a 2026-10-22 invoice is due 2026-11-21 — Net 30 from the client"); and a
disclosure of the remaining fields. This answers finding 3 without turning the card into a form.

**`ContractDetail.tsx` assignment field.**
Remove the `:207-209` early return. Read-only mode always states the profile — assigned name, the
named default (`defaultProfile?.name`), or "no profile — allocation pending" on load error.
`unassignedLabel` becomes "Use {default name} (client default)". Editing still renders the picker
only when `isSegmented`; a single-profile client keeps a text line instead of an empty slot, so D6
still governs *inputs* while the fact becomes visible.

**`ClientBillingProfileSettings.tsx`.**
For `payment_terms`, when the client has no normalized terms, pass
`t('clientBillingProfileSettings.inheritDefaultTerms', { value: termsLabels.net_30 })` ("Inherit
from client (no terms set — Net 30 applies)") instead of `notSetLabel`, which stays for free-text
fields that genuinely have no value.

**Simulator.**
`ContractScenario` gains optional `billing_identity: ContractBillingTrace | null`.
`snapshotContractToScenario` stores `loadContractBillingTrace` for the binding it resolved; drafts
and template-only scenarios carry `null`. `AssumptionsPanel` or the workspace header renders the
profile name, terms, source and `as_of`. Persisted scenarios without the field remain valid.

## Data/contract decisions

**Decision: the contract stores pointers only; terms and identity are resolved live at read time.
Nothing is snapshotted onto the contract.**

Argued explicitly:
- The engine itself is live. `resolveInvoiceDueDate` → `resolveEffectiveBillingIdentity` reads the
  profile and client rows at invoice generation (`invoiceDueDate.ts:30-35`,
  `invoiceGeneration.ts:4047-4066`). A stored copy on the contract would reintroduce exactly the
  drift this card exists to remove. Live resolution *is* the agreement guarantee.
- A contract is forward-looking: it describes what the *next* invoice will do. Its pointers
  (`contract_lines.billing_profile_id`, `client_contracts.billing_profile_id`) are already the
  durable intent; copying terms adds a second truth with no owner. No migration, no backfill, no
  columns — `billing_identity` is computed on a transient object.
- Historical truth already exists: issued invoices snapshot `billing_profile_id`,
  `payment_method`, `due_date`; charges snapshot `billing_profile_id` + `billing_profile_source`.
  So "effective date" is the invoice date for an issued invoice, "resolved now at `asOf`" for a
  future one. Profiles have no `effective_from`; effective dating is not part of this card.
- Consequence accepted: when a client's default terms change, an old contract's trace changes.
  That is correct — those are the terms the next invoice will use.

Corollary decisions:
- An *inactive* assigned profile keeps billing there. The trace shows it plus an `inactive_profile`
  warning; it does not silently substitute the default and move revenue.
- When line overrides exist the contract has no single profile: list the set with per-profile line
  counts and `mixed_profiles`; never print one name as if it were the whole contract.
- `client_billing_profiles.billing_cycle` is **not** displayed as effective cadence. It exists and
  `resolveEffectiveBillingIdentity` returns it, but invoice generation never reads
  `identity.billingCycle`; cadence is contract/line frequency plus the client anchor. Mark it
  "not yet applied". Currency likewise comes from `contracts.currency_code`, not the profile.

## Order of work

1. Types (`ContractBillingTrace`, `IContractOverview.billingTrace`, `ContractScenario.billing_identity`)
   and the pure `buildContractBillingTrace` with unit tests.
2. `loadContractBillingTrace` + wire into `getContractOverview`, with tenant and ownership guards.
3. `BillingTermsSection` in `ContractOverview.tsx` (sources, due-date sentence, warnings).
4. `AssignmentBillingProfileField`: always render, name the resolved default.
5. `ClientBillingProfileSettings` inherit label for terms.
6. Simulator scenario field + header/assumptions render.
7. i18n keys in `en/msp/contracts.json` and `en/msp/clients.json`, then the other locales.

## Non-goals

- No effective-dating of profiles or terms, and no historical reconstruction of a contract's terms.
- No `contracts.payment_terms` / `contracts.billing_profile_id` column, no snapshot table, no sync
  trigger.
- No change to invoice generation, charge attribution, or due-date computation.
- No profile pickers for single-profile clients (D6 remains); only the statement becomes visible.
- Simulator *pricing* is unchanged. Its tax ports still use client-level `is_tax_exempt`; per-profile
  exemption fidelity there is a separate defect, and this card labels what simulation uses.
- No portal, API, or reporting changes.

## Risks

- **Tenancy.** Reads use `tenantDb`/`tenantJoin`, and profile ownership is validated against the
  assignment's client, not just the tenant, so a cross-client pointer cannot leak a name. Test with
  two tenants holding identical-looking profiles.
- **Two sources of truth.** The card is only honest if UI and engine share the functions; any second
  `??` chain in a component will drift, so review should reject one.
- **Line-level overrides were absent from the card's analysis.** It assumes one profile per
  contract; the engine resolves per line, so a contract can bill several. The design presents a set
  and warns on divergence.
- **Profile cadence trap.** Showing `identity.billingCycle` would promise a staggered cycle the
  engine does not implement; the trace must label it dormant.
- **Stale pointers.** Assignments can reference deactivated profiles; resolution succeeds while the
  list hook filters `is_active`, so the UI must not infer "missing profile" from an empty list.
- **Legacy client terms.** Free-text values never applied; say "Net 30 default", do not echo them.
- **Simulator honesty.** Naming a profile while tax uses the client exemption demands exact copy.

## Test plan

Existing files to extend or use as fixtures:
- `packages/billing/src/lib/billing/invoiceDueDate.test.ts` — due-date arithmetic parity.
- `packages/billing/tests/billingProfileResolution.test.ts` — chain steps and sources.
- `server/src/test/integration/billing/billingProfileSettings.integration.test.ts` — profile/client
  per-field fallback.
- `server/src/test/integration/billing/billingProfileAttribution.integration.test.ts` — line vs
  contract vs default attribution.
- `packages/clients/src/components/clients/ClientBillingProfileSettings.i18n.test.ts` — label copy.
- `packages/billing/tests/ContractOverview.legacyTransition.test.tsx` and
  `ContractDetail.featureFlag.test.tsx` — render harness patterns.
- `ee/server/src/__tests__/integration/contractSimulator.integration.test.ts` — scenario snapshot.

New cases:
- `shared/billingClients/contractBillingTrace.test.ts`: single-profile default; explicit assignment;
  line override beats assignment; missing profile at both levels → default; client terms null →
  Net 30 with `source: default`; profile terms override client; tax region labelled client;
  inactive-profile warning; `mixed_profiles` only when more than one profile actually bills;
  step 4: warning plus candidate terms for an unassigned line that has services (any type), warning with no candidates when
  no work item carries a profile, nothing for an assigned contract or line, nothing for a line with no services or a one-profile client, foreign candidate rejected.
- Contract-overview integration: one-profile and multi-profile clients, template returns `null`,
  cross-tenant profile rejected, trace due-date offset equals `resolveInvoiceDueDate`; a ticket on
  Profile B under an unassigned contract gives a candidate whose profile and due date equal the
  engine's `resolveChargeProfile` (with the ticket's profile) + `resolveInvoiceDueDate`, and a ticket
  with no profile lands on the client default in both.
- `ContractOverview` UI: profile name visible for one profile (finding 1); default named in the
  assignment field (finding 2); every row carries a source (finding 3); line-override warning shown.
- `ContractDetail` assignment field: read-only text for one profile; picker + named default for
  several; edit mode on one profile shows text, not an empty slot.
- `ClientBillingProfileSettings`: no client terms shows the Net 30 inherit label, never "Not set";
  Net 15 names Net 15; profile override still names the client fallback.
- Simulator: live scenario carries `billing_identity`; draft carries `null`; header renders name and
  terms; old scenario JSON without the field simulates unchanged.
