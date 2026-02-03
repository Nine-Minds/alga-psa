# Store Screenshots Capture Plan

Date: `2026-02-03`  
Scope: Ticketing MVP (no Phase 2 notifications)

## Goals

- Capture consistent, readable screenshots for App Store and Play Store listings.
- Avoid PII: use a seeded/demo tenant with fake company/contact data.

## Devices / sizes

### iOS (App Store)

- iPhone 6.7" (Pro Max size)
- iPhone 6.1" (standard)

### Android (Play Store)

- Phone 1080×1920 (or equivalent)

## Screens to capture (suggested order)

1) Sign In (SSO via system browser) — emphasize secure sign-in
2) Tickets list (with filters/chips visible)
3) Ticket detail (header + key fields)
4) Comments (internal/public badges visible)
5) Status change (picker / confirmation)
6) Settings (diagnostics + account section)

## Content guidelines

- Use non-sensitive demo data:
  - Ticket titles: generic (“Printer not printing”, “VPN issue”, “Password reset”)
  - Company/contact: placeholders (“Acme Co.”, “Alex Example”)
- Ensure all badges and key text are legible.
- Keep brightness consistent; avoid OS banners in captures.

## Capture workflow (manual)

1) Create a demo user + seed demo tickets in a non-production tenant.
2) Install a build via TestFlight (iOS) / Internal Testing (Android).
3) Navigate to each screen above and capture.
4) Store raw captures in a private release artifact location (do not commit screenshots to this repo).

