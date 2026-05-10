# Scratchpad — Client Portal SSO and Entra Entitlement

- Plan slug: `2026-05-09-client-portal-sso-entra-entitlement`
- Created: `2026-05-09`

## What This Is

Working notes for implementing tenant-scoped client portal SSO and Entra entitlement-gated portal user provisioning.

## Decisions

- (2026-05-09) Client portal SSO is unavailable until tenant context is known. Rationale: client portal users arrive through tenant-scoped portal entrypoints and should not use MSP internal email-domain discovery.
- (2026-05-09) Phase boundaries are folded into one implementation plan. Login, Entra provisioning, entitlement lifecycle, and invitation/prelink behavior should be designed as one coherent feature.
- (2026-05-09) Interactive OAuth login must not create portal users. Portal user creation belongs to Entra sync provisioning and invitation flows.
- (2026-05-09) Entra group membership is the first entitlement source for portal access. Rationale: it is explicit, auditable, and customer-admin controlled.
- (2026-05-09) Contact sync remains broad; portal access requires entitlement. Rationale: contact data and access grants are different decisions.
- (2026-05-09) Entitlement removal deactivates only Entra-managed portal users. Manually managed users are preserved.
- (2026-05-09) Auto-linking existing users and provisioning new portal users are separate settings because they carry different access-risk levels.
- (2026-05-09) MSP feedback confirmed that configurable group entitlement covers broad "All Users" style workflows. Alga role assignment remains separate from Entra access eligibility.
- (2026-05-09) Entra-provisioned users should receive a configurable default Alga client portal role, defaulting to `User`, at creation time only. Later manual Alga role changes must be preserved across sync runs.
- (2026-05-09) Client portal Entra provisioning should use an explicit mode: disabled, built-in, or workflow-managed. Workflow-managed mode should replace built-in mutations for that sync decision rather than run alongside them, to avoid duplicate users, conflicting role assignment, and ambiguous lifecycle ownership.
- (2026-05-09) Workflow-managed provisioning is valuable as an advanced override, not the default path. Built-in mode remains the recommended/default enabled mode for the common "group grants portal access with default role" workflow.
- (2026-05-09) Workflow-managed mode should publish idempotent access eligibility/removal events after contact reconciliation and entitlement checks. The workflow is responsible for provisioning, role assignment, invitations, notifications, approval tasks, skip decisions, and lifecycle changes.

## Discoveries / Constraints

- (2026-05-09) `packages/auth/src/components/SsoProviderButtons.tsx` is hard-coded to `/api/auth/msp/sso/discover`, `/api/auth/msp/sso/resolve`, and `msp_sso_last_provider`.
- (2026-05-09) `packages/auth/src/components/ClientLoginForm.tsx` imports `SsoProviderButtons` but keeps it commented out with "SSO not supported for client portal".
- (2026-05-09) `packages/auth/src/components/ClientLoginForm.ssoGuard.test.ts` and `ClientPortalAuthUnchanged.contract.test.ts` currently guard the disabled state and must be replaced with behavior tests.
- (2026-05-09) MSP SSO endpoints live under `server/src/app/api/auth/msp/sso/*` and use signed discovery/resolution cookies from `packages/auth/src/lib/sso/mspSsoResolution.ts`.
- (2026-05-09) `ee/server/src/lib/auth/ssoProviders.ts` already supports mapping OAuth profiles to client users, but client portal SSO needs stricter tenant and user-type requirements.
- (2026-05-09) `autoLinkClient` already exists in parsed SSO preferences and `ssoAutoLink.ts`, but no UI switch is currently wired.
- (2026-05-09) Entra contact reconciliation currently lives in `ee/server/src/lib/integrations/entra/sync/contactReconciler.ts` and creates or links contacts, not portal users.
- (2026-05-09) Worktree git metadata appears broken: `.git` points to `/Users/roberisaacs/alga-psa/.git/worktrees/client-portal-sso-support`, and `git status` fails because that target is missing.
- (2026-05-09) Current plan already includes configurable Entra group entitlement through `F029` and `F031`; broad groups like "All Users" are supported by selecting that group as the entitlement source.
- (2026-05-09) Current plan already includes configurable default Alga client portal role through `F063`-`F065`; this should apply to built-in provisioning and be included as recommendation context for workflow-managed provisioning events.

## Commands / Runbooks

- (2026-05-09) Existing discovery: `server/src/app/api/auth/msp/sso/discover/route.ts`.
- (2026-05-09) Existing resolve: `server/src/app/api/auth/msp/sso/resolve/route.ts`.
- (2026-05-09) Existing shared SSO helper: `packages/auth/src/lib/sso/mspSsoResolution.ts`.
- (2026-05-09) Existing client login form: `packages/auth/src/components/ClientLoginForm.tsx`.
- (2026-05-09) Existing Entra contact reconciler: `ee/server/src/lib/integrations/entra/sync/contactReconciler.ts`.

## Links / References

- Approved design doc: `docs/plans/2026-05-09-client-portal-sso-entra-entitlement-design.md`
- Microsoft Graph custom security attributes examples: `https://learn.microsoft.com/en-us/graph/custom-security-attributes-examples`
- Microsoft Graph onPremisesExtensionAttributes: `https://learn.microsoft.com/en-us/graph/api/resources/onpremisesextensionattributes`
- Microsoft Graph user appRoleAssignments: `https://learn.microsoft.com/en-us/graph/api/user-list-approleassignments`

## Open Questions

- Exact schema strategy for Entra-managed portal user metadata.
- Exact schema strategy for per managed Entra tenant/client portal entitlement configuration.
- Exact role identifier for the standard default client portal `User` role.
- Exact workflow event naming and whether to use one decision event or separate eligible/removal events.
- Exact workflow action surface needed if existing workflow operations cannot safely create/link/deactivate portal users.
- Whether Google SSO should be included for Entra-provisioned users immediately or limited to existing portal user email matching in the first implementation.
- Whether the first UI exposes direct-vs-transitive group membership mode or stores the mode while defaulting all behavior to transitive.

## Implementation Log

- (2026-05-09) Implemented `F001`-`F011`: added tenant-gated client portal SSO discovery/resolve endpoints (`/api/auth/client-portal/sso/discover`, `/api/auth/client-portal/sso/resolve`) with anti-enumeration responses, per-email+IP rate limiting, dedicated client-portal audience cookies (`client_portal_sso_discovery`, `client_portal_sso_resolution`), and strict resolve checks for discovery-state/provider/tenant/callback consistency.
- (2026-05-09) Implemented tenant context resolution (`F003`-`F005`) in `packages/auth/src/lib/sso/clientPortalSsoResolution.ts` using tenant slug -> tenant lookup, active portal domain -> tenant lookup, and trusted callback URL resolution for client-portal callback contexts.
- (2026-05-09) Implemented `F012`-`F015`: made `SsoProviderButtons` surface-configurable (`msp` vs `client_portal`) with configurable endpoints/storage key and client portal state markers (`mode=login`, `user_type=client`, tenant hint); discovery/resolve payload now includes tenant slug + portal domain + callback context.
- (2026-05-09) Implemented `F013`/`F014` UI gating: `ClientLoginForm` now renders SSO buttons only when tenant context is present (`tenantSlug` or `portalDomain`) and passes context through to the SSO resolver.
- (2026-05-09) Implemented `F061`: replaced disabled-SSO guard assertions with tenant-gated wiring assertions in `ClientLoginForm.ssoGuard.test.ts`.

## Test Coverage Added/Updated

- (2026-05-09) Implemented `T001`,`T002`,`T003` with new API tests in `server/src/app/api/auth/client-portal/sso/discover/route.test.ts` (neutral response without tenant context; provider response via tenant slug; provider response via portal domain).
- (2026-05-09) Implemented `T004` with new API tests in `server/src/app/api/auth/client-portal/sso/resolve/route.test.ts` (generic failure on mismatch; success path sets signed resolution cookie).
- (2026-05-09) Implemented `T007` by updating `packages/auth/src/components/ClientLoginForm.ssoGuard.test.ts` to assert tenant-context-gated rendering and client-surface SSO wiring.

## Commands Run

- `npx vitest run src/app/api/auth/client-portal/sso/discover/route.test.ts src/app/api/auth/client-portal/sso/resolve/route.test.ts` (workdir: `server/`) ✅
- `npx vitest run src/components/SsoProviderButtons.msp.test.tsx src/components/ClientLoginForm.ssoGuard.test.ts src/components/ClientPortalAuthUnchanged.contract.test.ts src/components/ssoProviderButtons.ceEeParity.test.ts` (workdir: `packages/auth/`) ✅

## Gotchas

- (2026-05-09) Needed to add package export `@alga-psa/auth/lib/sso/clientPortalSsoResolution` in `packages/auth/package.json`; server Vitest otherwise failed module resolution.
- (2026-05-09) Implemented `F016`-`F019` in `ee/server/src/lib/auth/ssoProviders.ts`: client-portal OAuth mapping now requires `user_type=client`, requires tenant-scoped lookup for client mode, blocks global fallback paths for client mode, and rejects internal-user matches when `user_type=client` is requested.
- (2026-05-09) Implemented `T005` via `ee/server/src/__tests__/unit/auth/ssoProviders.clientPortal.test.ts` to validate tenant-scoped active client mapping and internal-user rejection.
- (2026-05-09) Command: `npx vitest run src/__tests__/unit/auth/ssoProviders.clientPortal.test.ts` (workdir: `ee/server/`) ✅
- (2026-05-09) Implemented `F020`/`F021`: OAuth client-portal SSO now carries `callback_url` in signed state from `SsoProviderButtons`, and `nextAuthOptions` uses that callback context during OAuth sign-in to run existing vanity-domain handoff redirect logic for `user_type=client` (same `computeVanityRedirect` path as credentials flow).
- (2026-05-09) Added explicit client-portal SSO state finalization in NextAuth sign-in callback: clears `client_portal_sso_discovery` and `client_portal_sso_resolution` cookies after OAuth completion handling to prevent stale cross-attempt context reuse.
- (2026-05-09) Implemented `T006` via `packages/auth/src/lib/nextAuthOptions.clientPortalSso.contract.test.ts` to lock callback-state extraction, OAuth vanity redirect branch, and client-portal SSO state cookie clearing behavior.

## Commands Run

- `npx vitest run src/lib/nextAuthOptions.clientPortalSso.contract.test.ts` (workdir: `packages/auth/`) ✅
- `npx vitest run src/__tests__/unit/auth/ssoProviders.clientPortal.test.ts` (workdir: `ee/server/`) ✅

## Gotchas

- (2026-05-09) `packages/auth` Vitest config currently includes only `src/**/*.test.ts`; `*.test.tsx` files are not discovered by default, so targeted regression execution should use `.test.ts` suites or update include config in a separate change.
- (2026-05-09) Implemented `F022` and `T008` with a credentials-flow regression contract test in `packages/auth/src/components/clientPortalCredentialsRegression.contract.test.ts` to lock client credentials sign-in payload behavior (`userType: client`, callback pass-through) and default dashboard callback routing.
- (2026-05-09) Implemented `F023` and `T009` with MSP SSO regression contract coverage in `packages/auth/src/components/mspSsoRegression.contract.test.ts` to verify MSP default discovery/resolve endpoints, last-provider storage key, and `user_type=internal` state remain unchanged.

## Commands Run

- `npx vitest run src/lib/nextAuthOptions.clientPortalSso.contract.test.ts src/components/clientPortalCredentialsRegression.contract.test.ts src/components/mspSsoRegression.contract.test.ts` (workdir: `packages/auth/`) ✅
- (2026-05-09) Implemented `F024`: `ee/server/src/components/settings/security/SsoBulkAssignment.tsx` now exposes separate auto-link controls for internal users and client portal users and persists `autoLinkClient` independently via `updateSsoPreferencesAction`.
- (2026-05-09) Added focused checklist test `T027` and implemented it via static contract test `ee/server/src/components/settings/security/__tests__/SsoBulkAssignment.autoLinkClient.contract.test.ts` because existing `T010` bundles broader provisioning settings scope (`F025`-`F028`) not yet implemented.

## Commands Run

- `npx vitest run src/components/settings/security/__tests__/SsoBulkAssignment.autoLinkClient.contract.test.ts` (workdir: `ee/server/`) ✅
- (2026-05-09) Implemented `F025`/`F026` in `ee/server/src/lib/actions/auth/ssoPreferences.ts`: added tenant-level SSO preference fields `clientPortalEntraProvisioningMode` (`disabled` default) and `deactivateEntraManagedPortalUsersOnEntitlementRemoval` (`true` default).
- (2026-05-09) Implemented `F027` in `ee/server/src/components/settings/security/SsoBulkAssignment.tsx`: added settings UI controls for client portal provisioning mode (`disabled`/`built_in`/`workflow_managed`) and entitlement-removal deactivation toggle.
- (2026-05-09) Added focused checklist test `T028` and extended `ee/server/src/components/settings/security/__tests__/SsoBulkAssignment.autoLinkClient.contract.test.ts` to cover the new settings UI wiring plus backing preference-field contract checks.
- (2026-05-09) Implemented `F028`: added per-managed-mapping persistence field `client_portal_entra_provisioning_mode` on `entra_client_tenant_mappings` (migration `20260509170000_add_client_portal_provisioning_mode_to_entra_mappings.cjs`), extended confirm mapping route parsing (`clientPortalEntraProvisioningMode` and snake_case alias), and persisted normalized mode (`disabled` default) in `confirmMappingsService`.
- (2026-05-09) Implemented `T010` completion for `F028`: extended `SsoBulkAssignment.autoLinkClient.contract.test.ts` with contract assertions that mapping confirm route/service include the per-mapping provisioning mode persistence path; added unit coverage `T065` in `confirmEntraMappingsService.clientLink.test.ts` validating default `disabled` persistence when mode is omitted.
- (2026-05-09) Implemented `F029`: added per-managed-mapping entitlement group persistence field `client_portal_entitlement_group_id` on `entra_client_tenant_mappings` (migration `20260509173000_add_entitlement_group_to_entra_mappings.cjs`), extended mapping confirm route parsing (`clientPortalEntitlementGroupId` plus snake_case alias), and persisted normalized value in `confirmMappingsService` update/insert paths.
- (2026-05-09) Implemented `F030`: added per-managed-mapping entitlement membership mode field `client_portal_entitlement_membership_mode` on `entra_client_tenant_mappings` (migration `20260509174500_add_entitlement_membership_mode_to_entra_mappings.cjs`), parsed confirm payload (`clientPortalEntitlementMembershipMode` plus snake_case alias), and persisted normalized mode with default `transitive` in `confirmMappingsService`.
- (2026-05-09) Implemented `F031`: added Entra mapping group loader endpoint `GET /api/integrations/entra/mappings/groups?managedTenantId=...`, extended Entra provider adapters with `listSecurityGroupsForTenant`, added `listEntraMappingGroups` action in `@alga-psa/integrations/actions`, and wired `EntraTenantMappingTable` to lazy-load/select entitlement groups per managed tenant row.

## Commands Run

- `npx vitest run src/components/settings/security/__tests__/SsoBulkAssignment.autoLinkClient.contract.test.ts` (workdir: `ee/server/`) ✅
- `npx vitest run src/__tests__/unit/confirmEntraMappingsService.clientLink.test.ts` (workdir: `ee/server/`) ✅
- `npx vitest run src/__tests__/unit/confirmEntraMappingsService.clientLink.test.ts` (workdir: `ee/server/`) ✅
- `npx vitest run src/__tests__/unit/entraTenantMappingTable.selection.test.tsx` (workdir: `ee/server/`) ✅
- `npx vitest run src/__tests__/unit/confirmEntraMappingsService.clientLink.test.ts src/__tests__/unit/entraTenantMappingTable.selection.test.tsx` (workdir: `ee/server/`) ✅
- `npx vitest run src/components/settings/security/__tests__/SsoBulkAssignment.autoLinkClient.contract.test.ts` (workdir: `ee/server/`) ✅
- `npx vitest run src/__tests__/unit/confirmEntraMappingsService.clientLink.test.ts` (workdir: `ee/server/`) ✅
