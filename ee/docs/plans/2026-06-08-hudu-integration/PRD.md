# PRD — Hudu Integration

- Slug: `hudu-integration`
- Date: `2026-06-08`
- Status: Draft
- Edition: Enterprise (EE) only
- Phase: 1 (pull-only, Hudu → AlgaPSA)

## Summary

Add a Hudu integration to AlgaPSA that lets an MSP connect a Hudu instance (Hudu Cloud or self-hosted) and surface that Hudu data — companies, assets, knowledge-base articles, and asset passwords — read-only inside AlgaPSA, scoped to the AlgaPSA client it belongs to.

Hudu is the MSP's IT-documentation system of record. AlgaPSA is the PSA (system of record for clients/tickets/billing). This integration does **not** copy Hudu's documentation into AlgaPSA; it persists only the **client ↔ Hudu-company mapping**, fetches a mapped company's lists **on demand** (cached, with manual refresh), and **deep-links** to Hudu for the actual content. This matches how the wider Hudu ecosystem integrates (scheduled/low-frequency reads + deep-links; never duplicating Hudu's docs, especially secrets).

Phase 1 is **pull-only** and **EE-only**, gated behind a `hudu-integration` feature flag. The data model is kept direction-agnostic so a future push (AlgaPSA → Hudu) phase is additive.

## Problem

MSP technicians using AlgaPSA constantly need a client's documentation — devices, network notes, runbooks, and especially credentials — which lives in Hudu. Today they context-switch to Hudu, find the right company, and dig for the record.

There is no link between an AlgaPSA client and its Hudu company, and no way to see Hudu content in context while working a ticket. Hudu's `asset_passwords` are **company-scoped** — they are not attached to a specific device — so credentials cannot be mapped to an individual AlgaPSA asset; they belong at the client level. (AlgaPSA does ship an asset "Documents & Passwords" tab whose Passwords half is an unimplemented stub, but that is a different, asset-scoped concern and is left for the separate future native-password effort — see Non-goals.)

## Goals

- Let an EE tenant connect a Hudu instance with an API key + base URL, and validate the connection.
- Map AlgaPSA clients to Hudu companies (auto-suggested, admin-confirmed).
- Surface a mapped client's Hudu data read-only, all on the **Client** detail page:
  - a **"Hudu" tab** for **assets** and **articles**, and
  - a separate **"Passwords" tab** for the company's Hudu **asset passwords** (visible only when the Hudu integration is enabled and the client is mapped). Credentials live here, not on the asset, because Hudu passwords are company-scoped.
- Deep-link every surfaced record back to Hudu as the system of record.
- Keep the integration safe: never persist a Hudu password value anywhere in AlgaPSA (DB, Vault, or cache).

## Non-goals

- **Push / write-back to Hudu** (Alga → Hudu create/update). Deferred; model stays direction-agnostic.
- **Importing Hudu records as native AlgaPSA records** (no creating Alga `assets`/`documents` rows from Hudu).
- **Websites** entity (no clean AlgaPSA mapping target). Deferred.
- **Scheduled background sync engine / Temporal workflows.** Phase 1 fetches on demand + manual refresh. (A low-frequency scheduled refresh is a documented future enhancement.)
- **Contacts, Procedures, Magic Dash, Networks, Relations** and other Hudu resources beyond the four named entities.
- **CE availability.** EE only; CE routes return 501.
- **Persisting or caching Hudu passwords** anywhere in AlgaPSA (DB column, Vault, or cache). Phase 1 reveals on demand via live fetch only.
- **A native AlgaPSA password store** (first-class password management in Alga) and **importing Hudu passwords into it**. Deliberately deferred to a separate future effort/plan; added only if demanded.
- **Modifying the asset "Documents & Passwords" tab.** Left as-is (still a stub) in Phase 1 — Hudu passwords are company-scoped, so they surface on the client's Passwords tab, not the asset. The asset stub is the future native-password effort's concern.
- Monitoring/metrics/observability infrastructure beyond what the UI needs to show connection/fetch status.

## Users and Primary Flows

**Personas**
- **MSP Admin** — connects Hudu, manages client↔company mappings.
- **MSP Technician** — views a client's / asset's Hudu data in context while working.

**Primary flows**
1. **Connect Hudu** (Admin): Settings → Integrations → IT Documentation → Hudu → enter base URL + API key → Test → Connected.
2. **Map companies** (Admin): Hudu settings → Company Mapping → review auto-suggested matches (by `id_in_integration`, then name) → confirm/override per row → Save. Refresh companies re-pulls the Hudu company list.
3. **View client documentation** (Technician): open a mapped Client → "Hudu" tab → see assets / articles lists with counts → click any item → opens in Hudu.
4. **View client credentials** (Technician): open a mapped Client → "Passwords" tab → list of the company's Hudu credentials (name, username, URL) → "Reveal" fetches the value live from Hudu (masked, reveal-on-click, audited, never stored); "Open in Hudu" links to the record.

## UX / UI Notes

- **Settings entry**: new category **"IT Documentation"** in `IntegrationsSettingsPage.tsx` (`categories` array), with a single `HuduIntegrationSettings` item (`isEE: true`). Hidden unless EE + `hudu-integration` flag enabled.
- **Connection panel** (`HuduIntegrationSettings.tsx`): base URL field, API key field (write-only/masked), Test Connection button (calls `GET /api/v1/companies?page=1`), status badge (Not connected / Connected / Error), Disconnect button. On connect success, show the resolved instance + password-permission status of the key (so the admin knows whether passwords will be visible).
- **Company mapping** (`HuduCompanyMappingManager.tsx`): modeled on NinjaOne `OrganizationMappingManager` — counters (mapped / unmapped), a table with columns **Hudu Company** (name + id) | **AlgaPSA Client** (`ClientPicker` dropdown, pre-filled with the suggested match) | **Status** (badge: Suggested / Mapped / Unmapped), and a **Refresh companies** button. Selecting a client persists immediately.
- **Client "Hudu" tab**: read-only sections for Assets and Articles; each row deep-links to Hudu; show counts; "Refresh" button; empty/disconnected/unmapped states. Visible only when EE + flag + Hudu connected + client mapped.
- **Client "Passwords" tab** (separate tab on the Client detail page, shown only when the Hudu integration is enabled, connected, and the client is mapped): read-only list of the mapped company's Hudu `asset_passwords` (name, username, URL) with an inline **Reveal** (live fetch, masked, reveal-on-click, audited, never stored) and an "Open in Hudu" link. Empty/error states for unmapped / disconnected / key-lacks-password-permission.
- All Hudu-derived UI must visibly attribute Hudu as the source and link out.

## Requirements

### Functional Requirements

**Connection**
- FR1. Store Hudu `base_url` and `api_key` per tenant via the secret provider; never expose the key back to the client.
- FR2. Validate a connection by calling Hudu and surfacing success/failure + the key's password-access capability.
- FR3. Persist connection state (active, connected_at, last fetch) in a `hudu_integrations` table.
- FR4. Disconnect clears the connection (deletes secrets, marks inactive) but retains mappings.

**Hudu API client**
- FR5. Axios client using `x-api-key` + base URL, resolving credentials tenant-secret → env fallback.
- FR6. Page-based pagination helper (25/page; stop when a page returns < 25).
- FR7. Rate-limit handling: on HTTP 429 back off using `Retry-After` (+ jitter) and retry; cap retries.
- FR8. Map Hudu errors to typed results: 401 (bad key), 403 (no password permission), 404 (bad base URL/id), 429 (rate limited), 5xx (retry).
- FR9. UI→API naming is handled internally (`asset_passwords`, `procedures`, etc.).

**Company mapping**
- FR10. Fetch the Hudu company list for the connected tenant.
- FR11. Auto-suggest each Hudu company → AlgaPSA client by `id_in_integration` (exact, when it equals an Alga client id), then exact name, then fuzzy name; expose a confidence/source.
- FR12. Persist mappings in `tenant_external_entity_mappings` (`integration_type='hudu'`, `alga_entity_type='client'`, `external_entity_id=<hudu_company_id>`, `metadata={hudu_company_name, id_in_integration, url}`). One Hudu company ↔ one client.
- FR13. Admin can confirm a suggestion, override the client, or clear a mapping.

**Surfacing (read-only)**
- FR14. For a mapped client, fetch its Hudu assets, articles, and asset passwords (company-scoped) on demand, with a short server-side cache and a manual Refresh.
- FR15. Client "Hudu" tab renders the assets and articles lists with counts and deep-links.
- FR16. Client "Passwords" tab (separate from the Hudu tab, shown only when Hudu is enabled/connected and the client is mapped) renders the mapped company's Hudu passwords list with inline Reveal (live fetch, audited, never stored) and Open-in-Hudu links.
- FR17. Every surfaced record links to its Hudu URL (per-record URL or `/companies/jump` deep-link).
- FR18. Clear empty/error states for: not connected, client unmapped, Hudu unreachable, key lacks password permission (403).
- FR19. Reveal a single credential on demand via a targeted live GET; return the value transiently to the browser (masked, reveal-on-click); never persist it (DB/Vault/cache) or log it.
- FR20. Audit every reveal (who, when, which password/company); the audit entry never contains the value.

### Non-functional Requirements

- NFR1. **Security**: no Hudu password value is ever persisted anywhere in AlgaPSA — not a DB column, not Vault, not a cache. Reveal is on demand: a targeted live GET returns the value transiently to the browser (masked, reveal-on-click); every reveal is audited; the value is never logged or written server-side. The connection's own `api_key` is stored only via the secret provider (Vault).
- NFR2. **EE gating**: all server entry points require EE + `hudu-integration` flag; CE routes return 501 via the `@enterprise` lazy-import stub.
- NFR3. **Tenant isolation**: all queries tenant-scoped via `createTenantKnex()`; tables are Citus-distributed by `tenant`.
- NFR4. **Rate-limit safety**: on-demand fetches are per-mapped-company and paginated; never bulk-fetch across all clients on a page view.
- NFR5. **i18n**: all user-facing strings use translation keys.
- NFR6. **Direction-agnostic data model**: mapping rows carry no pull-only assumptions, enabling a later push phase.
- NFR7. **EE/CE deletion boundary**: `hudu_integrations` is EE-only, so every read/write/**delete** against it — disconnect, and any client-/tenant-delete cascade that removes its rows — must live in EE-only code paths and EE migrations. No CE migration or CE runtime path may name `hudu_integrations` (it does not exist in CE). Mapping cleanup is exempt: those rows live in the shared CE table `tenant_external_entity_mappings` (filtered `integration_type='hudu'`) and are safe to delete from CE.

## Data / API / Integrations

**New table — `hudu_integrations`** (connection state), **EE migration in `ee/server/migrations/`** (Hudu is EE-only; CE never touches it — the CE route 501s before any DB access). Follow the Entra EE precedent `ee/server/migrations/20260220143000_create_entra_phase1_schema.cjs` for the Citus-distributed EE tenant-table pattern (`ee/server/migrations` runs `isCitusEnabled` logic). Columns:
- `tenant uuid`, `integration_id uuid` (PK `(tenant, integration_id)`), `base_url text`, `is_active boolean`, `connected_at timestamptz`, `last_synced_at timestamptz`, `settings jsonb` (e.g. cached capability flags), `created_at`, `updated_at` (+ `on_update_timestamp` trigger). Unique `(tenant)` (one Hudu connection per tenant in Phase 1). Citus-distributed by `tenant`.
- (`rmm_integrations` is CE only because the RMM layer is partly CE — not a precedent for a wholly-EE table.)

**Reused table — `tenant_external_entity_mappings`** for company↔client links (no new migration).

**Secrets**: `hudu_api_key`, `hudu_base_url` via `getSecretProviderInstance().setTenantSecret(tenant, …)`.

**Hudu API surfaces used** (all GET): `/api/v1/companies` (+ `?id_in_integration=`, `?page=`), `/api/v1/assets?company_id=`, `/api/v1/articles?company_id=`, `/api/v1/asset_passwords?company_id=`, per-record URLs, and `/api/v1/companies/jump?integration_id=&integration_slug=` for deep-linking. Auth `x-api-key`. Limits: 300 req/min, 25/page, no consumer webhooks.

**Code locations**
- Client lib: `ee/server/src/lib/integrations/hudu/` (`huduClient.ts`, `contracts.ts`, `secrets.ts`, mapping/suggest helpers).
- Server actions: `huduConnectionActions.ts`, `huduCompanyMappingActions.ts`, `huduDataActions.ts` (fetch lists).
- EE API routes: `ee/server/src/app/api/integrations/hudu/...`; CE stubs: `server/src/app/api/integrations/hudu/...` (501).
- Settings UI: `IntegrationsSettingsPage.tsx` (category), `HuduIntegrationSettings.tsx`, `HuduCompanyMappingManager.tsx`.
- Client tabs: client detail tab host — `HuduClientTab` (assets + articles) and `HuduClientPasswordsTab` (passwords). The asset `packages/assets/src/components/tabs/DocumentsPasswordsTab.tsx` is **not** modified in Phase 1.

## Security / Permissions

- EE + `hudu-integration` feature flag required on every server entry point (guard mirrors `requireEntraUiFlagEnabled`).
- **Reuse the existing `system_settings` RBAC resource** — `read` to view surfaced Hudu data, `update` to connect/disconnect and manage mappings. This matches Entra, Teams, Tactical RMM, and SSO (all `system_settings`); accounting/billing integrations use `billing_settings`, which is the wrong resource here. **No new RBAC resource and no permission seeding** are required (`system_settings` already exists). Note: reuse the `tenant_external_entity_mappings` table for mappings, but do **not** call the `billing_settings`-gated `externalMappingActions` wrappers — Hudu mapping actions enforce `system_settings`.
- API key stored only in the secret provider; masked in UI; excluded from logs and error payloads.
- Password values: handled per NFR1 — revealed on demand via a transient live GET, never persisted (DB/Vault/cache) or logged; every reveal is audited. Respect Hudu key password permission (403 → "password access not enabled for this key").

## Observability

- Minimal: surface connection status, last-fetch time, and fetch errors in the UI. No new metrics/telemetry infrastructure in Phase 1.

## Rollout / Migration

- One **EE migration** (`ee/server/migrations/`) creates `hudu_integrations` (greenfield tenant table: create `tenant uuid` first, distribute inline under the `isCitusEnabled` guard, `transaction:false`), per the Entra precedent.
- No RBAC seeding migration needed — reuse the existing `system_settings` resource.
- Ship dark behind `hudu-integration` (default off). Enable per-tenant for pilot MSPs.
- No data backfill (pull-only, on-demand).

## Open Questions

- OQ1. **RESOLVED** — Phase 1 reveals credentials inline via a targeted live GET (masked, reveal-on-click, audited, never persisted to DB/Vault/cache). A Vault-backed reveal cache and a native AlgaPSA password store (with optional Hudu import) are explicitly deferred to separate future efforts.
- OQ2. **RESOLVED** — Hudu `asset_passwords` are company-scoped and cannot be mapped to a specific asset, so they are **not** surfaced on the asset tab. They get a dedicated **"Passwords" tab on the Client page** (shown only when the Hudu integration is enabled and the client is mapped). The asset "Documents & Passwords" stub is untouched in Phase 1.
- OQ3. **RESOLVED** — Reuse the existing `system_settings` RBAC resource (`read`=view, `update`=manage), matching Entra/Teams/Tactical-RMM/SSO. No new resource, no seeding.
- OQ4. **RESOLVED** — One Hudu instance per tenant (enforced by `unique(tenant)`). Multiple instances are rare in practice (only unmerged M&A or sandbox/prod splits); multi-instance support is a possible future enhancement, not Phase 1.

## Acceptance Criteria (Definition of Done)

- An EE tenant with the flag on can connect a Hudu instance (base URL + key), see a Connected status, and Disconnect.
- A CE build returns 501 for all Hudu routes; the settings item is hidden in CE.
- Admin can see Hudu companies auto-matched to clients, override/confirm, and persist mappings in `tenant_external_entity_mappings`.
- On a mapped client's "Hudu" tab, assets / articles lists render with counts and working deep-links.
- On a mapped client's separate "Passwords" tab (shown only when Hudu is enabled/connected and the client is mapped), the company's Hudu passwords render with inline Reveal (live fetch, never stored) and Open-in-Hudu links. The asset "Documents & Passwords" stub is unchanged.
- No AlgaPSA store (DB column, Vault, or cache) ever contains a Hudu password value; every reveal is audited; the `api_key` is never returned to the client or logged.
- 401/403/404/429/unreachable all produce clear, non-crashing UI states.
- All strings are translated; all server entry points enforce EE + flag + `system_settings` (no new RBAC resource).
