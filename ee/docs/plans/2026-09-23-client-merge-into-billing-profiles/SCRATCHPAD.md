# SCRATCHPAD — Merging Clients Into Billing Profiles

Working memory. Append discoveries, decisions and gotchas; revise earlier notes when
a decision changes.

- PRD: [`PRD.md`](./PRD.md) · Features: [`features.json`](./features.json) · Tests: [`tests.json`](./tests.json)
- Predecessor: [`../2026-08-15-billing-profiles-sub-account-billing/`](../2026-08-15-billing-profiles-sub-account-billing/)

---

## Operator answers, and what each one changed

| Q | Answer | What it changed in the design |
|---|---|---|
| Q1 | History should follow the corresponding billing profile | Profiles **move**, they are not copied. The earlier "block on an open cycle / leave invoices behind" rule was deleted outright. |
| Q2 | Dialog suggesting original date vs cutover | A per-contract step in the wizard, suggestion pre-selected, operator decides each row. |
| Q3 | Map | Every source profile moves 1:1, keeping its id, name, bill-to identity and history — the mapping is structural, no lookup table needed. |
| Q4 | No need for fully reversible | Audit only: `client_merges` + `clients.merged_into_client_id`. No reversal engine. |
| Q5 | Depend on user **and** billing profile | Dropped the group-wide `ticket_scope = 'billing_profile'` enum value (and its check-constraint migration). Grants are contact-keyed rows instead. |
| Q6 | Tickets only, opt-in | `can_view_profile_tickets` is a separate boolean from `is_manager`, default false. Naming a manager grants nothing. |
| Q7 | "give more details" | See below. Resolved as: any client may be the target; the soft parent link is only a pre-selection. |
| Q8 | Dialog suggesting remapping, no decisions made for the user | Post-merge step lists mappings with a pre-selected suggestion; nothing applies without confirmation. |
| Q9 | (contacts) | All contacts move, each mapped to a profile in the wizard. |
| Q10 | All in | Server actions + REST v1 + regenerated MCP registry. |

### Q7 in full — what "merge target" meant

`clients` has no parent column. The "parent company" a user sets on the client form
is stored in the `clients.properties` jsonb as `parent_client_id`: no FK, no index, no
engine behaviour, purely display. The open question was whether the merge target must
be that recorded parent.

It must not. Most tenants never fill the field in, so requiring it would make the
feature unusable for exactly the tenants that have the fragmentation problem. The
resolution:

- any client may be chosen as the target;
- when the source records a `properties.parent_client_id`, that client is
  pre-selected;
- merging a client into one of its own soft-link descendants is blocked (cycle
  guard);
- after the merge, other clients whose `properties.parent_client_id` pointed at the
  source are re-pointed at the target.

---

## Discoveries about the existing code

Verified by reading the tree on 2026-09-23; re-verify before relying on a line
number.

### Billing history hangs off the profile, not the client

`client_billing_cycles.billing_profile_id` and `invoices.billing_profile_id` are NOT
NULL (`20260818050000`); `payment_methods.billing_profile_id` is NOT NULL and
`transactions` / `credit_tracking` are nullable (`20260818060000`);
`invoice_charges.billing_profile_id` is nullable (`20260816010000`);
`client_tax_settings` was re-keyed to `(tenant, client_id, billing_profile_id)`
(`20260818040000`). That is why re-parenting the profile row carries the history for
free and why the merge only has to fix the redundant `client_id` columns.

### The attribution chain will re-resolve NULLs

`resolveChargeProfile` terminates at *the client's default profile*. A ticket or
project moved to the parent with a NULL `billing_profile_id` would therefore start
billing against the **parent's** default, not the segment it came from. Hence the
stamping step (M012) — this is the single most likely source of silent billing drift
in the whole feature.

### `no-feature-to-feature-imports`

`packages/clients` is a vertical feature package and may not import
`@alga-psa/billing` or `@alga-psa/integrations`. Two consequences:

- the billing advisory lock is re-expressed inline in the merge action rather than
  imported from `packages/billing/src/lib/billing/billingMutationLock.ts` (same two
  statements, comment points at the original);
- the external-accounting remap reads and writes `tenant_external_entity_mappings`
  directly rather than going through `externalMappingActions`.

### Portal visibility is contact-keyed everywhere

`getClientContactVisibilityContext` resolves a contact → group → boards → scope.
Adding a *group-level* profile scope (the earlier draft) would have been the only
non-contact-keyed thing in the system, and Q5 rules it out anyway. Grants being rows
on `billing_profile_contacts` keeps the whole feature in one shape.

`applyTicketVisibilityFilter` is called from six places; `billingProfileColumn` is
optional so an unmigrated call site *narrows* (own tickets only) rather than widening.
That is the safe failure direction and is asserted by TM004.

### `client_portal_user_billing_profiles`: absence means "all"

Documented deliberately in `20260818030000`. After a merge that is dangerous — a
source portal user with no rows would suddenly see every profile of the (much bigger)
parent. Hence grant pinning (M017), default on.

### `buildClientMergedPayload` already exists

`shared/workflow/streams/domainEventBuilders/clientEventBuilders.ts` has had a
`CLIENT_MERGED` builder and schema since the domain-event work, with no production
caller. This effort is its first one.

---

## Gotchas

- `tenant_external_entity_mappings` was created with a `tenant_id` column and renamed
  to `tenant` by `20250512094730_standardize_tenant_columns.cjs`. `tenantDb()` works
  on it; the original migration is misleading.
- `client_locations.default_billing_profile_id` needs no rewrite: profile ids do not
  change, so a moved location keeps pointing at the right profile.
- `client_portal_visibility_groups` has `UNIQUE (tenant, client_id, name)` — moving a
  group to the target can therefore collide. Renamed with the source client name as a
  suffix.
- Migrations run with `transaction: false` because `create_distributed_table` cannot
  run inside a transaction on Citus.
