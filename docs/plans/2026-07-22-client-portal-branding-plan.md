# Client Portal Branding — Password-Reset Flow Fix

**Date:** 2026-07-22
**Branch:** `fix/client-portal-branding`
**Status:** Approved design, ready for implementation

## Problem

Peet identified three places where the branded client-portal experience breaks down:

1. The **"Forgot password" link** on the client-portal sign-in page uses Alga PSA's default color instead of the portal theme color.
2. The **password-reset pages** do not display the client's portal branding (logo, colors).
3. **"Back to login"** from the reset flow sends the user to a separate unbranded login experience.

## Root causes (from code exploration)

- **Issue 1:** `ClientLoginForm.tsx` (~L190-198) styles the link with `text-[rgb(var(--color-primary-500))]`. That CSS variable is only overridden when `#server-tenant-branding-styles` is injected, which today happens only in `server/src/app/layout.tsx` keyed off the **request host**. Middleware redirects vanity hosts to the canonical host (adding `?portalDomain=<host>`), so on the canonical host the root-layout lookup finds nothing and the default Alga purple shows. `ClientPortalSignIn` only injects a client-side override for the sign-in *button*, not the link.
- **Issue 2:** The reset-flow pages — `auth/client-portal/forgot-password`, `auth/check-email`, `auth/password-reset/set-new-password`, `auth/password-reset/confirmation` — are self-contained components with hardcoded gradients and the Alga avatar (`/images/avatar-purple-background.png`). None receive branding, and most aren't even under a path the root layout considers for injection.
- **Issue 3:** All "back"/"sign in" links in those pages hardcode `/auth/client-portal/signin` with no `portalDomain` passthrough, and the emailed reset link (`recoverPassword` in `packages/auth/src/actions/useRegister.tsx` ~L164) is built from `NEXT_PUBLIC_BASE_URL` with only `?token=...&portal=client` — so the flow abandons portal context at the first step.

## Approved design decisions

- **Scope:** only the reported spots — the password-reset flow (all four screens, so branding doesn't flicker mid-flow), the forgot-password link color, and back-to-login destinations. MSP flows untouched.
- **Portal context carrier:** the existing `portalDomain` query param (the middleware convention), threaded through the whole chain. No token-based branding lookup, no `tenant` slug threading, no `callbackUrl` threading (sign-in's existing default `/client-portal/dashboard` applies).
- **Email link:** stays on the canonical host (`NEXT_PUBLIC_BASE_URL`), gains `&portalDomain=<host>`. No middleware changes.
- **Branding mechanism:** thin server-component shells using the existing `getTenantBrandingByDomain()` + `generateBrandingStyles()` — the same pattern `/auth/client-portal/signin` already uses. SSR, cached (300s `unstable_cache`), no branding flash.
- **Fallback:** absent or unresolvable `portalDomain` → `null` branding → pages render exactly as today (standard Alga branding).

## Data flow

1. `/auth/client-portal/signin?portalDomain=X` — fetches branding (existing) **and** now injects `#server-tenant-branding-styles` server-side when branding was resolved via `portalDomain`. The forgot-password link's `--color-primary-500` is finally overridden → **Issue 1 fixed** with no change to the link's styling code.
2. Sign-in passes `portalDomain` down: `ClientPortalSignIn` → `ClientLoginForm` → link href becomes `/auth/client-portal/forgot-password?portalDomain=X`.
3. Forgot-password page (new server shell) brands itself, passes `portalDomain` into `recoverPassword(email, 'client', portalDomain)`, and redirects to `/auth/check-email?...&portalDomain=X`.
4. `recoverPassword` appends `&portalDomain=X` to the emailed reset link.
5. Set-new-password page brands from the param; success redirect to confirmation preserves it; "Sign in instead" → `/auth/client-portal/signin?portalDomain=X`.
6. Confirmation page branded; sign-in button carries `portalDomain` → user lands on the branded sign-in → **Issues 2 and 3 fixed**.

## Implementation steps

### 1. Shared helper (the tiny missing layer)

Create `server/src/lib/auth/portalBranding.ts`:

- `getPortalBranding(searchParams): Promise<TenantBranding | null>` — reads `portalDomain` from search params; absent/empty → `null`; otherwise `getTenantBrandingByDomain(portalDomain)`.
- `PortalBrandingStyles({ branding })` — server component rendering `<style id="server-tenant-branding-styles">` from `generateBrandingStyles(branding)`; renders nothing when `branding` is null or when injection should be skipped (keep idempotent with root layout — same element ID, first writer wins).

### 2. Fix Issue 1 — sign-in page style injection + link param

- `server/src/app/auth/client-portal/signin/page.tsx`: when branding was resolved via `portalDomain`, render `PortalBrandingStyles`; pass `portalDomain` to `ClientPortalSignIn`.
- `packages/auth/src/components/ClientPortalSignIn.tsx`: accept optional `portalDomain` prop; pass to `ClientLoginForm`.
- `packages/auth/src/components/ClientLoginForm.tsx`: forgot-password `Link` href appends `?portalDomain=<value>` when present.

### 3. Brand the four reset-flow pages

For each page: make `page.tsx` a server component that resolves branding via `getPortalBranding(searchParams)`, renders `PortalBrandingStyles`, and passes `branding` into the existing client UI (moved to a child component file if the current file is `"use client"`). Replace hardcoded logo/gradient/colors with `branding ?? current defaults`:

- `server/src/app/auth/client-portal/forgot-password/page.tsx`
- `server/src/app/auth/check-email/page.tsx`
- `server/src/app/auth/password-reset/set-new-password/page.tsx`
- `server/src/app/auth/password-reset/confirmation/page.tsx` (already a server component — extend only)

### 4. Thread `portalDomain` through the flow

- `packages/auth/src/actions/useRegister.tsx` — `recoverPassword(email, portal, portalDomain?)`: append `&portalDomain=` to `resetLink` when present. Verify the newer `requestPasswordReset` in `passwordResetActions.ts` is not the live path for these pages (exploration suggests its `/auth/reset-password` target page doesn't exist); if it is reachable, thread the param there too.
- Forgot-password page: pass `portalDomain` to `recoverPassword`; redirect to check-email preserving it.
- Check-email page: resend call passes `portalDomain`; "Back to Sign In" href preserves it.
- Set-new-password page: success redirect to confirmation preserves it; "Sign in instead" href → `/auth/client-portal/signin?portalDomain=X` (or MSP signin unchanged when `portal=msp`).
- Confirmation page: sign-in button href preserves it.

### 5. Explicit non-goals

- No middleware changes (canonical-host + param chosen over vanity-domain email links).
- No `tenant` slug or `callbackUrl` threading.
- No branding lookup from the reset token.
- MSP auth flow unchanged.

## Error handling & edge cases

- Missing/empty `portalDomain` → `null` branding → current rendering everywhere (covers MSP and direct canonical visits).
- Bogus/unresolvable domain → `getTenantBrandingByDomain` already returns `null` (and skips dev hosts) → same fallback.
- Tampered param exposes only another tenant's *public* sign-in branding — acceptable, no extra validation.
- Partial branding (logo but no colors, etc.) → handled by existing `generateBrandingStyles` defaults, same as sign-in today.
- Expired/invalid token on set-new-password → page still renders branded (branding comes from URL, not token); error state and "Sign in instead" escape remain branded.
- Style-injection idempotency: shared `#server-tenant-branding-styles` element ID prevents double-injection if the root layout already wrote it.

## Testing

1. **Unit tests** (repo's existing runner):
   - `recoverPassword`: reset link includes `&portalDomain=X` when passed; unchanged when not.
   - `getPortalBranding`: branding for valid domain; `null` for missing/unknown domain (mock `getTenantBrandingByDomain`).
   - Link builders: forgot-password href and each back/sign-in href preserve `portalDomain`; omit when absent.
2. **Manual end-to-end on this worktree's dev stack**: tenant with distinct logo/colors + `portal_domains` row; walk sign-in → forgot-password (link color) → check-email → emailed link contains `portalDomain` → set-new-password (also with bogus/expired token) → confirmation → back to branded sign-in. Repeat without `portalDomain` → Alga defaults throughout. Before/after check for each of Peet's three reports.
3. **Regression:** MSP forgot/reset flow still default-branded; client-portal sign-in unchanged; run existing auth package tests.

## Key files (reference)

| File | Role |
|---|---|
| `server/src/app/auth/client-portal/signin/page.tsx` | branded sign-in; `portalDomain` handling ~L84-89 |
| `packages/auth/src/components/ClientPortalSignIn.tsx` | sign-in UI; button-only style injection ~L110-143 |
| `packages/auth/src/components/ClientLoginForm.tsx` | forgot-password link ~L190-198 |
| `packages/auth/src/actions/useRegister.tsx` | `recoverPassword` ~L133-188; reset link ~L164 |
| `packages/tenancy/src/actions/tenant-actions/getTenantBrandingByDomain.ts` | domain → branding lookup (cached) |
| `packages/tenancy/src/lib/generateBrandingStyles.ts` | branding → `:root` CSS overrides |
| `server/src/app/layout.tsx` ~L106-148 | host-keyed style injection (unchanged) |
| `server/src/middleware.ts` ~L295-332 | vanity → canonical redirect (unchanged) |
