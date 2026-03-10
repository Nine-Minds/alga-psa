# Scratchpad — Xero Tenant-Owned OAuth

- Plan slug: `xero-tenant-owned-oauth`
- Created: `2026-03-10`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-03-10) Keep both `Xero` and `Xero CSV` in the Accounting integrations area. Rationale: users still need the manual CSV path while live Xero is being re-enabled.
- (2026-03-10) Store Xero client ID/client secret in the Accounting/Xero screen, not under shared Providers. Rationale: Xero is an accounting-specific integration and the requested UX is a single accounting setup area.
- (2026-03-10) Treat the first/prioritized stored Xero connection as the default v1 operating context. Rationale: the backend already stores multiple connections but the UI does not support organization selection today.
- (2026-03-10) Add explicit Enterprise-only gating to the live Xero path in both UI and server-side entry points.
- (2026-03-10) Preserve app-level Xero secret fallback temporarily behind tenant-first resolution to avoid breaking existing internal/staging setups during rollout.
- (2026-03-10) Reject partially configured tenant-owned Xero OAuth credentials instead of mixing tenant and app-level sources. Rationale: mixing a tenant client ID with a fallback app secret would produce a broken and hard-to-diagnose OAuth configuration.
- (2026-03-10) Route Xero OAuth success/failure back into the Accounting/Xero settings view using query params. Rationale: admins need to land back on the accounting-scoped setup screen with actionable status messaging instead of being dropped onto a generic settings page.

## Discoveries / Constraints

- (2026-03-10) `packages/integrations/src/routes/api/integrations/xero/connect.ts` and `.../callback.ts` already implement a working PKCE-based Xero OAuth flow.
- (2026-03-10) Live Xero tokens are already stored per tenant in secret `xero_credentials`, keyed by Xero connection id.
- (2026-03-10) Xero OAuth app credentials are currently resolved from app-level secrets or env fallbacks inside `packages/integrations/src/lib/xero/xeroClientService.ts`.
- (2026-03-10) The visible product state currently disables live Xero in `packages/integrations/src/components/settings/integrations/AccountingIntegrationsSetup.tsx` while exposing `Xero CSV`.
- (2026-03-10) Existing live-Xero-backed capabilities already exist under shared code: `XeroClientService`, `xeroActions`, `XeroAdapter`, and `XeroCompanyAdapter`.
- (2026-03-10) There is no live Xero settings component or live Xero mapping-manager implementation currently checked in; only the `xero_csv` settings/mapping UI exists.
- (2026-03-10) `XeroCsvAdapter` already reuses adapter type `xero` mappings internally, which implies the live Xero mapping layer is still expected but not currently surfaced.
- (2026-03-10) Current Xero actions enforce billing read/update permissions, but there is no dedicated Xero-specific EE gate yet.
- (2026-03-10) `getXeroConnectionStatus()` can validate the default live connection by instantiating `XeroClientService.create(tenant, defaultConnectionId)` and translating refresh/auth failures into reconnect guidance.
- (2026-03-10) The Xero `/connections` response includes `tenantName`, which can be persisted alongside the existing token payload and reused for the default-organization summary in settings.
- (2026-03-10) The dedicated `XeroIntegrationSettings` screen now exists under Accounting and shows masked tenant credential readiness, redirect URI, scopes, default-organization state, connect/disconnect actions, and Xero CSV fallback guidance.

## Commands / Runbooks

- (2026-03-10) Discover Xero code paths:
  - `rg -n --hidden -S "xero|Xero" packages/integrations packages/billing server ee`
- (2026-03-10) Inspect current live Xero OAuth flow:
  - `sed -n '1,240p' packages/integrations/src/routes/api/integrations/xero/connect.ts`
  - `sed -n '1,260p' packages/integrations/src/routes/api/integrations/xero/callback.ts`
- (2026-03-10) Inspect current Xero credential/token storage:
  - `sed -n '1,260p' packages/integrations/src/lib/xero/xeroClientService.ts`
  - `sed -n '740,860p' packages/integrations/src/lib/xero/xeroClientService.ts`
- (2026-03-10) Inspect current product-facing settings UI:
  - `sed -n '1,280p' packages/integrations/src/components/settings/integrations/AccountingIntegrationsSetup.tsx`
  - `sed -n '1,320p' packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.tsx`
  - `sed -n '1,260p' packages/integrations/src/components/settings/integrations/XeroCsvIntegrationSettings.tsx`
- (2026-03-10) Verify the first implementation batch:
  - `cd server && npx vitest run ../packages/integrations/src/components/settings/integrations/AccountingIntegrationsSetup.test.tsx ../packages/integrations/src/components/settings/integrations/XeroIntegrationSettings.contract.test.tsx ../packages/integrations/src/actions/integrations/xeroActions.test.ts ../packages/integrations/src/lib/xero/xeroClientService.credentials.test.ts src/test/unit/api/xeroOAuthRoutes.test.ts`
  - `npm -w @alga-psa/integrations run typecheck`

## Links / References

- Existing live OAuth routes:
  - `packages/integrations/src/routes/api/integrations/xero/connect.ts`
  - `packages/integrations/src/routes/api/integrations/xero/callback.ts`
- Existing live Xero service/client:
  - `packages/integrations/src/lib/xero/xeroClientService.ts`
  - `packages/integrations/src/actions/integrations/xeroActions.ts`
- New live Xero accounting settings surface:
  - `packages/integrations/src/components/settings/integrations/XeroIntegrationSettings.tsx`
- Existing live Xero usage:
  - `packages/billing/src/adapters/accounting/xeroAdapter.ts`
  - `packages/billing/src/services/companySync/adapters/xeroCompanyAdapter.ts`
- Current disabled/CSV-first product surface:
  - `packages/integrations/src/components/settings/integrations/AccountingIntegrationsSetup.tsx`
  - `packages/integrations/src/components/settings/integrations/XeroCsvIntegrationSettings.tsx`
- Related prior planning references:
  - `ee/docs/plans/xero-csv-export-progress.md`
  - `ee/docs/plans/2026-01-04-tenant-owned-google-oauth/PRD.md`

## Open Questions

- (2026-03-10) Follow-up cleanup question only: once tenants are fully on tenant-owned Xero credentials, should app-level Xero secret fallback be removed entirely?

## Progress

- (2026-03-10) Completed first implementation batch covering tenant-owned credential save/status flows, enterprise gating, live Xero card re-enablement, dedicated accounting-scoped Xero settings UI, tenant-first OAuth connect/callback resolution, and credential-preserving disconnect behavior.
- (2026-03-10) Remaining major work after the first checkpoint: preserve/verify downstream live-Xero catalog and export flows under tenant-owned credentials, add live mapping modules/UI, and expand regression coverage for tenant isolation and logging.
