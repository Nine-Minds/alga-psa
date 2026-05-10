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
- (2026-05-09) Implemented `F032`: `mappings/confirm` route now validates any provided `clientPortalEntitlementGroupId` against live groups loaded for the corresponding managed tenant before persistence; invalid group IDs now fail with a guarded 400 and do not execute confirm mutations.
- (2026-05-09) Implemented `T020`: added `entraMappingsConfirmRoute.contract.test.ts` to lock the managed-tenant group-validation path for entitlement group IDs, and extended `confirmEntraMappingsService.clientLink.test.ts` (`T065`) to lock the transitive default for entitlement membership mode when omitted.

## Commands Run

- `npx vitest run src/components/settings/security/__tests__/SsoBulkAssignment.autoLinkClient.contract.test.ts` (workdir: `ee/server/`) ✅
- `npx vitest run src/__tests__/unit/confirmEntraMappingsService.clientLink.test.ts` (workdir: `ee/server/`) ✅
- `npx vitest run src/__tests__/unit/confirmEntraMappingsService.clientLink.test.ts` (workdir: `ee/server/`) ✅
- `npx vitest run src/__tests__/unit/entraTenantMappingTable.selection.test.tsx` (workdir: `ee/server/`) ✅
- `npx vitest run src/__tests__/unit/confirmEntraMappingsService.clientLink.test.ts src/__tests__/unit/entraTenantMappingTable.selection.test.tsx` (workdir: `ee/server/`) ✅
- `npx vitest run src/__tests__/unit/entraMappingsConfirmRoute.contract.test.ts src/__tests__/unit/confirmEntraMappingsService.clientLink.test.ts src/__tests__/unit/entraTenantMappingTable.selection.test.tsx` (workdir: `ee/server/`) ✅
- `npx vitest run src/components/settings/security/__tests__/SsoBulkAssignment.autoLinkClient.contract.test.ts` (workdir: `ee/server/`) ✅
- `npx vitest run src/__tests__/unit/confirmEntraMappingsService.clientLink.test.ts` (workdir: `ee/server/`) ✅
- (2026-05-09) Implemented `F033`: threaded client-portal entitlement sync context from `entra_client_tenant_mappings` into workflow mapping refs (`clientPortalEntraProvisioningMode`, entitlement group id, membership mode) and into each `EntraSyncUser` as `clientPortalEntitlement` metadata in `executeEntraSync`. This keeps entitlement provenance attached to each user record through reconciliation paths and prepares deterministic provisioning/lifecycle decisions without re-reading mapping config mid-user loop.
- (2026-05-09) Added unit coverage in `ee/server/src/__tests__/unit/entraSyncEngine.dryRun.test.ts` (`T112` internal) to assert entitlement context is attached to users passed through sync matching.
- (2026-05-09) Command: `npx vitest run src/__tests__/unit/entraSyncEngine.dryRun.test.ts` (workdir: `ee/server/`) ✅
- (2026-05-09) Implemented `F034`: added provider-level entitlement membership checks (`isUserInSecurityGroup`) for direct Graph and CIPP adapters, and enriched sync users in `syncTenantUsersActivity` with `clientPortalEntitlement.isMember` using the configured entitlement group and membership mode before reconciliation/provisioning logic.
- (2026-05-09) Added adapter tests for membership checks: `T113` in `directProviderAdapter.normalization.test.ts` and `T114` in `cippProviderAdapter.normalization.test.ts`.
- (2026-05-09) Command: `npx vitest run src/__tests__/unit/directProviderAdapter.normalization.test.ts src/__tests__/unit/cippProviderAdapter.normalization.test.ts src/__tests__/unit/entraSyncEngine.dryRun.test.ts` (workdir: `ee/server/`) ✅
- (2026-05-09) Implemented `F035`/`F036`/`F037`/`F038`/`F040`: added `clientPortalProvisioning` eligibility gate and hook in `syncEngine`. Provisioning hook executes only after successful non-ambiguous contact reconciliation and only when mode/group/identity/account/entitlement checks pass; ambiguous outcomes and ineligible users skip provisioning.
- (2026-05-09) Implemented `T011` behavior coverage via unit contracts in `entraSyncEngine.dryRun.test.ts` (`T115`, `T116`) and eligibility rule tests in `clientPortalProvisioningEligibility.test.ts` (`T117`-`T120`).
- (2026-05-09) Command: `npx vitest run src/__tests__/unit/clientPortalProvisioningEligibility.test.ts src/__tests__/unit/entraSyncEngine.dryRun.test.ts` (workdir: `ee/server/`) ✅
- (2026-05-09) Implemented `F039` (skip path): eligibility gate now blocks provisioning when `accountEnabled` is false (`reason: account_disabled`). Deactivation of existing Entra-managed portal users remains in later lifecycle items (`F051`/`F052`).
- (2026-05-09) Added `T121` in `clientPortalProvisioningEligibility.test.ts` for disabled-account skip gating.
- (2026-05-09) Command: `npx vitest run src/__tests__/unit/clientPortalProvisioningEligibility.test.ts` (workdir: `ee/server/`) ✅
- (2026-05-09) Implemented `F041`/`F042`/`F043`/`F044`/`F046` in `clientPortalProvisioning`: built-in provisioning now resolves existing client users by reconciled contact first, then performs a safe single-match tenant+email attach when non-conflicting, otherwise creates a new `users` record (`user_type='client'`, normalized email/username, contact link, active state) and upserts Microsoft OAuth account link with `provider_account_id = entraObjectId`.
- (2026-05-09) Updated `executeEntraSync` to pass reconciled `contactNameId` into provisioning mutations for both linked and created contact paths.
- (2026-05-09) Implemented `T012` via additional sync-engine skip coverage (`T125`) plus existing eligibility rules (`T120`): provisioning hook remains suppressed when entitlement group is missing or membership is false.
- (2026-05-09) Added built-in provisioning mutation coverage in `clientPortalProvisioning.builtIn.test.ts` (`T122`-`T124`) for existing-contact reuse, safe email attach, user creation path, and OAuth link upsert contract.

## Commands Run

- `npx vitest run src/__tests__/unit/clientPortalProvisioning.builtIn.test.ts src/__tests__/unit/entraSyncEngine.dryRun.test.ts src/__tests__/unit/clientPortalProvisioningEligibility.test.ts` (workdir: `ee/server/`) ✅
- (2026-05-09) Implemented `F047`/`F048`: added durable portal-user metadata column `users.client_portal_entra_metadata` (migration `server/migrations/20260509193000_add_client_portal_entra_metadata_to_users.cjs`) and now stamp/update metadata during built-in provisioning/link paths with managed flag, managed tenant id, Entra tenant/object identity, and entitlement source details.
- (2026-05-09) Extended `clientPortalProvisioning.builtIn.test.ts` assertions to lock metadata stamping behavior for existing-contact link, safe email attach, and create-new-user paths.
- `npx vitest run src/__tests__/unit/clientPortalProvisioning.builtIn.test.ts src/__tests__/unit/entraSyncEngine.dryRun.test.ts src/__tests__/unit/clientPortalProvisioningEligibility.test.ts` (workdir: `ee/server/`) ✅
- (2026-05-09) Implemented `F045`: built-in provisioning creates client users in OAuth-ready state without password setup (`hashed_password` omitted) and immediately creates/upserts Microsoft OAuth account links for sign-in identity.
- (2026-05-09) Implemented `F067` guard in eligibility path: `workflow_managed` mode now short-circuits built-in mutations (`reason: workflow_managed`) so built-in user/link writes do not run when workflow-managed mode is configured.
- (2026-05-09) Added tests `T126` (`clientPortalProvisioningEligibility.test.ts`) and `T127` (`entraSyncEngine.dryRun.test.ts`) for workflow-managed mutual exclusion and OAuth-ready create-path contract.
- `npx vitest run src/__tests__/unit/clientPortalProvisioning.builtIn.test.ts src/__tests__/unit/entraSyncEngine.dryRun.test.ts src/__tests__/unit/clientPortalProvisioningEligibility.test.ts` (workdir: `ee/server/`) ✅
- (2026-05-09) Implemented `T013` coverage with `T128` in `entraSyncEngine.dryRun.test.ts`: built-in eligible users now explicitly assert provisioning hook execution only after non-ambiguous reconciliation and with resolved `contactNameId` context.
- (2026-05-09) `T013` behavior is completed jointly by sync-hook invocation contract (`T128`) and provisioning mutation contracts (`T122`-`T124`) verifying existing-user reuse, create path, Entra metadata stamping, and Microsoft OAuth link upsert.
- `npx vitest run src/__tests__/unit/clientPortalProvisioning.builtIn.test.ts src/__tests__/unit/entraSyncEngine.dryRun.test.ts src/__tests__/unit/clientPortalProvisioningEligibility.test.ts` (workdir: `ee/server/`) ✅
- (2026-05-09) Implemented `F049`/`F050`: built-in portal provisioning now performs explicit conflict checks before mutation/linking (multiple client users on reconciled contact, conflicting tenant email matches, and Microsoft OAuth link collisions) and returns deterministic `skipped_conflict` outcomes instead of creating duplicates.
- (2026-05-09) Implemented `F056` (return path): sync counters now include `skipped`, and `executeEntraSync` increments `skipped` when provisioning reports conflict outcomes; Temporal Entra workflow summaries now carry `skipped` totals for run-level observability.
- (2026-05-09) Implemented `T014` with unit contracts: `clientPortalProvisioning.builtIn.test.ts` (`T129`,`T130`) covers contact/link conflict detection, and `entraSyncEngine.dryRun.test.ts` (`T131`) verifies skipped/conflict counters are recorded without duplicate provisioning.

## Commands Run

- `npx vitest run src/__tests__/unit/clientPortalProvisioning.builtIn.test.ts src/__tests__/unit/entraSyncEngine.dryRun.test.ts src/__tests__/unit/entraSyncResultAggregator.test.ts` (workdir: `ee/server/`) ✅
- `npx vitest run src/workflows/__tests__/entra-all-tenants-sync-workflow.test.ts src/workflows/__tests__/entra-initial-sync-workflow.test.ts src/workflows/__tests__/entra-tenant-sync-workflow.test.ts` (workdir: `ee/temporal-workflows/`) ⚠️ no matching tests found in that package

## Gotchas

- (2026-05-09) `clientPortalProvisioning` now returns a structured outcome (`provisioned` or `skipped_conflict`), so sync callers/mocks must assert return values instead of treating provisioning as `void`.
- (2026-05-09) Implemented `F051`/`F052`/`F053`/`F054`/`F055`: added lifecycle handler for ineligible Entra users that deactivates only Entra-managed client portal users on entitlement loss (when configured) or disabled Entra accounts, stamps lifecycle ownership metadata (`owner=entra_sync`, reason/state/timestamp), and reactivates only users previously lifecycle-deactivated by Entra when eligibility returns.
- (2026-05-09) `executeEntraSync` now calls lifecycle handling for ineligible-but-reconciled users and increments inactivated counters only when lifecycle deactivation actually occurs.
- (2026-05-09) Temporal sync activity now reads tenant SSO preference `deactivateEntraManagedPortalUsersOnEntitlementRemoval` from `tenant_settings.settings.sso` and passes it into sync entitlement context.
- (2026-05-09) Added lifecycle test coverage: `clientPortalProvisioning.lifecycle.test.ts` (`T136`-`T138`), `clientPortalProvisioning.builtIn.test.ts` (`T134`,`T135`), and `entraSyncEngine.dryRun.test.ts` (`T132`,`T133`).

## Commands Run

- `npx vitest run src/__tests__/unit/clientPortalProvisioning.builtIn.test.ts src/__tests__/unit/clientPortalProvisioning.lifecycle.test.ts src/__tests__/unit/entraSyncEngine.dryRun.test.ts` (workdir: `ee/server/`) ✅
- (2026-05-09) Implemented `F057`: Entra sync history drilldown now displays skipped provisioning counts in two natural places: per-tenant stats (`..., skipped N`) and run-summary skipped totals when present in run summary payload.
- (2026-05-09) Updated `entraSyncHistoryPanel.test.tsx` to lock skipped-count rendering and added deterministic i18n mocks for stable assertions.

## Commands Run

- `npx vitest run src/__tests__/unit/entraSyncHistoryPanel.test.tsx` (workdir: `ee/server/`) ✅
- (2026-05-09) Implemented `F058`/`F059`: extended portal invitation flow to accept optional Entra pre-link metadata (`entraPrelink`) and persist it on `portal_invitations.metadata`; token verification now returns `prelinkedOAuth` context when present.
- (2026-05-09) `completePortalSetup` now supports passwordless completion when a valid Entra pre-link exists: it reactivates/creates the client user, upserts Microsoft OAuth link (`oauth_account_links` keyed by tenant+provider+provider_account_id), and marks the invitation used without forcing password setup.
- (2026-05-09) Added `T019` coverage in `server/src/test/unit/portalInvitationOAuthPrelink.contract.test.ts` to lock pre-link persistence and passwordless OAuth-ready completion contracts.

## Commands Run

- `npx vitest run src/test/unit/portalInvitationOAuthPrelink.contract.test.ts src/test/unit/contacts/ContactEmailDefaultConsumer.contract.test.ts` (workdir: `server/`) ✅
- (2026-05-09) Marked `F060` complete after verification: lifecycle deactivation path explicitly targets only `users` rows with `client_portal_entra_metadata.managed=true` plus matching Entra identity, so invitation/manual users without that metadata remain outside Entra lifecycle ownership.
- (2026-05-09) Implemented `F062`: regenerated API route inventory via `scripts/generate_route_inventory.py`; inventory now includes both client portal SSO endpoints (`/api/auth/client-portal/sso/discover`, `/api/auth/client-portal/sso/resolve`) in `docs/openapi/route-inventory.json` and `.csv`.

## Commands Run

- `python3 scripts/generate_route_inventory.py` ✅
- `rg -n "client-portal/sso/discover|client-portal/sso/resolve" docs/openapi/route-inventory.json docs/openapi/route-inventory.csv` ✅
- (2026-05-09) Implemented `F063`/`F064`/`F065`: added per-mapping default role persistence (`client_portal_default_role_name`, default `User`) through Entra mapping confirm route/service + migration (`20260509195500_add_client_portal_default_role_to_entra_mappings.cjs`), threaded the setting into Temporal sync mapping refs and `executeEntraSync` entitlement context, and applied role assignment only on built-in create-path in `clientPortalProvisioning` by resolving `roles.client=true` + case-insensitive role name and inserting `user_roles` for newly created portal users.
- (2026-05-09) Existing-user provisioning/link/update paths intentionally do not write `user_roles`, preserving manual role changes on later sync runs (`F065`).
- (2026-05-09) Implemented `T021` in `clientPortalProvisioning.builtIn.test.ts`: verifies configured default role assignment on create and verifies no role assignment mutation on existing-user sync path.

## Commands Run

- `npx vitest run src/__tests__/unit/clientPortalProvisioning.builtIn.test.ts src/__tests__/unit/confirmEntraMappingsService.clientLink.test.ts src/__tests__/unit/entraSyncEngine.dryRun.test.ts src/__tests__/unit/entraTenantMappingTable.selection.test.tsx` (workdir: `ee/server/`) ✅

## Gotchas

- (2026-05-09) Role assignment uses role-name lookup (`roles.client=true`, case-insensitive) rather than role_id because role IDs are tenant-specific; mapping stores configurable role name and defaults to `User`.
- (2026-05-09) Implemented `F066`: `EntraTenantMappingTable` now renders explicit warning copy when selected entitlement group label indicates a broad group (`All Users`), clarifying that all enabled users in that group become portal-eligible.
- (2026-05-09) Implemented `T022` in `entraTenantMappingTable.selection.test.tsx` to verify warning visibility after selecting a broad entitlement group.

## Commands Run

- `npx vitest run src/__tests__/unit/entraTenantMappingTable.selection.test.tsx src/__tests__/unit/clientPortalProvisioning.builtIn.test.ts src/__tests__/unit/confirmEntraMappingsService.clientLink.test.ts` (workdir: `ee/server/`) ✅
- (2026-05-09) Implemented `F068`: added per-mapping workflow target/config persistence (`client_portal_workflow_target`, `client_portal_workflow_config`) via confirm route/service and migration `20260509202000_add_client_portal_workflow_fields_to_entra_mappings.cjs`, and threaded fields through mapped-tenant load output into sync execution context.
- (2026-05-09) Implemented `F069`/`F070`/`F071`: added workflow-managed provisioning publisher (`workflowManagedProvisioning.ts`) and sync-engine branch for `workflow_managed` mode that publishes idempotent `ENTRA_PORTAL_ACCESS_ELIGIBLE` or `ENTRA_PORTAL_ACCESS_REMOVED` events after successful non-ambiguous contact reconciliation, without running built-in provisioning or lifecycle mutation paths.
- (2026-05-09) Event payload now includes tenant/client/contact, managed mapping, Entra identity/account state, entitlement group/membership/isMember, recommended default role, workflow target/config, and sync run context; idempotency key includes tenant + mapping + Entra tenant/object + entitlement source + decision + sync run.
- (2026-05-09) Implemented `T023`/`T024` in `entraSyncEngine.dryRun.test.ts` and `workflowManagedProvisioning.test.ts` to verify workflow-managed eligible/removed event publishing, payload/idempotency context, and suppression of built-in provisioning/lifecycle mutations.

## Commands Run

- `npx vitest run src/__tests__/unit/entraSyncEngine.dryRun.test.ts src/__tests__/unit/workflowManagedProvisioning.test.ts src/__tests__/unit/confirmEntraMappingsService.clientLink.test.ts` (workdir: `ee/server/`) ✅
- (2026-05-09) Implemented `F075`: `SsoBulkAssignment` now shows workflow-managed mode info copy clarifying that Entra sync only emits events and workflow logic owns provisioning, role assignment, invitations, and lifecycle actions.
- (2026-05-09) Strengthened `F068` coverage by extending confirm-mapping unit contracts to assert workflow target/config persistence fields in insert payloads.
- (2026-05-09) Implemented `T026` via `SsoBulkAssignment.autoLinkClient.contract.test.ts` assertions on workflow-managed explanatory copy.

## Commands Run

- `npx vitest run src/components/settings/security/__tests__/SsoBulkAssignment.autoLinkClient.contract.test.ts src/__tests__/unit/confirmEntraMappingsService.clientLink.test.ts src/__tests__/unit/entraSyncEngine.dryRun.test.ts src/__tests__/unit/workflowManagedProvisioning.test.ts` (workdir: `ee/server/`) ✅
- (2026-05-09) Implemented `F072`/`F073`/`F074`: added workflow action primitives in `workflowPortalAccessActions.ts` for safe idempotent client portal provisioning/linking (reuses built-in provisioning primitive), client-role assignment (`user_roles` insert only when missing), Microsoft OAuth link upsert, and managed-only deactivate/reactivate lifecycle toggles keyed by Entra metadata ownership.
- (2026-05-09) Implemented `T025` in `workflowPortalAccessActions.test.ts` to verify action contracts: create/link reuse path, idempotent role assignment and OAuth link upsert, and managed lifecycle deactivate/reactivate without touching non-eligible paths.

## Commands Run

- `npx vitest run src/__tests__/unit/workflowPortalAccessActions.test.ts src/__tests__/unit/entraSyncEngine.dryRun.test.ts src/__tests__/unit/workflowManagedProvisioning.test.ts` (workdir: `ee/server/`) ✅

## Decisions

- (2026-05-10) Revised provisioning-mode design after review: the MSP workspace setting is the global default policy for client portal Entra provisioning, and each Alga client mapping may override that default with `inherit`, `disabled`, `built_in`, or `workflow_managed`.
- (2026-05-10) Portal access group selection remains explicit per Alga client mapping because Entra group IDs are scoped to the managed Microsoft tenant and are not safe to inherit globally. A future "match group by name" helper could change this, but it is out of scope for the current plan.
- (2026-05-10) Default portal role resolves similarly to mode: per-client override first, then MSP workspace default role, then `User`.
- (2026-05-10) User-facing terminology should avoid overloaded "tenant": use `MSP workspace` for Alga tenant-level settings, `Client` for Alga client/company, `managed Microsoft tenant` for Entra/customer tenant, and `client mapping` for the mapping row.
- (2026-05-10) Existing branch implementation has pieces of this behavior, but does not yet compute effective mode from workspace default plus per-client override. Added `F076`-`F080` and `T029`-`T031` as not implemented to track the remaining design correction.
- (2026-05-10) Implemented design-correction bundle `F028`/`F036`/`F063`/`F076`/`F077`/`F078`/`F079`/`F080`:
  - Added explicit per-client mapping provisioning-mode override semantics (`inherit`/`disabled`/`built_in`/`workflow_managed`) in mapping UI + confirm persistence, with `inherit` as the default persisted override.
  - Added workspace default client-portal role setting in SSO preferences (`clientPortalDefaultRoleName`, default `User`) and surfaced it in security UI as MSP workspace default role.
  - Added shared effective-resolution helpers in `clientPortalEntitlementResolution.ts` and used them in Temporal Entra mapped-tenant loading so effective provisioning mode resolves as override first, workspace default second; effective default role resolves as mapping override, then workspace default, then `User`.
  - Kept portal access group explicit per client mapping in UI/API payloads; no global group inheritance path added.
  - Updated client-mapping table terminology to emphasize managed Microsoft tenant and client mapping context.
- (2026-05-10) Implemented `T029`/`T030`/`T031` coverage:
  - `T029`/`T031`: new resolution unit contracts in `ee/server/src/__tests__/unit/clientPortalEntitlementResolution.test.ts`.
  - `T030`: updated mapping-table selection contract `entraTenantMappingTable.selection.test.tsx` to assert override payload (`clientPortalEntraProvisioningMode`) and terminology copy.
  - Updated confirm-mapping contracts for inherit/default-role-null persistence semantics in `confirmEntraMappingsService.clientLink.test.ts`.

## Commands Run

- `npx vitest run src/__tests__/unit/clientPortalEntitlementResolution.test.ts src/__tests__/unit/confirmEntraMappingsService.clientLink.test.ts src/__tests__/unit/entraTenantMappingTable.selection.test.tsx src/components/settings/security/__tests__/SsoBulkAssignment.autoLinkClient.contract.test.ts src/__tests__/unit/entraSyncEngine.dryRun.test.ts src/__tests__/unit/clientPortalProvisioning.builtIn.test.ts src/__tests__/unit/workflowManagedProvisioning.test.ts` (workdir: `ee/server/`) ✅
- `npx vitest run src/lib/nextAuthOptions.clientPortalSso.contract.test.ts src/components/mspSsoRegression.contract.test.ts` (workdir: `packages/auth/`) ✅
