# Mobile App Access on an Appliance

Mobile sign-in is an EE feature: CE (open-source) builds reject the mobile token
exchange and report `enabled: false` from the capabilities endpoint, so the app refuses
to save a CE host. The appliance runs the EE image, where access is governed by the
license tier (`MOBILE_ACCESS`).

The published AlgaPSA mobile app (App Store / Google Play) can connect to any appliance:
the user opens **Change server** on the sign-in screen (or scans the **Connect this
server** QR on the MSP dashboard's mobile-app card) and the app validates the host via
`GET /api/v1/mobile/auth/capabilities` before saving it. Sign-in then runs the standard
web handoff (`/auth/mobile/handoff`) against the appliance.

## Operator configuration

- `NEXTAUTH_URL` — the appliance's public URL (same value as the setup page's App URL).
  Drives the handoff redirect and OAuth callbacks; mobile sign-in fails without it.
- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` and/or
  `MICROSOFT_OAUTH_CLIENT_ID` / `MICROSOFT_OAUTH_CLIENT_SECRET` — at least one SSO
  provider must be configured; the capabilities endpoint only advertises providers whose
  credentials resolve, and the app shows "SSO is not configured" otherwise. Native Apple
  sign-in works only against Alga Cloud.
- `ALGA_MOBILE_HOST_ALLOWLIST` — optional, comma-separated hostnames permitted for
  mobile sign-in. Leave empty to allow the appliance host; if set, it must include the
  appliance's own hostname or the app blocks sign-in with "domain not allowed".

The dashboard's connect QR encodes `alga://server?url=<this server's origin>` and only
renders on self-host installs (`isSelfHostLicensing()`); Alga Cloud hides it because the
published app already defaults to that host.
