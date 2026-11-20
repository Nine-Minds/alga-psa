# PRD — Bind password reset to one tenant's user

- Slug: `password-reset-tenant-binding`
- Date: `2026-11-11`
- Status: Draft
- PSA ticket: `alga-2026-0002632`

## Summary

A password reset must act on exactly one user in exactly one tenant, from the request through the email to the password write. Today the tenant is never decided: every stage looks the user up by email and user type across all tenants and takes whichever row comes back first. When one email is a user in two organizations, the reset email comes from the wrong organization and the new password can be written to the wrong organization's user.

## Problem and findings

Reported on alga-2026-0002632. The same email is a client portal user in two tenants. A reset started at `/auth/client-portal/forgot-password?portalDomain=<tenant A's portal domain>` sent tenant B's reset email.

Code on main (`origin/main` at 88c634d5b5, also live in prod image `alga-psa-ee:ff474b7a`):

- `recoverPassword` (`packages/auth/src/actions/useRegister.tsx`) calls `User.findUserByEmailAndType(email, userType)`, an unscoped `.first()` with no ORDER BY (`packages/db/src/models/user.ts`). The matched row's tenant chooses the email provider, template, branding and locale. `portalDomain` is only passed to `buildPasswordResetLink` to decorate the link.
- The reset JWT (`packages/auth/src/lib/tokenizer.tsx`, `createToken`) carries `email` and `user_type` only. There is no tenant or user id in it.
- `getAccountInfoFromToken` and `setNewPassword` (same file) repeat the unscoped `.first()` lookup from the token's email. The password is then written to that row. Nothing guarantees it is the user the email was sent for, or the user of the portal the reset was started on.
- The MSP path has the same shape: `/auth/msp/forgot-password` calls `recoverPassword(email, 'msp')`, and the EE reactivation route (`ee/server/src/app/api/billing/reactivation-password-reset/route.ts`) does too. An internal user in two organizations is equally ambiguous. PR #3931 already made MSP sign-in refuse this ambiguity; reset was left behind.

Sign-in is already correct. PR #3591 scoped credentials sign-in by the tenant resolved from the portal domain and added `User.findUsersByEmailAndType` (all matches) and `User.findUserByEmailTenantAndType` (one tenant). `resolveTenantFromPortalDomain` in `packages/auth/src/actions/auth.tsx` resolves a host to the tenant that owns an active `portal_domains` row. Reset should stand on the same pieces.

## Goals

1. A reset started on a tenant's portal domain is sent by that tenant and can only change that tenant's user.
2. A reset token names its user: tenant and user id. The set-password page and the password write use the token's subject and nothing else.
3. When no tenant is known and the email matches users in several tenants, nothing is guessed.
4. The public result stays enumeration-safe: same return value and timing class for every outcome.

## Non-goals

- Replacing the JWT reset token with the `password_reset_tokens` table (`PasswordResetService`). Single-use tokens are a separate change.
- Making the reset link origin a tenant custom domain. The existing `// LEVERAGE: friction tenant-link-context` marker in `resetLinkOrigin.ts` stays as is.
- Changing sign-in, login links, or SSO resolution.

## Design

### Reset subject

Introduce one concept, the **reset subject**: `{ tenant, user_id, email, user_type }`. Every stage speaks in subjects.

A small module in `packages/auth/src/lib/passwordReset/` owns the two operations everything else calls:

- `resolveResetSubjects(email, userType, hint)` → `ResetSubject[]`. Request-time resolution.
- `resolveResetSubjectFromToken(token)` → `{ subject, user } | null`. Redemption-time resolution.

`recoverPassword`, `getAccountInfoFromToken` and `setNewPassword` become thin callers. No other code looks a user up for a reset.

### Request-time resolution

`hint` is `{ portalDomain?: string; tenantSlug?: string }`.

1. Load every active user with this email and user type (`User.findUsersByEmailAndType`, dropping `is_inactive`).
2. If the hint resolves to a tenant, keep only that tenant's user. A hint that resolves to a tenant where the email has no user yields no subjects: the request ends with the generic success result and no email. It never falls through to another tenant.
   - `portalDomain` resolves through the existing active-`portal_domains` lookup. Move `resolveTenantFromPortalDomain` out of `auth.tsx` into a shared lib so sign-in and reset call the same function.
   - `tenantSlug` resolves through the tenant-slug helper sign-in already uses (`packages/db/src/lib/tenantSlug.ts`).
   - A hint that resolves to no tenant at all (unknown host, malformed slug) counts as no hint.
3. With no usable hint: one match is the subject. Several matches produce one subject per tenant, and each gets its own reset email, sent by its own tenant, with a token bound to its own user. The requester asked to reset "the account with this email"; each organization answers for its own account and nobody's password changes until a link is used.

Each subject passes the existing gates on its own (`isPasswordResetPermitted`, trusted reset origin). A subject that fails a gate is skipped without affecting the others.

When emails fan out, the client-portal link for each subject carries that tenant's active portal domain as `portalDomain` (if it has one), so the set-password page is branded for the organization that sent it. The email already goes through the tenant's template and provider, so the organization is identifiable.

Apply `checkPasswordResetLimit(email)` once per request, before resolution, as tenant discovery already does. Over the limit returns the same generic success result.

### Token

`createToken` gains optional `tenant` and `user_id` claims, set for reset tokens. `getInfoFromToken` returns them. `IUserRegister`/`TokenResponse` in `@alga-psa/types` gain the two optional fields.

### Redemption

`resolveResetSubjectFromToken`:

- Token with `tenant` and `user_id`: load that user in that tenant (`tenantDb(db, tenant)`), and require the email and user type still match the token and the user is active and interactive. Anything else is an invalid token.
- Token without them (minted before this change; default lifetime 1 hour): accept only when the email and user type match exactly one user across tenants. Ambiguous legacy tokens are refused like an expired token. This branch can be deleted in a later release.

`setNewPassword` writes the password with `User.updatePassword(subject.user_id, subject.tenant, hash)`. `getAccountInfoFromToken` shows the subject's own name.

### Callers and hints

- Client portal forgot-password: already passes `portalDomain`. No UI change.
- MSP forgot-password: a scoped MSP sign-in (`/auth/msp/signin?tenant=<slug>`) links to `/auth/msp/forgot-password?tenant=<slug>`, and the page passes the slug as the hint. The unscoped page sends no hint.
- `recoverPassword(email, portal, portalDomain?)` keeps its signature for existing callers; add the slug through an options form rather than a fourth positional argument, and migrate callers.
- EE reactivation route: no hint. Fan-out applies if the email is internal in several tenants.
- `requestPasswordReset` (deprecated adapter): unchanged, inherits the behaviour.

## Rollout

Complete on merge, no flag. No migration. Tokens already in mailboxes keep working unless they are ambiguous, which is the case that was wrong.

## Risks

- Fan-out sends several emails for one request. Bounded by the number of tenants the email is in and by the per-email rate limit.
- The portal-domain hint comes from the query string. It can only narrow resolution to the tenant that owns that active domain, and only to a user with the requested email, so it grants nothing.
