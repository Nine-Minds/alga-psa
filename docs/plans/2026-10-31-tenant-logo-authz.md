# Tenant logo mutations: authorize on settings:update, not on user_type

Date: 2026-10-31 · Card: Security: authz in uploadTenantLogo · Finding: security review of PR #3993

## The finding, confirmed

`uploadTenantLogo` (packages/tenancy/src/actions/tenant-actions/tenantLogoActions.ts:169) gates on
`user.user_type !== 'internal'` and nothing else, then uploads an image and rewrites the tenant's
branding settings (:192-213). The same user-type-only gate guards `recropTenantLogo` (:234), `deleteTenantLogo`
(:297) and `linkDocumentAsTenantLogo` (:393). Any internal principal — including a technician whose role
carries no settings authority — can replace, recrop, relink or delete the tenant's publicly served branding.

The intended boundary already exists next door: every tenant-settings write requires `settings:update`
(tenantSettingsActions.ts:153-162), and the email-branding actions apply exactly that gate
(notifications/.../emailBrandingActions.ts:51, `requireSettingsUpdate`).

## Decision

Reuse the established gate rather than inventing a second one. Add one module-local helper in
`tenantLogoActions.ts`:

    async function requireTenantLogoWrite(user, knex): Promise<string | null>   // null = allowed

which returns a permission failure when `!(await hasPermission(user, 'settings', 'update', knex))`.
`hasPermission` is already exported from `@alga-psa/auth`; `knex` is `await getConnection(tenant)`, the same
connection the action already opens.

Call it as the FIRST statement of each of the four mutators, before `uploadEntityImage`, `deleteEntityImage`,
`linkEntityImageFromDocument`, `recropEntityLogo` and before any `writeBrandingLogoUrl` / tenant_settings write.
These actions return `{ success: false, error }` rather than throwing, so the helper returns the failure shape
(`'Permission denied: Cannot update settings'`) and each action returns it unchanged — the UI contract is
preserved and the check cannot be bypassed by a caller that ignores the result, because nothing is written.

Keep the `user_type === 'internal'` check as a cheap prefilter, but it is no longer the authorization: it is
belt-and-braces in front of the permission check, not the thing that decides.

## Tenant identity

All four actions take a caller-supplied `tenantId` and also receive the authenticated `tenant` from
`AuthContext`. Use the authenticated `tenant` for every storage call, DB write and branding update, and reject
a `tenantId` that does not equal it (return the same permission failure). Callers in-tree pass the context
tenant, so behaviour is unchanged for them; a caller that is confused about which tenant it is writing to can
no longer reach another tenant's branding. Grep call sites before landing: any site that relies on passing a
different id needs to stop doing so, not be special-cased.

## Tests

1. `packages/tenancy/src/actions/tenant-actions/tenantLogoAuthz.test.ts` (behavioural, new): the helper denies
   an internal user without `settings:update`, allows one with it; and for each of the four mutators, the
   source calls the guard before the first storage call (mirrors the `emailBrandingActionsTenantScoped.contract.test.ts`
   style already in the repo). This test must fail against today's code and pass after the fix.
2. Extend the existing `tenantBrandingTenantScoped.contract.test.ts` with an assertion that no logo mutator
   writes branding without the guard.

## Deliberately not doing

- Not gating `getTenantLogoInfoAction` (:348): it reads branding the browser already shows.
- No RBAC catalog change — `settings:update` already exists and already guards the adjacent surfaces.
- No schema, no migration, no UI change.

## Risks

- A permission failure must not be swallowed by the surrounding `catch` that turns everything into
  'Failed to upload logo'; return the permission result before the try-block body runs.
- The portal (client) surface never calls these actions; if any caller does, it must be routed through an
  admin-authorized server action rather than a broader grant.
