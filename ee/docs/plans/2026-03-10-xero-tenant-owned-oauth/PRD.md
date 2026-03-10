# PRD — Xero Tenant-Owned OAuth

- Slug: `xero-tenant-owned-oauth`
- Date: `2026-03-10`
- Status: Draft

## Summary
Re-enable the live Xero integration as an Enterprise-only accounting option using tenant-owned Xero OAuth client credentials. Admins should configure the Xero client ID and client secret directly in the Xero accounting settings screen, run their own Xero OAuth flow, and then use the existing supported live-Xero features already implemented in the backend. The existing `Xero CSV` workflow remains available beside the live Xero path as a manual alternative.

## Problem
The current live Xero integration depends on Alga-managed app credentials and the associated Xero application approval process. That approval burden is blocking practical use of the live integration. The product currently routes users to `Xero CSV` because the live Xero UI is disabled, even though the connect/callback flow, tenant token storage, Xero API client, and live accounting adapter are already implemented underneath.

## Goals
- Let each tenant supply and manage its own Xero OAuth client ID and client secret.
- Surface live Xero again in `Settings -> Integrations -> Accounting` rather than leaving it disabled.
- Keep `Xero CSV` available and visible as a parallel/manual option.
- Reuse the existing Xero connect/callback flow, tenant connection storage, Xero API client, and Xero accounting adapter.
- Add explicit Enterprise-only gating for the live Xero path.
- Keep the first/default Xero connection as the v1 operating model; do not require multi-org selection UI.
- Keep secrets tenant-scoped and masked in all browser-facing reads.

## Non-goals
- Moving Xero credential setup into the shared `Providers` tab.
- Removing or deprecating `Xero CSV`.
- Building a multi-organization picker or realm-selection UI in v1.
- Replacing the existing Xero token storage structure in `xero_credentials`.
- Rewriting the Xero API client or the live Xero accounting adapter from scratch.
- Adding new Xero capabilities beyond the already-supported live Xero features.

## Users and Primary Flows
- Tenant Admin / Billing Admin
  - Opens `Settings -> Integrations -> Accounting`.
  - Selects `Xero`.
  - Enters tenant-owned Xero client ID and client secret.
  - Copies redirect URI and scopes into their Xero app registration.
  - Clicks Connect and completes OAuth.
  - Reviews connection status and default connected Xero organization.
- Billing Admin / Finance Operator
  - Uses the connected Xero integration for existing live-Xero-backed export, catalog, mapping, and tax-related flows.
  - Falls back to `Xero CSV` when manual import/export is preferred or required.

## UX / UI Notes
- `Accounting Integrations` continues to show both `Xero` and `Xero CSV`.
- `Xero` is no longer a disabled `Coming Soon` card in Enterprise.
- The Xero settings screen lives under Accounting and includes:
  - Tenant-owned client ID/client secret form
  - Redirect URI and scopes
  - Credential readiness state
  - Connect / Disconnect actions
  - Connected/default organization summary
  - Error/expired state messaging
  - Live Xero mapping/configuration area
  - A short note that `Xero CSV` remains available as the manual alternative
- Non-Enterprise users should not see the live Xero path.

## Requirements

### Functional Requirements
- Tenant admins can save tenant-owned Xero OAuth client credentials from the Xero accounting settings screen.
- Browser-facing status/read actions return masked/boolean credential state only.
- The live Xero connect route uses tenant credentials first and fails clearly when missing.
- The Xero callback route uses tenant credentials first and persists Xero connection tokens in the existing tenant secret store.
- Disconnect clears stored Xero connection tokens without deleting the saved tenant client ID/client secret.
- The Xero settings screen shows current connection state, including the default connected Xero organization when present.
- Existing live-Xero-backed features continue to work once a tenant is connected.
- Live Xero settings include a mapping/configuration area for the default connected Xero organization.
- `Xero CSV` remains selectable and unchanged as a separate accounting option.
- The live Xero path is explicitly Enterprise-only in UI and server-side entry points.
- v1 uses the first/prioritized stored Xero connection as the default operating context.

### Non-functional Requirements
- All Xero OAuth app credentials remain tenant-scoped and are never returned unmasked to the client.
- Server-side credential resolution is deterministic: tenant secret first, then temporary app-secret fallback for rollout compatibility.
- Missing configuration, OAuth failure, expired credentials, and missing Xero connections produce actionable error states.
- Existing shared code can remain reusable, but user-facing/mutating live-Xero entry points must enforce the Enterprise boundary.

## Data / API / Integrations
- Existing routes remain the public entry points:
  - `/api/integrations/xero/connect`
  - `/api/integrations/xero/callback`
- Existing tenant token store remains:
  - tenant secret `xero_credentials`
- New/expanded tenant-owned credential contract:
  - tenant secret `xero_client_id`
  - tenant secret `xero_client_secret`
- Existing app-level Xero secret lookup remains only as a rollout fallback behind tenant-first resolution.
- Existing backend integration surfaces to reuse:
  - `packages/integrations/src/lib/xero/xeroClientService.ts`
  - `packages/integrations/src/actions/integrations/xeroActions.ts`
  - `packages/billing/src/adapters/accounting/xeroAdapter.ts`
  - `packages/billing/src/services/companySync/adapters/xeroCompanyAdapter.ts`
- New server-side settings surface needed:
  - save/update tenant Xero credentials
  - read masked Xero credential + connection status for the settings screen

## Security / Permissions
- Saving or changing Xero client credentials requires the same billing/integration update permission used by existing Xero actions.
- Read-only Xero status requires billing/integration read permission.
- Non-Enterprise contexts must be blocked from live Xero settings mutations and OAuth entry points.
- Raw secrets must never be serialized to the browser or logged.

## Observability
- Reuse existing Xero route/client logging where possible.
- Add lightweight server logs for credential-source selection and settings mutations without logging secret values.
- Do not add new monitoring/metrics scope in this project beyond what is required to diagnose connect/config failures.

## Rollout / Migration
- `Xero CSV` remains intact throughout rollout.
- No migration of existing `xero_credentials` token payloads is required.
- Tenants must configure their own Xero client ID/client secret before using live Xero.
- App-level Xero secret fallback remains temporarily to avoid breaking internal/staging environments during cutover, but tenant-owned secrets become the intended source of truth.
- No multi-org picker will be introduced in this release; default-connection behavior remains in place.

## Open Questions
- When rollout is complete, should app-level Xero secret fallback be removed entirely in a follow-up cleanup?

## Acceptance Criteria (Definition of Done)
- In Enterprise builds, the Accounting integrations screen shows an active `Xero` option beside `Xero CSV`.
- Tenant admins can save tenant-owned Xero client ID/client secret from the Xero settings screen and see only masked readiness data afterward.
- The Xero connect/callback flow completes using tenant-owned credentials and persists connection tokens in `xero_credentials`.
- Disconnect removes stored Xero connection tokens but preserves tenant-owned Xero client credentials.
- Existing live-Xero-backed catalog/export/company-sync capabilities work using the stored default connection.
- The Xero settings screen includes live Xero mapping/configuration UI for the default connection.
- `Xero CSV` remains available and unaffected.
- Non-Enterprise contexts cannot access the live Xero path.
