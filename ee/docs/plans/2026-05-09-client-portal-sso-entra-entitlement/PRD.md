# PRD — Client Portal SSO and Entra Entitlement

- Slug: `2026-05-09-client-portal-sso-entra-entitlement`
- Date: `2026-05-09`
- Status: Draft

## Summary

Enable SSO for the client portal as an MSP-workspace-scoped authentication surface and add Entra-driven portal user provisioning gated by explicit Entra group entitlement. Provisioning can use Alga's built-in behavior or an explicit workflow-managed mode for MSPs that need customized approval, role assignment, invitations, or notification logic.

Client portal SSO must not reuse MSP email-domain discovery. SSO is unavailable until the Alga MSP workspace context is known through a tenant slug, active portal domain, or trusted client portal callback context. Entra sync may create or update contacts broadly, but it may create portal users only when a configured Entra group grants portal access.

Terminology must distinguish Alga and Microsoft concepts:

- **MSP workspace** means the Alga tenant/workspace that owns configuration and users.
- **Client** means the Alga client/customer company.
- **Managed Microsoft tenant** means the Entra tenant/customer tenant synced through the MSP's Microsoft relationship.
- **Client mapping** means the Alga client to managed Microsoft tenant mapping.

## Problem

MSP SSO is built for internal users and discovers providers from email domains claimed by MSP tenants. Client portal users are different: they belong to an MSP customer/client, often use customer email domains, and arrive through a tenant-scoped portal entrypoint. Reusing MSP domain discovery would mix internal tenant identity rules with external client portal access decisions.

Entra sync currently creates and links contacts, but contacts do not automatically have client portal access. MSPs need a data-driven way to decide which synced customer users should receive portal access without granting access to every synced contact.

## Goals

- Enable Microsoft and Google SSO for client portal users.
- Require known tenant context before client portal SSO providers are shown or resolved.
- Authenticate only active `users.user_type = 'client'` users in the resolved tenant.
- Allow Entra sync to provision client portal users when explicitly enabled through built-in provisioning.
- Allow Entra sync to emit workflow events instead of built-in provisioning when MSPs explicitly select workflow-managed provisioning.
- Gate portal user provisioning by Entra group membership.
- Link Microsoft OAuth identities to provisioned portal users using Entra object IDs.
- Deactivate Entra-managed portal users when account status or entitlement requires it.
- Preserve manually managed portal users unless explicitly marked Entra-managed.
- Replace disabled-client-SSO guard tests with behavioral tests for tenant-gated SSO.

## Non-goals

- Do not use MSP internal SSO domain claims for client portal discovery.
- Do not create portal users during interactive OAuth login.
- Do not grant portal access to all synced contacts.
- Do not deactivate manually managed portal users because they are absent from an Entra access group.
- Do not build a new general policy engine for attributes, app roles, or conditional access in this scope.
- Do not run built-in provisioning mutations and workflow-managed provisioning mutations for the same sync decision.
- Do not change MSP SSO behavior except where shared utilities need safe extension.

## Users and Primary Flows

### MSP Admin Configures Client Portal SSO

1. MSP configures tenant/provider SSO credentials as they do for existing SSO.
2. MSP opens SSO/security settings.
3. MSP enables client-user OAuth auto-linking if desired.
4. MSP chooses the MSP workspace default client portal provisioning mode: disabled, built-in, or workflow-managed.
5. MSP selects the managed Microsoft tenant/client mapping.
6. MSP selects an Entra security group that grants client portal access.
7. MSP optionally overrides the workspace default for the specific Alga client mapping.
8. In built-in mode, MSP keeps or changes the default Alga client portal role for newly provisioned users, defaulting to `User`.
9. MSP keeps or changes the default behavior to deactivate Entra-managed portal users when entitlement is removed.

### Customer User Signs In With SSO

1. User reaches a tenant-scoped client portal sign-in page.
2. User enters email.
3. The UI discovers SSO providers for the resolved tenant.
4. User chooses Microsoft or Google.
5. OAuth callback maps the provider identity to an active client portal user in that tenant.
6. User lands on the correct client portal URL, including vanity-domain handoff when applicable.

### Entra Sync Provisions Portal Access

1. Entra sync reconciles the user to a contact.
2. Provisioning checks tenant and client mapping configuration.
3. Provisioning checks account enabled state and configured group membership.
4. Provisioning creates or updates the client portal user.
5. Provisioning upserts the Microsoft OAuth account link.

### Entra Sync Triggers Workflow-Managed Portal Access

1. Entra sync reconciles the user to a contact.
2. Provisioning checks tenant and client mapping configuration.
3. Provisioning checks account enabled state and configured group membership.
4. If workflow-managed mode is selected, Entra sync publishes an idempotent workflow event instead of creating, linking, deactivating, or reactivating a portal user directly.
5. The configured workflow may create or link the portal user, choose a role, send an invitation, create an approval task, notify staff, skip provisioning, deactivate access, or reactivate access.

### Entitlement Removal

1. Entra sync observes that the user is no longer in the configured portal access group or the Entra account is disabled.
2. If the portal user is Entra-managed and the deactivation setting is enabled, Alga deactivates the portal user.
3. Manually managed portal users remain unchanged.

## UX / UI Notes

- `ClientLoginForm` should render SSO buttons only after tenant context is known.
- Before tenant context is known, the existing tenant discovery screen remains the first step.
- SSO buttons should use the same visual component as MSP SSO where practical, but the component should be configurable by auth surface and endpoint paths.
- Configuration UI should keep "auto-link existing client users" separate from "provision client portal users from Entra".
- Configuration UI should expose client portal provisioning mode as disabled, built-in, or workflow-managed.
- Use "MSP workspace" in user-facing copy when referring to Alga tenant-level settings.
- Use "managed Microsoft tenant" in user-facing copy when referring to the Entra tenant/customer tenant.
- Managed Microsoft tenant/client mapping UI should expose group selection for portal access entitlement.
- Managed Microsoft tenant/client mapping UI should allow a per-client override for portal access provisioning mode. The default should be `Inherit workspace default`, with explicit `Disabled`, `Built-in`, and `Workflow-managed` override choices.
- Managed Microsoft tenant/client mapping UI should allow a default Alga client portal role for newly provisioned users in built-in mode, defaulting to the workspace default role, expected to be `User`.
- The portal access group must remain explicit per client mapping and should not inherit globally unless a future feature implements safe "match group by name" behavior across managed Microsoft tenants.
- Workflow-managed mode should clearly state that Entra sync emits events and the selected workflow is responsible for portal user provisioning, role assignment, invitations, and lifecycle changes.
- When an MSP selects a broad group such as "All Users", the UI should warn that every enabled user in that group will be eligible for client portal access.
- Sync/provisioning results should show counts for created, linked, deactivated, skipped, and ambiguous records where the existing sync UI has a natural place for those results.

## Requirements

### Functional Requirements

1. Add client portal SSO discovery and resolution endpoints.
2. Discovery returns no providers when tenant context cannot be resolved.
3. Discovery returns tenant-configured providers when tenant context is resolved.
4. Resolution accepts only providers returned for the resolved tenant context.
5. OAuth login state identifies client portal login mode and client user type.
6. OAuth profile mapping for client portal SSO requires tenant match and `user_type = 'client'`.
7. OAuth client users are redirected through the existing vanity-domain handoff when applicable.
8. Entra sync supports portal user provisioning after successful contact reconciliation.
9. Provisioning is gated by effective provisioning mode, mapped client, account enabled state, email/UPN, non-ambiguous contact reconciliation, and group entitlement.
10. Built-in provisioning creates or updates portal users and Microsoft OAuth account links.
11. Provisioned users are marked as Entra-managed with enough metadata to distinguish lifecycle-owned users from manual users.
12. Newly provisioned portal users in built-in mode receive the effective default Alga client portal role, defaulting to the MSP workspace default role, expected to be `User`.
13. The default role is assigned only at creation time, and later manual Alga role changes are preserved by Entra sync.
14. Entitlement removal deactivates Entra-managed portal users when configured.
15. Entitlement return may reactivate only users deactivated by the Entra lifecycle, not manually disabled users.
16. Workflow-managed provisioning mode publishes idempotent workflow events instead of performing built-in portal user mutations.
17. Workflow-managed provisioning events include enough context for a workflow to decide whether and how to provision access, including tenant, client, contact, Entra tenant, Entra object, account enabled state, entitlement state, configured group, and recommended default role.
18. Workflow-managed provisioning provides workflow actions or reusable operations for creating/linking a client portal user, assigning a client portal role, upserting the Microsoft OAuth link, deactivating access, reactivating access, and sending an invitation where the existing workflow system does not already expose safe equivalents.
19. Workflow-managed provisioning must be idempotent so repeated sync runs do not create duplicate portal users, duplicate OAuth links, or duplicate lifecycle actions.
20. Built-in provisioning and workflow-managed provisioning are mutually exclusive for a given mapped client sync decision.

### Non-functional Requirements

- Failure responses must avoid user enumeration.
- Cross-surface state between MSP SSO and client portal SSO must not be interchangeable.
- Tenant resolution must be explicit and auditable from request inputs.
- Database mutations for contact reconciliation, portal user provisioning, and OAuth link creation should be transactionally consistent where practical.

## Data / API / Integrations

### Client Portal SSO Endpoints

- `POST /api/auth/client-portal/sso/discover`
- `POST /api/auth/client-portal/sso/resolve`

Discovery inputs should include email and tenant context candidates. Resolution inputs should include provider, email, callback URL, and tenant context candidates.

### Settings

Extend MSP workspace SSO settings with:

- `autoLinkClient`
- `clientPortalEntraProvisioningMode`: workspace default of `disabled`, `built_in`, or `workflow_managed`
- `clientPortalDefaultRoleName`: workspace default role name for newly built-in-provisioned client portal users, defaulting to `User`
- `deactivateEntraManagedPortalUsersOnEntitlementRemoval`

`autoLinkInternal` remains unchanged.

### Entra Entitlement Configuration

Persist per managed Microsoft tenant/client mapping configuration for:

- portal provisioning mode override: inherit workspace default, disabled, built-in, or workflow-managed
- Entra group ID granting portal access
- group membership mode, defaulting to transitive
- optional default Alga client portal role override for newly provisioned users in built-in mode
- workflow target/configuration when workflow-managed mode is selected

The effective provisioning mode is resolved as:

1. If the client mapping has an explicit override, use it.
2. Otherwise, use the MSP workspace default.
3. If the effective mode is disabled, do not run built-in provisioning or publish workflow-managed access events.
4. If the effective mode is built-in or workflow-managed, an explicit portal access group is still required on the client mapping.

The effective default role is resolved as:

1. If the client mapping has an explicit default role override, use it.
2. Otherwise, use the MSP workspace default role.
3. If neither is set, use `User`.

### Workflow Events and Actions

Add workflow event schema for Entra client portal access decisions. Initial event types should distinguish access eligibility from access removal, for example:

- `ENTRA_PORTAL_ACCESS_ELIGIBLE`
- `ENTRA_PORTAL_ACCESS_REMOVED`

Events should carry a stable idempotency key derived from MSP workspace, client mapping, managed Microsoft tenant, Entra object ID, entitlement source, and lifecycle decision. The sync run ID should be included in the payload/correlation context, but not in the idempotency key, so retries and repeated syncs for the same decision remain idempotent. Workflow actions that mutate portal users must reuse the same safe provisioning primitives as built-in mode where practical.

### Portal User Metadata

Add or reuse durable metadata that records:

- portal user is Entra-managed
- source managed Microsoft tenant ID
- Microsoft/Entra tenant ID
- Entra object ID
- entitlement source type and ID
- last lifecycle action and reason when needed to distinguish lifecycle deactivation from manual deactivation

### OAuth Account Link

Provisioning should upsert `oauth_account_links` for Microsoft using Entra object ID as the stable provider account ID where provider semantics support it.

## Security / Permissions

- SSO discovery and resolution endpoints are unauthenticated but must be rate-limited and anti-enumeration safe.
- Client portal SSO state should use separate cookies or an explicit audience marker from MSP SSO.
- Client portal OAuth mapping must never authenticate an internal user.
- Client portal OAuth mapping must not fall back to a global client-user lookup when tenant context is available or required.
- Entra provisioning configuration requires settings/integration management permission.
- Group selection must be limited to the managed Entra tenant mapped to the client.
- Entra entitlement controls portal access eligibility only; Alga roles remain the source of truth for in-app client portal permissions.
- Workflow-managed mode must require workflow management permission in addition to integration/settings permission when selecting or changing workflow behavior.

## Observability

Within this scope, surface provisioning result counts in sync outcomes and logs already associated with Entra sync. Do not add a separate analytics or monitoring system as part of this plan.

## Rollout / Migration

- Default new provisioning settings off.
- Default provisioned user role to the lowest-privilege standard client portal role, expected to be `User`.
- Default MSP workspace provisioning mode to disabled.
- Default client mappings to inherit the MSP workspace provisioning mode.
- Require an explicit portal access group on each client mapping before built-in provisioning or workflow-managed events can grant access.
- When provisioning is enabled from a new configuration, default to built-in mode unless the MSP explicitly selects workflow-managed mode.
- Keep client portal SSO unavailable unless tenant context is known and provider configuration exists.
- Existing client portal credential login must continue to work.
- Existing MSP SSO must continue to work.
- Existing guard tests asserting client portal SSO is disabled should be removed or rewritten as tenant-gating tests.
- Any schema migration must preserve existing portal users and contacts.

## Open Questions

- Exact table or column strategy for Entra-managed portal user metadata.
- Exact storage representation for per-client "inherit workspace default" provisioning-mode override.
- Exact storage representation for workspace default role and per-client default-role override.
- Exact role identifier for the standard default client portal `User` role.
- Exact workflow event naming and whether the first implementation uses one decision event or separate eligible/removed events.
- Exact workflow action surface needed if existing workflow actions cannot safely create/link/deactivate portal users.
- Whether Google SSO should support Entra-provisioned portal users immediately through email-based matching only, or whether first release should emphasize Microsoft SSO for provisioned users.
- Whether group membership discovery should be direct and transitive configurable in the first UI, or transitive-only initially with schema support for later direct-only.

## Acceptance Criteria (Definition of Done)

- Client portal SSO is unavailable before tenant context is known.
- Client portal SSO works for active existing client users in the resolved tenant.
- Client portal SSO does not authenticate internal users or client users from another tenant.
- Entra sync can provision a portal user only when the configured group entitlement matches.
- Newly provisioned portal users receive the configured default Alga role, defaulting to `User`.
- Entra sync does not overwrite later manual Alga role changes.
- Entra sync creates or updates the Microsoft OAuth account link for provisioned users.
- Workflow-managed mode emits idempotent provisioning/lifecycle workflow events instead of running built-in portal user mutations.
- Entitlement loss deactivates only Entra-managed portal users.
- Manual portal users are not deactivated by entitlement loss.
- Existing credential login, MSP SSO, and client portal tenant discovery continue to work.
- Behavioral tests cover the critical auth, provisioning, and lifecycle paths.
