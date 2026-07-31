# Fix duplicate client rows in `GET /api/v1/clients` (issue #2980)

**Branch:** `fix/api-clients-duplicate-rows`
**Issue:** https://github.com/Nine-Minds/alga-psa/issues/2980
**Status:** approved design; ready for implementation
**Follow:** `docs/AI_coding_standards.md`

## Problem

`ClientService.list` (`server/src/lib/api/services/ClientService.ts:174-214`) left-joins
`client_locations` filtered to `is_default = true` in both the data query and the count
query. The join emits one row per matching default-location row, so a client with N
`is_default = true` rows appears N times in the response and `pagination.total` inflates
identically.

Proven mechanism (verified against the dev DB): a client with exactly one default
location returns exactly one row; adding a second `is_default = true` row returns two.
The bug is *not* one-row-per-location as the issue title suggests — only rows with
`is_default = true` multiply the output.

Two ways multiple `is_default = true` rows arise today:

1. **Via the REST API.** `ClientService.createLocation` / `updateLocation`
   (`ClientService.ts:735`, `:770`) accept `is_default: true` and never clear the
   previous default. No DB constraint forbids the resulting state.
2. **Via normal UI use.** `updateClientLocation`
   (`packages/clients/src/actions/clientLocationActions.ts`) deliberately leaves
   `is_default = true` on rows it deactivates ("preserve historical audit data"), and
   deactivating the default promotes nothing. The next location created auto-becomes
   default → one inactive default + one active default → same fan-out.

The invariant logic (first location auto-default, clear-others-on-set,
promote-on-unset/delete) exists **only** in the UI server actions; the API service
re-implemented location CRUD without it. `contact_phone_numbers` already has the
protective partial unique index (`ux_contact_phone_numbers_default_per_contact`);
`client_locations` never got one.

## Design decisions (approved)

- **Option C — fix all three layers:** fan-out-proof queries, a DB partial unique
  index, and shared invariant enforcement.
- **Full parity:** extract the UI's default-management logic into a shared layer used
  by both the UI actions and the API service. API behavior changes accordingly (see
  "API behavior changes" below).
- **Strict single-default invariant:** `is_default = true` implies `is_active = true`,
  and at most one default exists per `(tenant, client_id)`. Rationale: billing readers
  (`packages/billing/src/models/invoice.ts:419,431`,
  `packages/billing/src/lib/adapters/tenantPartyAdapter.ts:65`) join
  `cl.is_default = true` with no `is_active` filter, so "audit" defaults on inactive
  rows already corrupt billing address selection. The UI's keep-default-on-inactive
  behavior is removed; deactivating the default promotes another active location.

## Implementation

### 1. Shared query helper — `packages/db`

Add a helper next to `tenantJoin` / `tenantJoinSubquery` in
`packages/db/src/lib/tenantDb.ts` (exact name up to implementer, e.g.
`tenantJoinDefaultRow`) that joins a **derived table** of at-most-one-row-per-parent
default children instead of the raw child table:

```sql
LEFT JOIN (
  SELECT DISTINCT ON (tenant, <parent_fk>) *
  FROM <child_table>
  WHERE is_default = true AND is_active = true
  ORDER BY tenant, <parent_fk>, updated_at DESC
) AS <alias> ON <parent>.<pk> = <alias>.<parent_fk> AND <alias>.tenant = <parent>.tenant
```

Build it on the existing `tenantJoinSubquery` so tenant scoping stays in the engine.
`DISTINCT ON` makes the join structurally incapable of fan-out even if bad data
reappears; the unique index (step 2) makes bad data unrepresentable. Parameters:
child table expression + alias, parent join columns, flag column(s) — keep it minimal,
it has exactly the six call sites below.

Note: `contact_phone_numbers` has no `is_active` column — the helper must take the
filter predicate (or flag columns) as a parameter rather than hard-coding
`is_active`.

### 2. Migration — dedupe, backfill, constrain

New migration `server/migrations/<timestamp>_enforce_single_default_client_location.cjs`:

1. **Clear inactive defaults:** `UPDATE client_locations SET is_default = false WHERE is_default = true AND is_active = false`.
2. **Dedupe active defaults:** for each `(tenant, client_id)` with more than one
   active `is_default = true` row, keep one winner — latest `updated_at`, then latest
   `created_at`, then `location_id` as a deterministic tiebreak — and demote the rest.
3. **Backfill missing defaults (parity):** for each client with at least one active
   location but no default, promote the earliest-created active location.
4. **Add the constraint:**
   `CREATE UNIQUE INDEX ux_client_locations_default_per_client ON client_locations (tenant, client_id) WHERE is_default = true;`
   (mirrors `ux_contact_phone_numbers_default_per_contact`).

`down`: drop the index only; the data normalization is intentionally not reversed.
Steps 1-3 must be plain SQL set operations (no per-row JS loops); the whole migration
runs in one transaction.

### 3. Shared invariant layer — `packages/clients`

Extract the default-management core from
`packages/clients/src/actions/clientLocationActions.ts` into a new model module
(`packages/clients/src/models/clientLocation.ts`, alongside the existing models).
Transaction-taking functions, no auth/revalidate concerns:

- `createLocation(trx, tenant, clientId, data)` — first active location auto-becomes
  default; `is_default: true` clears the existing default first (within the same
  transaction, ordered so the partial unique index is never transiently violated).
- `updateLocation(trx, tenant, clientId, locationId, data)` — setting
  `is_default: true` clears the previous default; unsetting the current default
  promotes another active location; **deactivating (`is_active: false`) the current
  default clears its flag and promotes another active location** (new behavior,
  required by the strict invariant).
- `deleteLocation(trx, tenant, clientId, locationId)` — dependency checks (tickets,
  tax rates) and promote-before-delete, as the UI action does today.

Rewire:

- UI actions in `clientLocationActions.ts` become thin wrappers (auth + transaction +
  revalidate around the shared functions). Their observable behavior changes only in
  the deactivation case described above.
- `ClientService.createLocation` / `updateLocation` / `deleteLocation`
  (`server/src/lib/api/services/ClientService.ts:735-826`) call the same functions.
  Map Postgres unique-violation (`23505`) races on the new index to a 409 Conflict
  API error.

### 4. Convert the fan-out-capable join sites

Use the step-1 helper at:

| Site | File | Child table |
|---|---|---|
| Clients list — data query | `server/src/lib/api/services/ClientService.ts:176` | `client_locations` |
| Clients list — count query | `server/src/lib/api/services/ClientService.ts:184` | `client_locations` |
| Contacts list — default phone | `server/src/lib/api/services/ContactService.ts:69-82` (`applyDefaultPhoneJoins`) | `contact_phone_numbers` |
| Contact getById — default location | `server/src/lib/api/services/ContactService.ts:195-199` | `client_locations` |
| Tickets — default contact phone | `server/src/lib/api/services/TicketService.ts:145-151` | `contact_phone_numbers` |

The sixth site, `TicketService.ts:487-498`, joins `client_locations` with a mixed
condition (`t.location_id = cl.location_id OR (t.location_id IS NULL AND cl.is_default)`);
the specific-location branch joins on the PK and cannot fan out, and the default
branch is protected by the new index. Leave its shape alone; add a code comment
pointing at the index.

Semantics note: the clients-list `cl` join only feeds `applyClientFilters`
(email/phone/address search against the default location) — nothing from `cl` is
selected. The derived-table join preserves those filter semantics exactly.

### 5. Tests

- **Migration test** (pattern: existing migration tests under `server/src/test/`):
  seed a multi-active-default client, an inactive-default + active-default client, a
  no-default client with active locations, and a healthy client; run the migration;
  assert winner selection, inactive-flag clearing, backfill, and index existence.
- **API integration tests** (issue #2980 regression): create a client; POST two
  locations with `is_default: true`; `GET /api/v1/clients` returns the client exactly
  once with correct `pagination.total`; the second location is default and the first
  was demoted.
- **Parity tests** for the shared layer via the API: first location auto-default;
  promote-on-delete; promote-on-unset; promote-on-deactivate; 409 on constraint race
  is exercised at least at the unit level.
- **UI action tests**: existing `clientLocationActions` coverage keeps passing with
  the wrappers; add/adjust a case for promote-on-deactivate.
- **Sibling regressions**: contacts list and tickets list with a contact that has
  multiple phone rows (one default) → no duplicate rows.

### 6. Verification (dev stack)

Dev stack for this worktree: server on `http://localhost:3578`, Postgres on
`localhost:5472` (db `server`). Run the migration, then replay the customer scenario
end-to-end via the API (create client → confirm one row → add locations with and
without `is_default` → confirm still one row, total correct). Verify the clients page
and a contact/ticket list in the running app render normally. Use `/verify` before
committing implementation work.

## API behavior changes (release-notes material)

- First location created for a client via the API becomes `is_default: true` even if
  the request omitted the flag (matches long-standing UI behavior).
- Creating/updating a location with `is_default: true` clears the previous default.
- Unsetting, deactivating, or deleting the default promotes another active location.
- Duplicate rows and inflated `pagination.total` in `GET /api/v1/clients` are fixed;
  a concurrent double-set-default race can now surface as 409 Conflict.

## Out of scope / follow-ups

- Reply on issue #2980 after merge: correct the mechanism (fan-out is per *default*
  location; their tenant's clients each carried two default rows), point at the fix
  and migration, and call out the first-location-auto-default behavior change.
  Their report cites "v1.3.3" — no such tag exists; the query is unchanged since
  v1.3.0, so the fix applies regardless.
- No OpenAPI/schema shape changes; response fields are unchanged.
