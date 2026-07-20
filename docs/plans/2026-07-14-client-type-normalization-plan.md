# Fix: NinjaOne organizations cannot be mapped to Alga clients

**Branch:** `fix/ninjaone-alex-it-issue`
**Date:** 2026-07-14
**Reported by:** Alex IT — "When integrating NinjaOne, I am unable to map my Ninja Companies to clients in Alga."

## Summary

The reported symptom is in NinjaOne, but the bug is not. `importClientsFromCSV` writes
`client_type` straight from the spreadsheet cell into a database column that has no
constraint. Alex imported his client list with the column reading `Company` — the
natural thing a human types in a spreadsheet — so 41 of his 42 clients landed with
`client_type = 'Company'`, capital C.

Every reader compares `client_type === 'company'`, lowercase. So all 41 clients became
invisible to the NinjaOne mapping picker, which reports "No clients found." The Clients
page still lists them normally, because it renders the raw value through an i18n
`defaultValue` fallback and happily displays `Company` — which is what made this hard to
see.

The `ClientPicker` on the mapping screen also hardcodes `clientTypeFilter="company"` and
passes `() => {}` for both filter-change handlers, so its "Active Clients" / "Companies"
dropdowns render but do nothing. Alex could not even work around the data problem by
switching to "All Types".

Fix all three layers: the writer that let the value in, the schema that permitted it, and
the component contract that made the workaround impossible.

## Evidence

Production (`msp` namespace, via `sebastian-blue`):

| `client_type` | rows | first seen | last seen |
|---|---|---|---|
| `company` | 1466 | 2024-10-25 | 2026-07-14 |
| `Company` | 41 | 2026-07-06 | 2026-07-08 |
| `NULL` | 33 | 2024-11-12 | 2026-04-22 |
| `individual` | 19 | 2024-10-25 | 2026-05-14 |

- All 41 `'Company'` rows belong to Alex's tenant `5c6c48a0-9b69-4511-bd91-16991d7153aa`.
  That tenant has exactly one `'company'` client — the only one his picker can show.
- Those rows were created 2026-07-06..08, *after* migration
  `20260616120000_normalize_client_type_to_enum.cjs` ran on 2026-06-16. That migration
  cleaned this exact corruption once; it came straight back, because it fixed the data
  and not the writer. A data-only fix will regress a third time.
- `clients` is Citus hash-distributed (`partmethod: 'h'`) and **already carries a CHECK
  constraint of this exact shape** — `clients_billing_cycle_check`. Citus restricts
  primary-key/unique (must include the distribution column) and foreign keys, which is why
  `20260619120000_add_default_contact_to_rmm_org_mappings.cjs` skipped its FK. CHECK
  constraints are row-local and propagate to shards. Citus is not a blocker here.

`importClientsFromCSV` is the **only** writer with this hole. Verified: the v1 API
(`ClientService.ts:274`) takes its value from the zod enum in `CreateClientSchema`, and
`xeroCsvClientSyncService.ts:718` hardcodes `'company'`.

Note that `IClient.client_type` is *already* typed `'company' | 'individual' | null`
(`packages/types/src/interfaces/client.interfaces.ts:16`). The importer's parameter is
`Array<Record<string, any>>`, and that `any` launders the bad value past the type system
into the database. The invariant was declared; it just was not enforced anywhere.

### Blast radius beyond NinjaOne

The corruption is not cosmetic. Two readers branch on the exact string and silently treat
every one of Alex's 41 clients as an *individual*, changing contact-selection behavior in
ticket creation. He has not reported this yet, but it is live:

- `packages/tickets/src/components/QuickAddTicket.tsx:609`
- `packages/tickets/src/actions/ticketFormActions.ts:56`

And eight `ClientPicker` call sites pass no-op filter handlers, so their filter dropdowns
are dead controls. Alex would hit the identical wall on Huntress, Tanium, or Level.io:

- `ee/.../integrations/ninjaone/OrganizationMappingManager.tsx`
- `ee/.../integrations/huntress/OrganizationMappingManager.tsx`
- `ee/.../integrations/{TaniumIntegrationSettings,LevelIoIntegrationSettings,HuntressIntegrationSettings}.tsx`
- `ee/.../workflow-designer/WorkflowActionInputFixedPicker.tsx`
- `packages/projects/src/components/ProjectDetailsEdit.tsx`
- `packages/tickets/src/components/TicketImportDialog.tsx`

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Enforcement | DB CHECK constraint + normalize on write | Convention alone already failed once. `clients_billing_cycle_check` proves Citus allows it. |
| Bad CSV values | Case-fold what we recognize, reject true junk | `Company` → `company` silently; `Vendor` fails that row loudly rather than importing a client that is invisible forever. |
| NULL rows | Eliminate them | `NOT NULL DEFAULT 'company'`. Two legal values, no null branch in any reader. |
| Picker contract | Make filter props optional / uncontrolled | Fixes all eight call sites and removes the trap for future callers, rather than patching NinjaOne alone. |
| NinjaOne type filter | Unrestrict | A NinjaOne org may map to any client. An individual-type client is still a client. |

`DEFAULT 'company'` is deliberate and load-bearing: the 33 NULL rows exist *because* some
writer inserts a client without the column. A bare `NOT NULL` would convert that silent
gap into a hard insert failure. The default keeps every existing writer working while
still guaranteeing the invariant.

Ticket alga0002129 was opened to research NULL semantics and then resolved — we decided
inline to eliminate NULL rather than defer.

## Implementation

### 1. Shared normalizer

Add `normalizeClientType(value: unknown): 'company' | 'individual'` in
`packages/clients/src/lib/normalizeClientType.ts` (co-located with the client schemas;
export from the package index).

Rules:

| Input | Result |
|---|---|
| `'company'`, `'Company'`, `'COMPANY'` (any case, trimmed) | `'company'` |
| `'individual'`, `'Individual'` (any case, trimmed) | `'individual'` |
| `''`, `null`, `undefined` | `'company'` (preserves today's default) |
| anything else (`'Vendor'`, `'Customer'`) | throws `InvalidClientTypeError` |

### 2. Migration — `server/migrations/<ts>_enforce_client_type_enum.cjs`

In one transaction:

1. Case-fold off-enum values (idempotent; re-runs the June normalization):
   - `lower(client_type) = 'individual'` → `'individual'`
   - any other non-null, off-enum value → `'company'`
2. `UPDATE clients SET client_type = 'company' WHERE client_type IS NULL;` (33 rows)
3. `ALTER TABLE clients ALTER COLUMN client_type SET DEFAULT 'company';`
4. `ALTER TABLE clients ALTER COLUMN client_type SET NOT NULL;`
5. `ALTER TABLE clients ADD CONSTRAINT clients_client_type_check CHECK (client_type IN ('company','individual'));`

Steps 1–2 must fully precede 3–5 or the constraint will not validate. Model the DDL on
`clients_billing_cycle_check`.

`down`: drop the constraint, drop NOT NULL, drop the default. Do not attempt to restore
the original free-text values — they are not recoverable, same as the June migration.

### 3. Writer — `packages/clients/src/actions/clientActions.ts`

Apply `normalizeClientType` in `importClientsFromCSV` on **both** paths — the update path
(`:1619`) has the same hole as the create path (`:1694`):

```ts
// create (:1694)
client_type: normalizeClientType(clientData.client_type),

// update (:1619)
if (clientData.client_type !== undefined) {
  updateData.client_type = normalizeClientType(clientData.client_type);
}
```

Catch `InvalidClientTypeError` per row and surface it through the importer's existing
`ImportClientResult` error channel, so one bad row fails that row with a clear message
(`client_type must be 'company' or 'individual'`) without failing the whole import.

### 4. Picker contract — `packages/ui/src/components/ClientPicker.tsx`

Make the four filter props optional:

```ts
filterState?: 'all' | 'active' | 'inactive';
onFilterStateChange?: (state: 'all' | 'active' | 'inactive') => void;
clientTypeFilter?: 'all' | 'company' | 'individual';
onClientTypeFilterChange?: (type: 'all' | 'company' | 'individual') => void;
```

When a prop is omitted, `ClientPicker` owns that filter in internal state so its dropdown
works. When provided, it stays controlled — existing controlled callers are unaffected.
Defaults when uncontrolled: `filterState: 'active'`, `clientTypeFilter: 'all'`.

Implement as the standard controlled/uncontrolled pattern (internal `useState` seeded from
the prop; the prop wins when defined; call the handler when present).

### 5. NinjaOne mapping screen

`ee/server/src/components/settings/integrations/ninjaone/OrganizationMappingManager.tsx:252-255`
— delete all four filter props. The picker then defaults to active clients, all types, with
working dropdowns.

The other seven no-op call sites get working filters for free. Do not otherwise change
them in this branch.

## Verification

Unit:
- `normalizeClientType` — the table in §1, including the throw on `'Vendor'`.
- `importClientsFromCSV` — a CSV row with `client_type: 'Company'` persists as `'company'`;
  a row with `'Vendor'` comes back as a failed `ImportClientResult` with a clear message
  and does not abort sibling rows.
- `ClientPicker` — uncontrolled: changing the type dropdown re-filters the list;
  controlled: the parent's value still wins.

Migration:
- Against a DB seeded with `'Company'`, `NULL`, `'individual'` and `'Vendor'` rows: all
  land on the enum, column is `NOT NULL`, and a subsequent `INSERT` of `'Bogus'` is
  rejected by the constraint.
- Migration is idempotent (run twice).

Live (dev stack on port 3021):
- Settings → Integrations → NinjaOne → organization mapping: the client dropdown lists
  clients and a mapping can be saved.
- Regression: QuickAddTicket contact behavior for a `company` client is unchanged.

## Production remediation

The migration fixes Alex's 41 rows on deploy — no manual data surgery. After deploy,
confirm:

```sql
select client_type, count(*) from clients group by 1;
-- expect only 'company' and 'individual'
```

## Out of scope

- Whether `client_type` should be a Postgres enum type rather than text + CHECK.
- The `rmm_organization_mappings` stale-row behavior when a NinjaOne org is deleted or
  merged (noted during investigation; unrelated to this report).
