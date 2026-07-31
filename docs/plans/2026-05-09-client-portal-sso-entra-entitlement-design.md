# Client Portal SSO and Entra Entitlement Design

Date: 2026-05-09

## Summary

Client portal SSO should be a tenant-scoped auth surface, separate from MSP SSO. MSP SSO remains email-domain discovery based. Client portal SSO is available only after tenant context is known through a tenant slug, portal domain, or trusted client portal callback context.

The full rollout includes SSO login, Entra-backed portal user provisioning, entitlement-based lifecycle management, workflow-managed provisioning as an advanced override, and invitation/prelink support. Contact sync remains broad, but portal access is an explicit entitlement.

## Goals

- Enable Microsoft and Google SSO for client portal users.
- Require tenant context before showing or starting client portal SSO.
- Authenticate only `users.user_type = 'client'` users for client portal SSO.
- Allow Entra sync to provision client portal users when explicitly enabled.
- Allow Entra sync to trigger workflow-managed provisioning instead of built-in provisioning when an MSP explicitly selects that mode.
- Gate automatic portal access by Entra group membership.
- Deactivate only Entra-managed portal users when entitlement is removed.
- Keep MSP SSO domain discovery behavior unchanged.

## Non-Goals

- Do not use MSP internal login-domain claims to discover client portal SSO tenants.
- Do not create portal users during interactive OAuth login.
- Do not give every synced contact client portal access.
- Do not deactivate manually managed portal users based only on Entra entitlement state.
- Do not run built-in portal user mutations and workflow-managed portal user mutations for the same Entra sync decision.

## Architecture

Client portal SSO uses dedicated unauthenticated endpoints:

- `POST /api/auth/client-portal/sso/discover`
- `POST /api/auth/client-portal/sso/resolve`

These endpoints may reuse shared provider credential helpers, signing helpers, and OAuth profile mapping primitives, but they should not reuse MSP domain-discovery semantics.

Discovery requires tenant context from one of:

- a valid tenant slug
- a known active portal domain
- a trusted client portal callback URL whose host/path maps to a tenant

When tenant context cannot be resolved, discovery returns a neutral successful response with no providers. The UI keeps SSO unavailable.

Resolution validates:

- provider
- tenant context
- provider availability for the tenant
- callback URL safety
- signed discovery context

Resolution writes client-portal-specific signed state, preferably using separate cookie names such as `client_sso_discovery` and `client_sso_resolution`. Payloads should include an audience marker such as `audience = "client-portal"`, tenant ID, provider, source, and callback context.

OAuth state should include:

- `mode = "login"`
- `user_type = "client"`
- tenant hint
- vanity or callback context when needed

OAuth profile mapping for client portal SSO must require:

- `user_type = "client"`
- tenant match
- active user

It should not fall back to global client-user lookup across tenants.

OAuth redirects for client users should use the same vanity-domain handoff mechanism currently used by credentials login.

## Entra Provisioning

Entra contact sync continues to create or link contacts as it does today. Portal-user provisioning is a separate step after contact reconciliation succeeds.

A contact is eligible for automatic portal-user provisioning only when all conditions are true:

- client portal Entra provisioning mode is built-in
- the managed Entra tenant is mapped to an Alga client
- the Entra user has an email or UPN
- the Entra account is enabled
- contact reconciliation is non-ambiguous
- the user is a member of the configured client portal access group
- no conflicting portal user exists for the contact, email, and tenant

Provisioning creates or updates:

- a `users` row with `user_type = "client"`, `contact_id`, tenant, email, and inactive state
- an `oauth_account_links` row linking the Microsoft provider account ID to the portal user
- metadata marking the portal user as Entra-managed, including managed tenant, Entra object ID, and entitlement source

Portal-user creation must not happen during interactive OAuth login. OAuth login should only authenticate or link existing portal users.

## Entitlement Model

The first supported entitlement source is Entra group membership.

MSPs configure a group such as `Alga Client Portal Users` in the customer's Entra tenant, then select that group in Alga for the managed tenant and client mapping.

Group membership should be transitive by default so nested group patterns work. The data model should treat entitlement as an abstract rule so future sources can be added, such as custom security attributes or app role assignments.

Custom attributes are intentionally not first because they require heavier Microsoft Graph permissions and Entra role setup. Department, job title, and similar profile fields should not be used for access control.

## Workflow-Managed Provisioning

Built-in provisioning should remain the default enabled path. It covers the common MSP workflow: members of the configured Entra group receive portal access with the configured default Alga client portal role.

Workflow-managed provisioning is an advanced mode that replaces built-in portal user mutations for a mapped client. Entra sync still reconciles contacts and evaluates account status/group entitlement, then publishes idempotent workflow events instead of creating, linking, deactivating, or reactivating portal users directly.

Initial workflow events should distinguish access eligibility from access removal, for example:

- `ENTRA_PORTAL_ACCESS_ELIGIBLE`
- `ENTRA_PORTAL_ACCESS_REMOVED`

Event payloads should include tenant, client, contact, managed Entra tenant/client mapping, Entra tenant ID, Entra object ID, account enabled state, entitlement state, configured group, recommended default role, and sync run context. Workflow actions should safely create/link portal users, assign roles, upsert Microsoft OAuth links, send invitations, deactivate access, and reactivate lifecycle-disabled users using idempotent primitives.

## Lifecycle

When an Entra-managed portal user loses group membership, Alga deactivates that portal user if `deactivateEntraManagedPortalUsersOnEntitlementRemoval` is enabled.

When an Entra account is disabled, Alga deactivates the corresponding Entra-managed portal user.

When entitlement returns, Alga may reactivate the portal user only if the user was deactivated by the Entra lifecycle. A manual MSP-admin deactivation should not be automatically undone.

Manually created portal users are not deactivated merely because the related Entra user is missing from the portal-access group unless they have been explicitly marked as Entra-managed.

## Configuration

Tenant-level settings:

- `autoLinkInternal`: existing behavior
- `autoLinkClient`: OAuth auto-linking for existing client portal users
- `clientPortalEntraProvisioningMode`: new, default `disabled`; allowed values `disabled`, `built_in`, and `workflow_managed`
- `deactivateEntraManagedPortalUsersOnEntitlementRemoval`: new, default `true`

Per managed Entra tenant and client mapping settings:

- choose client portal provisioning mode for this mapped client
- select the Entra group that grants portal access
- choose direct-only or transitive membership, with transitive as the default
- choose the default Alga client portal role for built-in provisioning, defaulting to `User`
- select workflow target/configuration for workflow-managed provisioning
- show last sync/provisioning counts: created, linked, deactivated, skipped, ambiguous

The UI should keep auto-linking separate from provisioning. Auto-linking connects OAuth to an existing user. Provisioning creates portal access.

## Login Flow

1. User reaches client portal sign-in with known tenant context.
2. User enters email.
3. `SsoProviderButtons` calls client portal discovery.
4. Discovery resolves tenant context and returns configured providers.
5. User chooses a provider.
6. Resolve validates tenant, provider, callback, and signed discovery context.
7. OAuth starts with client-portal login state.
8. OAuth callback maps the provider identity to an active client user in the tenant.
9. Account link is created or reused according to `autoLinkClient`.
10. The user lands on the correct canonical or vanity client portal URL.

## Failure Behavior

- Unknown tenant context: SSO providers are unavailable.
- Provider not configured: provider is not returned by discovery.
- No matching client user: generic auth failure, with no user enumeration.
- Matching internal user only: access denied for client portal.
- Inactive client user: access denied.
- Entitlement removed after provisioning: Entra-managed portal user is inactive and cannot log in.

## Testing

Behavioral tests should cover:

- client portal discovery returns no providers without tenant context
- discovery returns configured providers with tenant context
- resolve rejects provider, callback, and tenant mismatches generically
- OAuth profile mapping requires client user type and tenant match
- OAuth client user redirects through vanity handoff where applicable
- Entra sync creates or links contacts but skips portal users when entitlement is missing
- built-in Entra sync provisions portal users and OAuth links when group membership is present
- workflow-managed Entra sync emits idempotent workflow events and does not directly mutate portal users
- entitlement removal deactivates only Entra-managed portal users
- manually created portal users are not deactivated by Entra entitlement loss

Existing guard tests that assert client portal SSO is disabled should be replaced with behavior tests proving the new tenant-gated behavior.

## Open Implementation Notes

- The repo currently has `SsoProviderButtons` hard-coded to MSP SSO endpoints and the MSP localStorage key. Prefer making it context-aware rather than forking visual UI.
- Use separate client portal SSO cookie names or an explicit audience field to prevent cross-surface cookie reuse.
- The Entra provisioning implementation needs durable metadata to distinguish Entra-managed portal users from manually managed portal users.
- The worktree git metadata was unavailable while this design was written, so commit creation may require repairing the worktree reference first.
