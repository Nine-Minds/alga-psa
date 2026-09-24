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

There is a *second*, parallel expression of the same predicate: the authorization
kernel's `contact_visibility` relationship template
(`packages/authorization/src/kernel/relationshipTemplates.ts`), reached when a portal
user calls the MSP ticket actions. It is deliberately left unchanged in this slice —
it keeps producing the own-tickets predicate, which is the narrow (safe) direction,
and the portal's own read surfaces (`client-tickets.ts`, `dashboard.ts`,
`TicketService`) all go through `applyTicketVisibilityFilter`. Teaching the kernel
adapter about a billing-profile column is the follow-up if a profile manager ever
needs the grant on an MSP-side surface.

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
  change, so a moved location keeps pointing at the right profile. **But**
  `ux_client_locations_default_per_client` (`20260718234058`) allows one default
  location per client, so a source default arriving at a target that already has one
  aborts the entire merge on a unique violation. The merge demotes the source's
  default first, and only when the target actually has one.
- The other client-keyed tables that move are safe: `client_name_aliases` and
  `client_inbound_email_domains` are unique per *tenant* (alias / domain), not per
  client, so re-pointing `client_id` cannot collide. `tag_mappings`,
  `document_associations` and `asset_associations` can, and are de-duplicated
  row by row.
- `client_portal_visibility_groups` has `UNIQUE (tenant, client_id, name)` — moving a
  group to the target can therefore collide. Renamed with the source client name as a
  suffix.
- Migrations run with `transaction: false` because `create_distributed_table` cannot
  run inside a transaction on Citus.
- `sdk/scripts/generate-openapi.ts` cannot resolve the `@shared/*` path aliases when
  run from `sdk/` with its own tsconfig; run it as
  `npx tsx --tsconfig ../tsconfig.base.json scripts/generate-openapi.ts --edition ce`.
  Pre-existing — it fails the same way with this branch's changes stashed.
- `x-chat-approval-required` declared on the route is **not** enough to gate the
  endpoint. The spec generator nests route extensions under an `extensions` object
  while `ee/scripts/generate-chat-registry.mjs` reads
  `operation['x-chat-approval-required']` from the operation root, so the declaration
  alone emits `approvalRequired: false`. The flag reaches the registry through the
  curated overrides in `ee/docs/api-registry/*.json`, which the generator applies
  after collecting the spec — the same route the 13 other approval-gated endpoints
  (`PUT`/`DELETE /email/templates/{name}`, …) take. `ee/docs/api-registry/clients.json`
  therefore carries `approvalRequired: true` for `POST /clients/{id}/merge` (plus
  `rbacResource: client` for the four new endpoints, which the spec's nested
  `x-rbac-resource` loses the same way), and
  `server/src/test/unit/api/clientMerge.contract.test.ts` asserts the emitted entry in
  both the CE and EE registries rather than the source string, so a regeneration
  cannot silently drop the gate. The declaration on the route is kept so the metadata
  is right if the generator is ever fixed.

---

## Round 2 — what the real-database test found

`server/src/test/integration/clientMerge.integration.test.ts` now exists and runs
against a real Postgres (`createTestDbConnection({ databaseName: 'test_db_client_merge' })`,
the `billingProfileAttribution` recipe). Writing it surfaced two defects the
in-memory engine test could not:

1. **Client-owned contracts became unbillable.** Generating the moved February cycle
   failed with *"Recurring service periods were not materialized for this recurring
   execution window"* because `recurring_service_periods` has no client column at
   all — the chain resolves the client through `contract_lines → contracts.owner_client_id`.
   The merge now re-points that owner (M033), demoting the source's system-managed
   default contract when the target already owns one
   (`contracts_system_managed_default_unique_per_client`).
2. **Billing history with a null profile was stranded.** `invoices`, `transactions`
   and `credit_tracking` are nullable by design and live paths still write nulls
   (`salesOrderInvoicingActions`, the `creditActions` transfer), so
   `whereIn('billing_profile_id', movedProfileIds)` skipped them and left
   `client_id` on the tombstone. They are now stamped with the moved default first,
   and the move keys on `client_id` alone.

Two fixture notes worth keeping:

- The suite's `withTransaction` mock opens a **real** transaction when handed the root
  connection, unlike the pass-through the other billing suites use. The
  one-default-profile-per-client guard is a `DEFERRABLE INITIALLY DEFERRED` constraint
  trigger (`20260817000000`), so a merge that auto-commits statement by statement
  trips it on an intermediate state production never commits.
- Per-profile invoice production is behind the `billing-profiles-separate-invoicing`
  flag (off in tests), so a cycle bills everything its client owes in the period. The
  TM011 fixture therefore ends the parent's line with January, and asserts that every
  charge on the regenerated invoice carries the moved profile — a leaked parent charge
  would fail both ways.
- A `vi.hoisted()` collector array passed to the `@alga-psa/event-bus/publishers` mock
  factory never received pushes even though `mock.calls` recorded the call; the test
  reads the published events off `vi.mocked(publishWorkflowEvent).mock.calls` instead.

## Round 3 — the merge an operator actually ran

The first real merge from the UI aborted at the document move:

```
update "document_associations" set "entity_id" = $1 ...
  - duplicate key value violates unique constraint "uq_document_associations_single_true_logo"
```

A client avatar is a `document_associations` row flagged `is_entity_logo`, and
`20260814090000` keeps one per `(tenant, entity_id, entity_type,
entity_logo_variant)`. Both clients in a merge normally have one, so the move
put two logos on the target. `movePolymorphic` only deduplicates on
`(document_id, entity_type)`, which is a different index, so nothing caught it.

The merge now demotes the incoming logo where the target already fills the slot
— the same thing uploading a replacement logo does in `entityImageService` — so
the target keeps its branding and the document still arrives, re-flaggable from
the UI. Slots the target leaves empty (a `wide` variant, say) are inherited
instead, and when both clients filed the *same* document the row that survives
deduplication takes the flag so it cannot vanish from a free slot (M034, TM016).

Every other partial unique index a merge can collide with was re-checked against
the schema: `ux_client_locations_default_per_client` and
`contracts_system_managed_default_unique_per_client` were already demoted,
`client_portal_visibility_groups`'s per-client name is renamed, and the rest
(`client_billing_cycles`, `payment_methods`, `client_tax_settings`) key on
`billing_profile_id`, which is unique per tenant and moves with the row — so
there is nothing for the target to already hold.

## Round 4 — billing the profile you just merged in

The merge lands the profile, but nothing downstream let an operator aim at it:

- **Generate → Manual Invoice** had a client picker and no profile picker, so a
  manual invoice was always attributed by fallback (`persistManualInvoiceCharges`
  resolves the client default) and `invoices.billing_profile_id` stayed NULL —
  only cycle-driven invoices were ever stamped (`createInvoiceFromBillingResult`).
- **Creating a contract** offered no profile at all. `client_contracts.
  billing_profile_id` existed since 20260816010000 and is step 3 of the chain,
  but only `assignContractBillingProfile` — an edit on an existing row — ever
  wrote it, so a contract could not be born attributed.

Both now ask, and only where asking makes sense: the picker is behind
`useClientBillingProfiles().isSegmented`, the one place the D6 invisibility rule
lives, so a client with a single profile sees no new control anywhere.

Deliberate asymmetry between the two surfaces. An invoice must bill exactly one
profile, so the manual screen pre-selects the default and has no "unassigned"
choice. A contract's assignment is optional by design (D3/F044 — a line may
override it, and NULL means "the client default"), so it uses the shared
`BillingProfilePicker` with its "Use the client's default profile" entry,
matching contract lines, locations, tickets and projects.

Attribution is left alone where nobody chose: the pre-selection runs only for a
segmented client, so a client with one profile submits `billing_profile_id`
NULL and its items are passed through untouched — the unsegmented path is
byte-identical to before rather than newly stamped, and the write path resolves
an unattributed invoice to the client default exactly as it always did. Guarding
that needs care in the test: `waitFor(loadProfiles called)` returns *before* the
resolved list commits, so the single-profile case settles its promise inside
`act` and asserts afterwards. Without the `isSegmented` guard the assertion
fails with `"profile-default"`, which is what makes it a real guard rather than
a race that happens to pass.

Validation lives at the write, not in the dialog: both paths reject a profile
whose `client_id` is not the client being billed (and the invoice path also
rejects an archived one). That is the merge-shaped failure — profiles move
between clients, and a stale id in a resumed draft or a replayed request would
otherwise bill the wrong customer. Changing the client in either dialog clears
the pick for the same reason.

Two write paths were carried along so a chosen profile is not quietly lost:
`getDraftContractForResume` returns it, and the renewals queue copies it onto
the renewal draft — otherwise the first renewal would silently fall back to the
client default.

`IClientContract` had been left behind: `client_contracts.billing_profile_id`
has existed since 20260816010000 and both the merge and the new creation path
read and write it, but the interface never declared it, so every consumer that
touched the field did so through a cast and `tsc -p shared/tsconfig.json` broke
on the first honest read (TS2339 in the assignment test). The field is now
declared optional and nullable next to the other attribution columns, matching
`ClientContractAssignmentCreateInput` — NULL still means "the client default".

## The move matrix was a remembered list, not the schema

Review found ~15 client-keyed tables no step moved. Enumerating `pg_catalog`
rather than trusting the enumeration turned up more, and sorted them into three
kinds:

- **Live rows that keep a write path aimed at the tombstone.** `sales_orders`
  (its `client_id` is what `salesOrderInvoicingActions` bills),
  `rmm_organization_mappings` (device sync would re-populate the client the merge
  just emptied), `client_tax_rates` (`client_tax_settings` already moved, and half
  a tax configuration is worse than either half), plus quotes, opportunities,
  inventory, prepaid hours, usage aggregation, accounting export lines and the
  service/appointment/telephony rows. All moved.
- **Columns that are not Alga clients at all.** `google_*_provider_config`,
  `microsoft_*`, `mcp_oauth_*` hold an OAuth *application* id — varchar or text,
  no foreign key to `clients`. Re-stamping one would break the integration
  outright. Recorded as left behind rather than silently skipped, because the next
  person enumerating the schema will ask the same question.
- **Tables that only look live.** `client_plan_bundles` is dropped by
  20251008000003 (which asserts it is gone) and reappears only where
  `ensureClientPlanBundlesTable` recreates it for legacy fixtures;
  `bucket_usage_unmappable_archive` is a one-time migration quarantine with no
  write path and no tenant-facade registration. TM019 caught the first one on its
  first run — the dev database does not have it and the test database does.

Three shapes needed handling beyond a single UPDATE. `client_billing_settings` is
keyed `(tenant, client_id)`, so the source row cannot land beside the target's:
the target's settings govern and the source's is dropped, the same call the
default-location demotion makes. `client_payment_customers` collides the same way
but names a live customer at Stripe, so a contested row is *left* on the tombstone
for a human rather than discarded on a guess. And the enterprise-only tables
(`credentials`, `entra_*`, `client_payment_customers`,
`opportunity_qbr_triggers`) are asked for with `hasTable` first — the engine is
shared, and touching a missing relation inside the transaction aborts the whole
merge in CE.

`hour_blocks` is the one honest compromise: prepaid hours carry no
`billing_profile_id`, so the segment they were bought for cannot be preserved and
they become spendable across the parent. Stranding them on a client that will
never file a ticket is worse.
