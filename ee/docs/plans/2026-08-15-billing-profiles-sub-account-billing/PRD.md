# PRD — Billing Profiles (Sub-Account Billing Within a Client)

- Slug: `billing-profiles-sub-account-billing`
- Date: `2026-08-15`
- Status: Draft — design settled, implementation not started
- Branch: `feature/billing-profiles-sub-account-billing-within-a-cl`
- Design source: [`docs/plans/2026-08-15-billing-profiles-sub-account-billing-plan.md`](../../../../docs/plans/2026-08-15-billing-profiles-sub-account-billing-plan.md)
- Feature checklist: [`features.json`](./features.json) — 123 features
- Test checklist: [`tests.json`](./tests.json) — 42 tests
- Working notes: [`SCRATCHPAD.md`](./SCRATCHPAD.md)

## Summary

Introduce a billing dimension that is orthogonal to the client tree. A client may hold
multiple **billing profiles**; contracts, contract lines, locations, and work items
point at a profile; every generated charge resolves exactly one profile through a
deterministic chain. Phase 1 makes cost segmentation accurate without changing how
invoices are produced. Phase 2 lets profiles bill separately — their own bill-to
identity, payment method, billing cycle, invoice document, and AR balance.

The design source above is the authority on architecture and rationale. This PRD is
the execution ledger.

## Problem

An MSP's *operational* customer hierarchy does not always match its *accounts-receivable*
hierarchy. Alga currently forces them to be identical: one client is one billing
identity, one invoice per billing cycle, one card on file.

Three recurring customer shapes break this:

| Shape | Structure | Need |
|---|---|---|
| **A — Multi-site group under one owner** | N sites, one identity provider tenant, one contract per site, a different card per site | Separate invoice documents, bill-to, and payment methods; one client relationship for tickets/assets/portal |
| **B — Shared site, multiple legal entities** | One physical site, one network, N separately-billed entities, one manager over all of them | Separate invoices per entity; one portal login showing the whole organization *and* which costs belong to which entity |
| **C — One legal entity, multiple facilities** | One tax ID, one bank account, N facilities each an operating/profit centre | *Not* separate invoices — accurate cost visibility per facility, consolidated and drill-down |

The available workaround is to split into N clients. That solves billing and breaks
everything else: fragmented tickets, assets, portal, and aggregate visibility. It
trades a billing problem for a relationship problem.

A second, pre-existing problem is surfaced by the same work: charge attribution is
currently invisible. `invoice_charges.location_id` is stamped entirely from the
contract line, so two time entries on work at different sites billed through one
hourly line receive the same location — and the contract-line disambiguation resolver
returns null silently when a service matches more than one line. Users have no way to
see how a charge was attributed or that attribution failed.

## Goals

- Model a billing profile as its own entity that locations and contracts point at,
  never as a property of location.
- Resolve a billing profile for every generated charge through one deterministic,
  explainable chain that always terminates.
- Deliver accurate per-segment cost reporting (MSP-side and portal) with no change to
  invoice production.
- Let a profile bill separately: own bill-to identity, tax settings, PO, delivery
  preferences, payment method, billing cycle, invoice document, and AR balance.
- Keep the feature completely invisible to clients that have a single profile.
- Make charge attribution legible, including the pre-existing silent-failure case.

## Non-goals

- Changing the client tree. Profiles are orthogonal; clients are untouched.
- Cross-profile credit transfer (strict isolation chosen; see Decision D7).
- Splitting a *single* fixed/recurring charge across segments — that requires one
  contract line per segment, which is the documented workaround.
- Merging or splitting existing profiles after charges exist.
- Fixing the two pre-existing billing bugs recorded in the design source §8.

## Users and Primary Flows

1. **MSP billing administrator** creates billing profiles under a multi-site client and
   assigns each site's contract to its profile.
2. **MSP dispatcher/technician** creates a ticket; its billing profile is soft-defaulted
   from the site and can be corrected. They are never blocked by it.
3. **MSP account manager** opens spend-by-profile reporting to answer "what does each
   site cost", and drills into the charges behind a number.
4. **MSP billing administrator** inspects an invoice line and sees, in plain language,
   why it was attributed to a given profile — and reviews a queue of entries whose
   contract line could not be resolved.
5. **Client business manager** logs into one portal, sees organization-wide spend, and
   drills into per-entity spend, invoices, tickets, and services.
6. **MSP billing administrator (phase 2)** marks profiles as billing separately; each
   profile then produces its own invoice with its own bill-to and card, and carries its
   own credit balance and aging.

## UX / UI Notes

- **Invisibility rule (Decision D6).** While a client has exactly one billing profile,
  no profile picker, profile column, portal segment tab, or spend-by-profile report is
  rendered. A single `useClientBillingProfiles(clientId)` hook returning
  `{ profiles, isSegmented }` is the only place this rule lives.
- Ticket profile assignment is a **soft default**, never a required field. A technician
  who ignores it produces a correctly-attributed charge in the common case.
- The attribution inspector renders a sentence, not a data dump: *"Billed to «profile»
  because the contract line is assigned to it"* / *"Billed to «profile» because the
  ticket is at that site; no contract assignment applies."*
- Where a charge type cannot reach work-item granularity (usage, bucket, fixed,
  project schedule), the inspector states that limitation rather than leaving the user
  to infer it from a surprising number.

## Data Model / Integration Notes

New table `client_billing_profiles` keyed `(tenant, billing_profile_id)`, with exactly
one `is_default` row per client and the `is_system_managed_default` marker following
the precedent in `server/migrations/20260321150000_add_system_managed_default_contract_marker.cjs`.

**Resolution chain — first hit wins:**

```
1. explicit billing_profile_id on the source record
2. contract_lines.billing_profile_id
3. client_contracts.billing_profile_id
4. work item — tickets.billing_profile_id / projects.billing_profile_id
5. client default profile                        (always terminates)
```

A contract assigned to a profile **always** beats the work item: a charge cannot land
on Profile A's invoice when Profile B's contract priced it. This ordering is what makes
all three customer shapes fall out of one chain with no mode flag — shapes A and B
assign contracts and stop at step 2/3; shape C leaves contracts unassigned and falls
through to step 4.

Charge types reach different depths. Only time (via the ticket/project join already
present at `billingEngine.ts:3739`) and manual items can reach step 4; usage, bucket,
fixed, and project-schedule charges have no segment-bearing source record and stop at
step 3.

Integration surface: `tenant_external_entity_mappings` is extended so a billing profile
can map to a QuickBooks **sub-customer** under the client's parent customer — a natural
fit, since a QBO sub-customer is exactly "a separate bill-to under one parent
relationship."

## Risks, Rollout, and Migration

| Risk | Mitigation |
|---|---|
| Phase-2 cycle change has wide blast radius — 11 non-test consumers of `client_billing_cycles` plus ~59 test files | Backfill makes every existing client single-profile, so behaviour is unchanged; a shared test-fixture helper absorbs the mechanical test diff |
| Money-affecting behaviour change | Backward-compatibility property (below) asserted in tests at every slice boundary |
| Tax precedence is a judgement call | `contract_lines.location_id` already resolves tax region; profile settings slot **below** contract-line location. Flagged for tax-aware review before Slice 7 lands |
| Silent mis-attribution | `billing_profile_source` recorded on every charge; unresolved queue surfaces failures |
| Per-profile invoice split going wrong in production | Gated behind a per-tenant feature flag for phase 2 |

**Backward-compatibility property** — the safety property for the whole effort:

> For any client with exactly one billing profile, every invoice, total, tax figure,
> credit application, portal view, and accounting export is **identical** to
> pre-change output.

Phase 1 needs no feature flag — the `count == 1` invisibility rule is a better gate,
because it is self-disabling.

## Open Questions

1. **Tax precedence.** Proposed: `service region → contract-line location region →
   profile tax settings → client default region`. Rationale: a contract line pinned to
   a physical location is a stronger claim about where service was delivered than the
   profile's billing identity. Needs confirmation from a tax-aware reviewer before
   Slice 7.
2. Should the unresolved-contract-line queue (F063–F064) ship as part of this effort or
   as its own card? It addresses a pre-existing defect and delivers value independently.

## Acceptance Criteria / Definition of Done

**Phase 1**
- Every client has exactly one system-managed default billing profile after migration.
- Every row written to `invoice_charges` carries a non-null `billing_profile_id` and a
  `billing_profile_source`.
- For single-profile clients, invoice output is byte-identical to pre-change output.
- No profile UI is visible for a single-profile client on any surface.
- Spend-by-profile reporting and portal segmentation are correct for all three customer
  shapes as fixture scenarios.
- Every invoice line and time entry can explain its attribution in plain language.

**Phase 2**
- A profile marked `bills_separately` produces its own invoice document with its own
  bill-to, tax, PO, delivery preference, and payment method.
- A credit issued against one profile cannot be applied to a sibling profile's invoice.
- Aging and statements key on profile; client-level views sum across profiles.
- Profiles map to QBO sub-customers; single-profile clients map to plain customers
  exactly as before.
- Portal users may be restricted to a subset of profiles, defaulting to all.
