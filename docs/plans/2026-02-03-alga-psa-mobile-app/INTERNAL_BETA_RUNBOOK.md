# Internal Beta Distribution Runbook

Date: `2026-02-03`  
Audience: Engineering / Release owners

## Preconditions

- Mobile app configured (`mobile/app.json`, `mobile/eas.json`).
- Expo/EAS access:
  - Repository secret: `EXPO_TOKEN` (for CI distribution)
  - Correct Apple/Google store credentials configured in EAS (outside this repo)
- Mobile auth enabled on the target hosted environment (see `MOBILE_AUTH_CONFIG.md`).

## Build + distribute (recommended: GitHub Actions)

Workflow: `.github/workflows/mobile-distribute.yml`

1) Trigger workflow manually (select branch + platform profile).
2) Verify build completes and artifacts are available in EAS.
3) For iOS: confirm TestFlight processing completes and testers can install.
4) For Android: confirm Internal Testing track has the new build and testers can install.

## Manual fallback (local)

From `mobile/`:

1) `npm ci`
2) `npx eas login`
3) Build:
   - iOS: `npx eas build -p ios --profile testflight`
   - Android: `npx eas build -p android --profile playInternal`
4) Submit (if configured):
   - iOS: `npx eas submit -p ios --profile testflight`
   - Android: `npx eas submit -p android --profile playInternal`

## Smoke checklist

- Sign in via web SSO → deep link back → lands on Tickets list.
- Ticket list loads + search works.
- Open ticket → post internal comment → shows as internal.
- Change status → reflected in header and list.
- Logout revokes session and returns to Sign In.

