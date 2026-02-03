# Support Escalation Runbook — Mobile Auth Issues

Date: `2026-02-03`

## Symptoms

- User can’t sign in (Sign In disabled / blocked)
- User returns from browser but app shows error (callback rejected)
- Login loop / frequent re-auth
- Session refresh fails / user is logged out unexpectedly

## Quick triage checklist

1) Confirm the user is on an Alga-hosted environment and using the correct base URL.
2) Confirm mobile auth is enabled for the environment:
   - Check `/api/v1/mobile/auth/capabilities` for `mobileEnabled=true`.
3) Confirm the base URL host is allowlisted (if allowlist enabled).
4) Confirm the tenant has at least one SSO provider configured (Microsoft/Google).

## Common failure modes

### “Mobile sign-in disabled”

- Cause: mobile auth disabled server-side.
- Fix: enable mobile auth configuration; redeploy or toggle per environment.

### “Host not allowlisted”

- Cause: mobile base URL host doesn’t match `hostedDomainAllowlist`.
- Fix: update allowlist, or correct mobile `EXPO_PUBLIC_ALGA_BASE_URL`.

### Callback “state mismatch” / “missing params”

- Cause: deep link was not the expected callback URL or `state` was lost.
- Fix:
  - Ensure app scheme is correct (`alga://`).
  - Ensure the sign-in flow uses `/auth/mobile/handoff` with `state`.

### OTT exchange fails (400/401/429)

- 400 validation: incorrect payload; confirm mobile app version aligns with server contract.
- 401 auth: OTT expired or already used; check `ALGA_MOBILE_OTT_TTL_SEC` and user retry timing.
- 429: rate limiting; verify if user is repeatedly triggering sign-in.

### Refresh fails / session revoked

- Cause: refresh token rotated/revoked; user logged out.
- Fix:
  - Verify refresh rotation tables/migrations are applied.
  - Inspect audit log entries for refresh/revoke.

## Data to collect for escalation

- Approximate timestamp (UTC) of the failure.
- Tenant id (from Settings → Account).
- Mobile app build/version (Settings → Diagnostics).
- Platform (iOS/Android) and device model/OS version.
- Correlation id(s) from server logs (`x-correlation-id`) around the failure.
- Server audit log events for mobile auth:
  - OTT issued/exchanged
  - Refresh succeeded/failed
  - Revoke/logout

