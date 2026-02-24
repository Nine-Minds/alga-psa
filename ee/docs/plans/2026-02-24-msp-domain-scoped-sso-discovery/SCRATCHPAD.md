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
- (2026-02-24) Providers UI renders save failures in neutral actionable alerts (validation messages + conflict domain hints) without exposing backend internals.
- (2026-02-24) Added discovery endpoint `POST /api/auth/msp/sso/discover` with invariant response shape `{ ok: true, providers: [] }` and signed discovery cookie issuance on valid requests.
- (2026-02-24) Discovery route normalizes/validates email before lookup and derives a normalized domain via shared helper (`extractDomainFromEmail`).
- (2026-02-24) Discovery route uses per-IP/per-email-hash memory rate limiting and returns the same neutral `{ ok: true, providers: [] }` payload on limit hits.
- (2026-02-24) Tenant discovery now resolves only from `msp_sso_tenant_login_domains` by domain and does not query full email/user records.
- (2026-02-24) Domain lookup treats multi-tenant matches as ambiguous/unresolved and falls back to app-level provider evaluation (fail-closed for tenant context).
- (2026-02-24) Tenant-scoped discovery computes Google readiness via tenant secrets (`google_client_id` + `google_client_secret`).
- (2026-02-24) Tenant-scoped discovery computes Microsoft readiness via tenant secrets (`microsoft_client_id` + `microsoft_client_secret`).
- (2026-02-24) Unresolved-domain discovery falls back to app-level provider readiness via `GOOGLE_OAUTH_*` and `MICROSOFT_OAUTH_*` app secrets/env.
- (2026-02-24) Discovery endpoint response is invariant across invalid/limited/error paths and only returns allowed provider IDs (`google`, `azure-ad`) when available.
- (2026-02-24) Added signed discovery cookie helper (`createSignedMspSsoDiscoveryCookie` / parse verifier) with only source/tenant/providers/timing metadata; no OAuth client IDs or secrets.
- (2026-02-24) Discovery endpoint now rotates discovery cookie on valid requests and clears stale/invalid context cookies with `maxAge: 0` on neutral failure responses.
- (2026-02-24) MSP `SsoProviderButtons` now calls `/api/auth/msp/sso/discover` whenever a syntactically valid email is entered and uses response providers as the client-side allow-list input.
- (2026-02-24) MSP SSO buttons remain disabled for invalid email and during discovery fetch in-flight state; enablement happens only after discovery completes.
- (2026-02-24) Provider buttons now honor discovery allow-list strictly: unsupported providers stay disabled and disabled clicks do not invoke resolver/start.
- (2026-02-24) Added local remembered-provider UX (`localStorage` key `msp_sso_last_provider`) and only marks preferred provider when it is still in the discovered eligible set.
- (2026-02-24) Resolver now consumes signed discovery context cookie and passes parsed discovery metadata into source resolution before issuing `msp_sso_resolution`.
- (2026-02-24) Resolver/source helper enforces discovered provider allow-list; provider attempts outside cookie-allowed set fail with generic response.
- (2026-02-24) Resolver fallback behavior: when discovery cookie is missing/invalid/expired, source resolution uses app-level provider readiness only.
- (2026-02-24) Resolver maintains one external generic failure schema/message for invalid payload, limit hits, disallowed provider, missing credentials, and internal errors.
- (2026-02-24) OAuth callback/user mapping path was left unchanged; discovery/resolver changes only affect pre-auth provider eligibility and source selection.
- (2026-02-24) MSP credentials form submit path in `MspLoginForm` is unchanged; SSO discovery logic is isolated to `SsoProviderButtons`.
- (2026-02-24) Client portal login remains unchanged: client SSO affordance stays commented/disabled and does not invoke MSP discovery logic.
- (2026-02-24) Updated provider setup docs with explicit ordering: configure provider credentials, then configure tenant MSP login domains before relying on MSP SSO.
- (2026-02-24) Added env/docs guidance clarifying unresolved-domain behavior: discovery falls back to app-level `GOOGLE_OAUTH_*` / `MICROSOFT_OAUTH_*` provider configuration.
- (2026-02-24) CE/EE parity enforced for MSP SSO button behavior with a shared discovery/resolve contract test (`ssoProviderButtons.ceEeParity.test.ts`).
- (2026-02-24) Added route/callback contract coverage proving `/auth/msp/signin` links and callbackUrl passthrough/default behavior remain unchanged.

## Commands / Runbooks

- (2026-02-24) Scaffoled this plan:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "MSP Domain-Scoped SSO Discovery" --slug msp-domain-scoped-sso-discovery`
- (2026-02-24) Validate this plan bundle:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-02-24-msp-domain-scoped-sso-discovery`
- (2026-02-24) Validate migration contract test:
  - `cd server && npx vitest run src/test/unit/migrations/mspSsoTenantLoginDomainsMigration.test.ts`
- (2026-02-24) Validate domain actions unit tests:
  - `cd server && npx vitest run --coverage.enabled=false ../packages/integrations/src/actions/integrations/mspSsoDomainActions.test.ts`
- (2026-02-24) Validate discovery endpoint tests:
  - `cd server && npx vitest run --coverage.enabled=false src/app/api/auth/msp/sso/discover/route.test.ts`
- (2026-02-24) Validate SSO discovery helper tests:
  - `cd server && npx vitest run --coverage.enabled=false ../packages/auth/src/lib/sso/mspSsoResolution.test.ts`
- (2026-02-24) Validate MSP discovery + resolver + SSO button tests:
  - `cd server && npx vitest run --coverage.enabled=false src/app/api/auth/msp/sso/discover/route.test.ts src/app/api/auth/msp/sso/resolve/route.test.ts ../packages/auth/src/lib/sso/mspSsoResolution.test.ts ../packages/auth/src/components/SsoProviderButtons.msp.test.tsx`
- (2026-02-24) Validate MSP sign-in route and callback contracts:
  - `cd server && npx vitest run --coverage.enabled=false ../packages/auth/src/components/MspSignInRoute.contract.test.ts`

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
- Discovery endpoint:
  - `server/src/app/api/auth/msp/sso/discover/route.ts`
- Resolver helper library:
  - `packages/auth/src/lib/sso/mspSsoResolution.ts`
- Provider readiness/actions:
  - `packages/integrations/src/actions/integrations/providerReadiness.ts`

## Open Questions

- Should domain conflicts be hard-blocked at write-time or tolerated and treated as unresolved at read-time?
- Should unresolved-domain app-fallback provider exposure be configurable by environment?
- Should remembered provider preference be localStorage only or include signed cookie metadata?
- (2026-02-24) Completed T001: Migration creates tenant MSP SSO login-domain persistence model with expected columns.
- (2026-02-24) Completed T002: Migration rollback removes tenant MSP SSO login-domain persistence objects cleanly.
- (2026-02-24) Completed T003: Schema includes indexes supporting fast lookup by normalized domain and tenant domain listing.
- (2026-02-24) Completed T004: List login-domain action denies unauthorized users and client users.
- (2026-02-24) Completed T005: List login-domain action returns normalized, deduplicated tenant domains.
- (2026-02-24) Completed T006: Save login-domain action persists valid domains for the tenant.
- (2026-02-24) Completed T007: Save login-domain action lowercases and trims domains before persistence.
- (2026-02-24) Completed T008: Save login-domain action rejects malformed domains with a deterministic validation error.
- (2026-02-24) Completed T009: Save login-domain action prevents duplicate domains in one tenant payload.
- (2026-02-24) Completed T010: Cross-tenant domain conflict behavior follows configured policy (reject or mark ambiguous).
- (2026-02-24) Completed T011: Removing/deactivating a tenant login domain updates subsequent listing and discovery reads.
- (2026-02-24) Completed T012: Providers settings page renders MSP SSO login-domain management section.
- (2026-02-24) Completed T013: Providers UI add-domain flow invokes save action and refreshes rendered domain list.
- (2026-02-24) Completed T014: Providers UI remove-domain flow invokes save action and removes domain row from view.
- (2026-02-24) Completed T015: Providers UI shows malformed-domain validation errors without exposing backend internals.
- (2026-02-24) Completed T016: Providers UI shows conflict/ambiguity error state with neutral language.
- (2026-02-24) Completed T017: Discovery endpoint returns `{ ok: true, providers: [] }` for invalid email input.
- (2026-02-24) Completed T018: Discovery endpoint normalizes email and extracts domain correctly from mixed-case input.
- (2026-02-24) Completed T019: Discovery endpoint rate-limited calls return the same neutral response schema.
- (2026-02-24) Completed T020: Known mapped domain with tenant Microsoft configured returns only `azure-ad`.
- (2026-02-24) Completed T021: Known mapped domain with both tenant providers configured returns `google` and `azure-ad`.
- (2026-02-24) Completed T022: Known mapped domain with no tenant providers configured returns empty providers list.
- (2026-02-24) Completed T023: Unresolved domain with app Google fallback configured returns only `google`.
- (2026-02-24) Completed T024: Unresolved domain with app Microsoft fallback configured returns only `azure-ad`.
- (2026-02-24) Completed T025: Unresolved domain with no app fallback providers configured returns empty provider list.
- (2026-02-24) Completed T026: Discovery implementation contract does not branch on specific-user existence lookup results.
- (2026-02-24) Completed T027: Discovery logs avoid raw email and include only safe domain/hash metadata.
- (2026-02-24) Completed T028: Discovery context cookie is signed and excludes OAuth client IDs/secrets.
- (2026-02-24) Completed T029: Discovery context cookie expires according to configured short TTL.
- (2026-02-24) Completed T030: Discovery endpoint rotates cookie on valid requests and clears stale context on invalid input.
- (2026-02-24) Completed T031: MSP SSO buttons remain disabled for invalid/empty email input.
- (2026-02-24) Completed T032: MSP SSO buttons remain disabled while discovery request is in flight.
- (2026-02-24) Completed T033: MSP login enables only Microsoft button when discovery returns `azure-ad` only.
- (2026-02-24) Completed T034: MSP login enables both buttons when discovery returns both providers.
- (2026-02-24) Completed T035: MSP login keeps unsupported provider buttons disabled based on discovery response.
- (2026-02-24) Completed T036: Last-selected provider preference is persisted locally when user completes provider click.
- (2026-02-24) Completed T037: Remembered provider is only auto-selected when it is still present in discovered provider list.
- (2026-02-24) Completed T038: Clicking a disabled provider button never triggers resolver/start API call.
- (2026-02-24) Completed T039: Resolver consumes valid discovery cookie and uses tenant/source metadata for provider start.
- (2026-02-24) Completed T040: Resolver rejects provider attempts not included in discovered allowed provider set using generic failure response.
- (2026-02-24) Completed T041: Resolver falls back to app-level behavior when discovery cookie is missing, invalid, or expired.
- (2026-02-24) Completed T042: Unknown-user and known-user paths remain externally indistinguishable in resolver responses.
- (2026-02-24) Completed T043: Resolver rate-limit failures preserve the same generic response shape and wording.
- (2026-02-24) Completed T044: Resolver logging excludes raw email and other sensitive identifiers.
- (2026-02-24) Completed T045: OAuth callback flow for unknown users remains unchanged (no discovery-specific account-existence messaging).
- (2026-02-24) Completed T046: MSP credentials sign-in flow remains functional and independent from SSO discovery outcome.
- (2026-02-24) Completed T047: Client portal sign-in flow remains unchanged with no MSP discovery behavior bleed-through.
- (2026-02-24) Completed T048: CE/EE SSO component wiring continues to route MSP login through shared discovery-enabled SSO entrypoint.
