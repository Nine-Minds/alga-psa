# Scratchpad — MSP Domain-Scoped SSO Discovery

- Plan slug: `2026-02-24-msp-domain-scoped-sso-discovery`
- Created: `2026-02-24`

## What This Is

Working notes for shifting MSP SSO provider enablement from user-based pre-auth checks to domain-based tenant discovery, while preserving anti-enumeration posture.

## Decisions

- (2026-02-24) Do not ship per-user provider enablement on public login because it introduces user-enumeration risk.
- (2026-02-24) Use domain-level tenant discovery for MSP login provider filtering.
- (2026-02-24) Keep `/auth/msp/signin` and existing email links unchanged (no hostname migration requirement in this phase).
- (2026-02-24) Keep client portal out of scope.
- (2026-02-24) Keep unknown-user behavior non-reactive/generic in resolver responses.

## Discoveries / Constraints

- (2026-02-24) Existing MSP SSO buttons are currently email-gated only, then call `/api/auth/msp/sso/resolve`.
- (2026-02-24) Existing resolver logic in `packages/auth/src/lib/sso/mspSsoResolution.ts` currently performs user lookup for source selection.
- (2026-02-24) Prior implementation plan exists at `ee/docs/plans/2026-02-23-msp-tenant-first-sso-provider-resolution` and should be treated as superseded for pre-auth provider enablement strategy.
- (2026-02-24) Domain-level discovery can still reveal tenant/provider posture for a domain; this is acceptable for this phase, while user-existence signals remain prohibited.
- (2026-02-24) Added `server/migrations/20260224103000_create_msp_sso_tenant_login_domains.cjs` with table `msp_sso_tenant_login_domains` (`tenant`, `id`, `domain`, `is_active`, audit actor/timestamps), plus backfill from `tenants.email` only for globally-unambiguous domains.
- (2026-02-24) Cross-tenant duplicate domains are intentionally allowed in persistence; uniqueness is enforced only per-tenant via `(tenant, lower(domain))` so runtime discovery can fail-closed on ambiguity.
- (2026-02-24) Added domain-management indexes: `msp_sso_tenant_login_domains_domain_active_idx`, `msp_sso_tenant_login_domains_tenant_active_idx`, and unique tenant-local `msp_sso_tenant_login_domains_tenant_domain_uniq`.
- (2026-02-24) Added tenant settings actions in `packages/integrations/src/actions/integrations/mspSsoDomainActions.ts`; `listMspSsoLoginDomains` enforces internal admin auth and returns normalized active domains for the current tenant.
- (2026-02-24) `saveMspSsoLoginDomains` now supports create/update/remove via desired-state writes: inserts new domains, re-activates existing matches, and deactivates removed rows.
- (2026-02-24) Domain save path normalizes inputs (Unicode cleanup, trim, lowercase, optional leading `@` strip) and rejects malformed domains with deterministic validation errors.
- (2026-02-24) Domain write-time conflict policy: reject saves when any desired active domain is already active for another tenant; response includes neutral error + conflicting domain list for admin remediation.
- (2026-02-24) Added Providers UI section `MspSsoLoginDomainsSettings` and wired it into `IntegrationsSettingsPage` providers tab below Google/Microsoft credential cards.
- (2026-02-24) Providers UI supports full domain list editing: add-new input, per-row inline edits, per-row remove controls, and explicit save/refresh actions.

## Commands / Runbooks

- (2026-02-24) Scaffoled this plan:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "MSP Domain-Scoped SSO Discovery" --slug msp-domain-scoped-sso-discovery`
- (2026-02-24) Validate this plan bundle:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-02-24-msp-domain-scoped-sso-discovery`
- (2026-02-24) Validate migration contract test:
  - `cd server && npx vitest run src/test/unit/migrations/mspSsoTenantLoginDomainsMigration.test.ts`
- (2026-02-24) Validate domain actions unit tests:
  - `cd server && npx vitest run --coverage.enabled=false ../packages/integrations/src/actions/integrations/mspSsoDomainActions.test.ts`

## Gotchas

- (2026-02-24) `vitest` default coverage output can fail with `ENOSPC` in this worktree; use `--coverage.enabled=false` for targeted unit runs while iterating.

## Links / References

- Previous plan (superseded approach):
  - `ee/docs/plans/2026-02-23-msp-tenant-first-sso-provider-resolution/PRD.md`
- MSP login + SSO buttons:
  - `packages/auth/src/components/MspLoginForm.tsx`
  - `packages/auth/src/components/SsoProviderButtons.tsx`
- Current resolver endpoint:
  - `server/src/app/api/auth/msp/sso/resolve/route.ts`
- Resolver helper library:
  - `packages/auth/src/lib/sso/mspSsoResolution.ts`
- Provider readiness/actions:
  - `packages/integrations/src/actions/integrations/providerReadiness.ts`

## Open Questions

- Should domain conflicts be hard-blocked at write-time or tolerated and treated as unresolved at read-time?
- Should unresolved-domain app-fallback provider exposure be configurable by environment?
- Should remembered provider preference be localStorage only or include signed cookie metadata?
