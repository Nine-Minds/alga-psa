# Mobile App Privacy Review Checklist + PII Inventory

Scope: `docs/plans/2026-02-03-alga-psa-mobile-app` (Ticketing MVP + SSO), always-connected React Native app in `mobile/`.

Last updated: 2026-02-03

## Goals

- Enumerate what data the mobile app stores, transmits, and potentially exposes.
- Provide a checklist to run before any external beta/GA.
- Serve as an inventory for future DPIA/PIA and security review.

## Definitions

- **Secret**: access token, refresh token, OTT, auth `state`, device identifiers used for session binding.
- **PII**: user identity, customer contact names/emails/phones, ticket subjects and comment bodies.
- **Sensitive business data**: ticket contents (subjects, descriptions, internal notes), client names, SLA/due dates.

## Data Stored On Device (Local)

### Secure storage (`expo-secure-store`)

- Mobile session (`accessToken`, `refreshToken` or equivalent), tenant id, user identity snapshot used by UI.
- Pending auth state (`state`) and one-time-token (`ott`) during login handoff.
- Per-user ticket list filters (`alga.mobile.tickets.filters.{userId}`).
- Per-ticket comment drafts (keyed by ticket id).
- Settings toggles: biometric gate enabled, hide-sensitive-notifications enabled.
- Stable device id (used only as an audit/telemetry identifier).

### In-memory only

- Ticket list results, ticket detail cache (TTL) and comments list cache (TTL).
- Transient errors, network state.

## Data Transmitted Off Device (Network)

### Authentication

- System browser opens `GET {BASE_URL}/auth/signin` (Microsoft/Google SSO handled on the server).
- Deep link callback to app includes `state` + `ott` in URL query (must be treated as secrets).
- App exchanges OTT for mobile credential via `POST /api/v1/mobile/auth/exchange` (server-side).
- Refresh/revoke via `POST /api/v1/mobile/auth/refresh` and `POST /api/v1/mobile/auth/revoke`.

### Ticketing APIs (read)

- `GET /api/v1/tickets` (list/search/filter) – includes ticket metadata; mobile requests a slim field set.
- `GET /api/v1/tickets/stats` – aggregate counts only.
- `GET /api/v1/tickets/:id` – includes ticket fields and attributes.
- `GET /api/v1/tickets/:id/comments` – includes comment text, visibility, author display name, timestamps.
- `GET /api/v1/tickets/statuses` / `GET /api/v1/tickets/priorities` – reference data.

### Ticketing APIs (write)

- `POST /api/v1/tickets/:id/comments` – transmits comment body and visibility (`is_internal`).
- `PUT /api/v1/tickets/:id/status` – status id.
- `PUT /api/v1/tickets/:id/assignment` – `assigned_to` (nullable).
- `PUT /api/v1/tickets/:id` – partial updates used for priority, due date, watchers.
- `POST /api/v1/time-entries` – duration/notes and ticket association.

### Headers and metadata

- `x-api-key` carries the mobile session access token (treat as secret).
- `x-tenant-id` identifies tenant context.
- Mobile audit headers include platform/app version/build and a stable device id.

## Logging / Error Reporting

- Logger redacts known secret keys (tokens, `ott`, `state`) before printing.
- Crash reporting scaffold exists; provider TBD; must avoid sending request/response bodies by default.

## UI/UX Exposure Risks

- Ticket subjects and comment bodies may be visible on-screen; ensure:
  - no screenshots are included in crash reports by default
  - any future push notifications obey “Hide sensitive notifications”
- Clipboard actions copy ticket id/number only (avoid copying ticket subject/body by default).

## Privacy Review Checklist (Pre-release)

### Authentication & secrets

- [ ] Tokens stored only in secure storage (Keychain/Keystore); never logged.
- [ ] Deep link handler rejects unexpected schemes/paths; `ott` + `state` not stored in plain storage.
- [ ] Logout revokes server-side refresh token/session and clears local secret material.
- [ ] Refresh token rotation verified (server-side) and failures handled safely.

### Data minimization

- [ ] Ticket list uses slim DTOs/field selection.
- [ ] Ticket detail payload reviewed; remove unused fields where possible.
- [ ] Avoid transmitting full error objects that include payloads.

### Observability

- [ ] Analytics opt-out honored; no PII in event properties.
- [ ] Crash reporting excludes request/response bodies by default.
- [ ] Logging redaction rules cover tokens, `ott`/`state`, and ticket/comment content.

### UX controls

- [ ] “Hide sensitive notifications” setting documented and defaults validated.
- [ ] Biometric gate does not block logout/session expiry flows.

### Compliance/Docs

- [ ] Privacy policy / terms reachable from Settings.
- [ ] Data retention and deletion behavior documented (server-side).

