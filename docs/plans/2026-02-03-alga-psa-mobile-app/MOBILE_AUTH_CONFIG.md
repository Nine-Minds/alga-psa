# Server Mobile Auth Configuration (Hosted)

Last updated: 2026-02-03

This document describes how to enable and configure the server-side “web login → mobile handoff” flow for the Alga PSA mobile app.

## Overview

Mobile login reuses the existing web sign-in (`/auth/signin`) and SSO providers. After successful login, the browser is redirected to `/auth/mobile/handoff`, which issues a one-time token (OTT) and redirects back into the app via deep link.

## Endpoints

- Browser handoff:
  - `GET /auth/mobile/handoff?redirect={deepLink}&state={state}`
- Mobile API:
  - `GET /api/v1/mobile/auth/capabilities`
  - `POST /api/v1/mobile/auth/exchange`
  - `POST /api/v1/mobile/auth/refresh`
  - `POST /api/v1/mobile/auth/revoke`

## Environment Variables

### Enablement

- `ALGA_MOBILE_AUTH_ENABLED=true|false`

### Token TTLs (seconds)

- `ALGA_MOBILE_OTT_TTL_SEC` (default: `60`)
- `ALGA_MOBILE_ACCESS_TTL_SEC` (default: `900` / 15 minutes)
- `ALGA_MOBILE_REFRESH_TTL_SEC` (default: `2592000` / 30 days)

### Hosted domain allowlist

- `ALGA_MOBILE_HOST_ALLOWLIST`
  - Comma-separated hostnames, e.g. `app.alga.example,staging.alga.example`
  - Returned by the capabilities endpoint and enforced by the mobile client before opening sign-in.

## Deep Link Redirect Validation

`/auth/mobile/handoff` only redirects to:

- Schemes: `alga://`, `exp://` (Expo Go), or `https://` (dev convenience)
- Paths matching the mobile callback route (`/auth/callback`)

If validation fails, the handoff redirects back to `/auth/signin?error=invalid_redirect`.

## Database

Migration: `server/migrations/20260203210000_add_mobile_auth_tables.cjs`

- `mobile_auth_otts`
  - hashed token storage, TTL, and single-use (`used_at`)
- `mobile_refresh_tokens`
  - hashed refresh token storage and rotation (`replaced_by_id`)

