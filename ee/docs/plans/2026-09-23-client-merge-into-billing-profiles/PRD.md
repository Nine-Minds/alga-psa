# PRD — Merging Clients Into Billing Profiles

- Slug: `client-merge-into-billing-profiles`
- Date: `2026-09-23`
- Status: Implemented (first slice) — see [`features.json`](./features.json)
- Branch: `feature/billing_profile_client_merge`
- Builds on: [`../2026-08-15-billing-profiles-sub-account-billing/PRD.md`](../2026-08-15-billing-profiles-sub-account-billing/PRD.md)
- Feature checklist: [`features.json`](./features.json)
- Test checklist: [`tests.json`](./tests.json)
- Working notes: [`SCRATCHPAD.md`](./SCRATCHPAD.md)

## Summary

Billing profiles let one client hold several billing identities. Every tenant that
needed that *before* profiles existed did the only thing available: they created one
client per site or per legal entity. Those tenants now carry the exact fragmentation
the profiles feature was built to remove — split tickets, split contacts, split
assets, no group-level view — and no way out, because the profiles feature can only
be used on new structure.

This effort supplies the way out. An MSP picks a source client and a target
("parent") client; the source's billing profiles **move** to the target keeping their
identity, their history and their invoices, and the source's tickets, contacts,
projects, assets and portal structure follow. The source client is archived as a
tombstone pointing at the target.

It also supplies the piece that makes the merged result usable from the client
portal: a contact can be named the **manager of a billing profile** and — as a
separate, explicit opt-in — be granted visibility of every ticket attributed to that
profile, without being granted visibility of the whole (now much larger) parent
client.

## Problem

Three problems, one shape:

1. **No path from "N clients" to "one client, N profiles".** The workaround the
   profiles PRD names as the thing it replaces is already in production data. Nothing
   converts it.
2. **Merging naively destroys billing history.** A client's invoices, billing cycles,
   payment methods, credits and tax settings are all keyed to billing profiles that
   are in turn keyed to the client. Re-pointing history at the parent's default
   profile would collapse every source's history into one undifferentiated pile and
   silently change what a re-generated invoice produces.
3. **Post-merge the portal gets coarser, not finer.** Before the merge, a site
   manager logged into "Acme North" and saw Acme North's tickets. After the merge
   there is one client, and the only choices are "own tickets only" or "the whole
   parent" — the site manager either loses their team's tickets or gains every other
   site's.

## Goals

- Move a client's billing profiles to a parent client **without breaking the link
  between a profile and its history** — invoices, cycles, payment methods,
  transactions, credits and tax settings all stay attached to the same profile.
- Move the operational entities (tickets, contacts, projects, assets, interactions,
  documents, contracts, locations, portal visibility groups, inbound email domains,
  tags) to the parent so the group is one relationship again.
- Attribute the moved operational rows to the moved profile rather than letting them
  fall back to the parent's default, so per-segment reporting survives the merge.
- Let the operator decide, per contract, between "move it with its original dates"
  and "terminate it and start a fresh one on the parent at a cutover date".
- Associate contacts with billing profiles, with an optional manager designation.
- Add a third portal ticket-visibility shape — *own tickets **plus** every ticket of
  the billing profiles I manage* — as an explicit per-contact opt-in.
- Leave an audit trail good enough to explain what a merge did, months later.
- Never apply an external-accounting (QBO/Xero) remap without the operator
  confirming it.

## Non-goals

- A reversal engine. The merge is audited, not undoable (operator answer Q4). Where
  an inverse operation is cheap (a profile can be moved back by hand) that is a
  manual repair, not a product feature.
- Merging billing profiles *into each other*, or splitting one. The unit that moves
  is a whole profile.
- Changing how invoices are produced. A moved billing cycle regenerates the same
  invoice it would have produced before the merge — that is the T013-style invariant
  this effort inherits from the profiles plan and must not break.
- Creating per-profile QBO/Xero sub-customers. The remap dialog re-points the
  existing client-level mapping; sub-customer depth is a follow-up slice.
- A group-wide `ticket_scope = 'billing_profile'` visibility mode. Operator answer Q5
  ruled this out: visibility is per user *and* profile, not a property of a group.

## Users and Primary Flows

1. **MSP billing administrator** opens the parent client, chooses *Merge a client
   into this one as a billing profile*, picks the source, maps its contacts to the
   moved profile, decides each contract's date treatment, reviews a dry-run preview,
   types the source name to confirm, and then accepts or skips the suggested
   QBO/Xero remap.
2. **MSP account manager** afterwards sees one client with N billing profiles, all
   tickets and contacts in one place, and per-profile spend reporting that still
   distinguishes the sites.
3. **Client-side site manager** logs into the portal and sees their own tickets plus
   every ticket belonging to the billing profile they manage — not the whole parent.
4. **Client-side ordinary user** logs in and sees exactly what they saw before: their
   own tickets.

## Design

### D1 — Profiles **move**, they are not copied (operator answer Q1)

The whole design turns on this. `client_billing_profiles` is the join point for
billing history:

| Table | Column | Nullability |
|---|---|---|
| `client_billing_cycles` | `billing_profile_id` | NOT NULL |
| `payment_methods` | `billing_profile_id` | NOT NULL |
| `client_tax_settings` | keyed `(tenant, client_id, billing_profile_id)`, NOT NULL | — |
| `invoices` | `billing_profile_id` | nullable (20260818050000: "historical invoices predate profiles entirely") |
| `transactions`, `credit_tracking` | `billing_profile_id` | nullable (20260818060000, F107/F108) |
| `invoice_charges` | `billing_profile_id` | nullable |
| `credit_allocations` | via its transaction | nullable |

Re-parenting the profile row itself (`client_id → target`, `is_default = false`,
`is_system_managed_default = false`) makes **all** of that history follow the profile
with no history rewrite at all. The merge then re-stamps `client_id → target` on
those history rows, because the codebase everywhere assumes
`profile.client_id == row.client_id`, and client-level rollups read the client
column.

The nullable three matter for a second reason. Live write paths still produce a
null profile — `salesOrderInvoicingActions` inserts an invoice and its
transaction without one, a credit transfer in `creditActions` inserts
`credit_tracking` without one — and a null matches no moved profile. Those rows
are therefore stamped with the source's moved default *before* the move, exactly
as tickets, projects and contracts are; otherwise they keep `client_id` pointing
at the tombstone and fall out of the target's credit balance and AR rollups, and
a transferred credit can never be applied again. Stamping (rather than moving
them still-null) is also what preserves the blast radius: a client-wide credit of
the absorbed client stays inside its own segment instead of becoming a credit the
whole parent can spend. `invoice_charges` and `credit_allocations` carry no
client column, so nothing of theirs is stranded; a null there still resolves
through the parent invoice or transaction, which has moved.

The source client keeps a freshly inserted system-managed default profile so the F002
invariant ("every client has exactly one default") still holds for the archived
shell.

The earlier draft's rule — *block the merge on an open billing cycle, leave invoices
behind* — is **deleted**. Open cycles move intact, under the same per-tenant billing
advisory lock invoice generation takes, so a cycle cannot move mid-generation.

### D2 — Contracts: original dates or cutover, operator's call (Q2)

Per contract the wizard offers:

- **Move with original dates** — `client_contracts.client_id → target`, dates
  untouched, and `billing_profile_id` stamped to the moved profile when it was NULL
  (otherwise the attribution chain would re-resolve the contract to the *parent's*
  default profile).
- **Cut over** — terminate the source contract at a chosen date and clone it onto the
  parent starting at that date. The suggested default is the next period start; the
  operator decides.

Either way the *owner* of a client-owned contract moves too:
`contracts.owner_client_id → target`. This is not bookkeeping. The recurring chain
reads the owner — `recurringServicePeriodSync` keys the client cadence off it, and
`invoiceGeneration` joins `recurring_service_periods → contract_lines → contracts →
clients` on it to match the cycle's client — so an owner left behind on the tombstone
makes every moved recurring contract unbillable: generation fails with *"Recurring
service periods were not materialized for this recurring execution window"* rather
than producing a wrong number. `contracts_system_managed_default_unique_per_client`
allows one system-managed default contract per owner, so when the parent already has
its own container contract the incoming one is demoted to an ordinary client-owned
contract — the same demotion the source's default billing profile gets.

### D3 — One profile per source, identity preserved (Q3)

Every source profile moves 1:1 keeping its `billing_profile_id`, its name (the
source's default profile is renamed to the source client's name so it is still
identifiable inside the parent), its bill-to/tax identity columns and its history.
A multi-profile source keeps full per-profile attribution.

### D4 — Audit, not undo (Q4)

`client_merges` records the source and target, the moved profile ids, per-entity
moved-row counts, the contract decisions, who and when. `clients` gains
`merged_into_client_id` / `merged_at` so a stale link to the source is explainable.

Two things are emitted after the transaction commits, from both the server action and
the API service so a merge driven through the MCP is not invisible: the `CLIENT_MERGED`
workflow event (`buildClientMergedPayload` — this is its first production caller) and a
`client_merged` analytics event carrying the moved-row counts and the options taken,
never tenant data. Analytics failure is swallowed: the merge has already committed.

### D5 — Visibility is per contact **and** per profile (Q5, Q6)

`billing_profile_contacts` associates a contact with a profile and carries two
independent flags:

- `is_manager` — a label (at most one manager per profile, partial-unique).
- `can_view_profile_tickets` — the ticket-visibility grant, default **false**.

For a contact whose effective ticket scope is `contact` (own tickets), the portal
predicate becomes:

```
contact_name_id = me
  OR billing_profile_id IN (my granted profiles)
  OR (billing_profile_id IS NULL AND client default profile ∈ my granted profiles)
```

With no grants this is byte-identical to today's own-tickets rule. `client`-scoped
users and client admins are untouched — the MSP that wants everyone to keep seeing
everything changes nothing. Location managers are expressible because a location
already points at a profile via `default_billing_profile_id`.

Naming a manager writes **nothing** to `client_portal_user_billing_profiles`:
restricting which billing *segments* a portal user can see stays a separate,
deliberate MSP action.

### D6 — Any target, recorded parent pre-selected (Q7)

Clients carry a soft "parent company" link in `clients.properties.parent_client_id` —
a jsonb field set on the client form, with no FK and no engine behaviour. Requiring
the merge target to be that client would make the feature unusable for the many
tenants that never fill it in. So: **any client may be the target**, and the recorded
parent is pre-selected when present. Merging a client into its own soft-link
descendant is blocked (cycle guard), and after a merge, other clients pointing at the
source are re-pointed at the target.

### D7 — External accounting: suggest, never decide (Q8)

The final step lists the source's `tenant_external_entity_mappings` rows with a
pre-selected suggestion (re-point `alga_entity_id` to the target). Nothing is applied
until the operator confirms, and "leave unmapped for manual re-link" is always
available.

### D8 — All contacts move; each is mapped to a profile (Q9)

There is no per-contact opt-out — a contact left on an archived client is a support
ticket waiting to happen. The wizard's contact step assigns each source contact to a
billing profile (pre-suggested: the source's moved default) and can set the manager
flag inline. The source's `client_portal_visibility_groups` move with the contacts
(renamed on name collision), so a moved contact's `portal_visibility_group_id` keeps
resolving and never raises `VISIBILITY_GROUP_MISMATCH_ERROR`.

### D9 — Server actions, REST and MCP (Q10)

The merge, its preview, and profile-contact management are reachable from server
actions, from `/api/v1`, and — through the regenerated MCP registry — from
`search_api_registry` / `call_api_endpoint`.

## Data Model / Integration Notes

New tables:

- `billing_profile_contacts` — `(tenant, billing_profile_id, contact_name_id)` PK,
  `is_manager`, `can_view_profile_tickets`, `created_at`, `created_by`. Partial-unique
  one manager per profile. FKs to `client_billing_profiles` and `contacts`.
  Distinct from `client_billing_profiles.billing_contact_id`, which names the
  invoice recipient.
- `client_merges` — audit rows; `moved_profile_ids uuid[]`, `moved_counts jsonb`,
  `contract_decisions jsonb`, `strategy`, `merged_by`, `merged_at`.

New columns: `clients.merged_into_client_id`, `clients.merged_at`.

Both tables are tenant-distributed (Citus) and registered in
`packages/db/src/lib/tenantTableMetadata.ts` and the tenant-deletion activity list.

## Acceptance Criteria / Definition of Done

- A merge moves every source billing profile to the target with its
  `billing_profile_id` unchanged, and every invoice / cycle / payment method /
  transaction / credit / tax-settings row still resolves to it.
- The parent's own billing output is unchanged by a merge, and a moved billing cycle
  regenerates the same invoice it would have produced before.
- Tickets and projects that arrive with a NULL profile are stamped with the moved
  profile, never left to fall back to the parent default. So are the billing-history
  rows that legitimately carry no profile (invoices, ledger transactions, credits),
  which would otherwise stay on the tombstone and drop out of the target's AR.
- A moved billing cycle still regenerates the invoice it would have produced, with
  its charges attributed to the moved profile — which requires the moved contract's
  `owner_client_id` to follow it.
- The source client ends `is_inactive`, with `merged_into_client_id` set, holding one
  fresh system-managed default profile and nothing else.
- A second merge of the same source is refused.
- A contact granted `can_view_profile_tickets` on a profile sees that profile's
  tickets in the portal; a contact without the grant sees only their own.
- No external-accounting mapping changes without an explicit confirmation.

## Risks, Rollout, and Migration

- **Highest risk is silent billing drift.** Mitigated by moving rather than copying
  (nothing re-attributes), by stamping NULL profiles on moved work items, and by the
  integration test that re-generates an invoice from a moved cycle.
- **A forgotten table is the quiet form of that drift.** A client-keyed row left on
  the tombstone does not fail; it keeps a live write path aimed at an archived
  client. `sales_orders` is the sharp end — `salesOrderInvoicingActions` resolves
  the invoice client from `sales_orders.client_id`, so an order left behind later
  invoices a client nobody is looking at, against the empty default profile the
  merge created for it. The matrix is therefore exhaustive over the schema, not over
  a list someone wrote down: TM019 reads `pg_catalog` and fails until every table
  with a uuid `client_id` is moved, handled explicitly, or recorded in
  `CLIENT_KEYED_TABLES_LEFT_BEHIND` with a reason.
- **Concurrency with invoice generation.** The merge takes the same per-tenant
  billing advisory lock (`<tenant>:billing-semantics` + the
  `billing_semantics_locks` shard write) that every billing mutation takes.
- **Rollout is inert.** The migrations add two tables and two nullable columns;
  nothing in production changes until an operator runs a merge.
