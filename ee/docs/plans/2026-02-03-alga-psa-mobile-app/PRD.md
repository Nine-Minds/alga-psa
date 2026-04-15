# PRD — Alga PSA Mobile App (React Native) - Ticketing MVP + SSO

- Slug: `alga-psa-mobile-app`
- Date: `2026-02-03`
- Status: Draft

## Summary

Design and deliver a first-party Alga PSA mobile application for iOS and Android (React Native) focused on “always-connected” ticket triage and ticket updates for technicians and service desk staff.

This plan includes both:
- A new React Native app (mobile UX, auth, API client, ticketing screens).
- Required Alga PSA server updates to enable secure native SSO (Microsoft + Google) and token-based API access appropriate for mobile clients.

## Problem

Alga PSA’s web app supports ticket management, but many ticket workflows occur away from a desk (field techs, on-call, managers). Mobile users need quick access to their ticket queue, the ability to read a ticket, and to post updates (comments, status changes) immediately.

Today’s authentication flow is optimized for browsers (web login + SSO). A native app requires:
- Native-friendly SSO (system browser, redirect/deep link, PKCE).
- Secure, scoped API access tokens (and refresh) usable with REST APIs.

## Goals

### Product goals
- Enable users to sign in to Alga PSA on mobile using the same identity options as the web login (Microsoft + Google SSO where configured).
- Provide fast, reliable access to ticket lists with filtering and sorting that match common web use cases.
- Enable core ticket actions: view ticket details, add comments/notes, and change status.
- Include a small set of “business critical” updates that reduce back-and-forth and enable closing tickets from the field.

### Engineering goals
- Keep mobile clients “thin”: rely on existing REST APIs where possible; add/extend server APIs only when needed.
- Implement secure mobile auth patterns (Authorization Code + PKCE, refresh tokens, secure storage).
- Establish a mobile-ready API contract for ticket list + ticket detail + ticket updates (versioning, pagination, filtering).

## Non-goals

For the first release covered by this plan:
- Offline-first experiences (the app is always-connected; limited local caching for performance is OK).
- Full parity with the web UI across all PSA modules (projects, invoicing, CRM, etc.).
- Full ticket creation flow (can be considered later; not required for “open existing ticket” + updates MVP).
- Admin configuration (SSO provider configuration remains in the web/admin for now).
- Push notifications (assignment/status/mention) and in-app notification inbox (Phase 2).
- Self-hosted / on-prem support (Phase 2; architecture should not preclude it).

## Users and Primary Flows

### Personas
- Technician / Agent: works tickets throughout the day; needs “my queue”, quick updates, and status changes.
- Service Desk Lead / Manager: scans queues, reassigns/triages, monitors priority/SLA signals.

### Primary flows (MVP)
1. Sign in via SSO (Microsoft/Google) or existing supported auth fallback (if SSO not configured).
2. Land on ticket list (default view: “My tickets” and/or selected queue/board).
3. Filter/sort/search tickets.
4. Open a ticket to view detail, conversation, and key fields.
5. Add a comment/note; optionally choose public vs internal (if supported).
6. Change status; optionally set “assigned to me” or other critical fields.

## UX / UI Notes

### Platform
- Single codebase (React Native) for iOS + Android.
- Use system browser for SSO (no embedded webview for credential entry).
- V1 assumes Alga hosted environments; the app should be designed so self-hosted base URLs can be added later without rewriting auth.

### Navigation (baseline)
- Bottom tabs: Tickets, Search (optional), Notifications (optional), Settings.
- Tickets: list → detail → actions (comment, status, update fields).

### Ticket list
- Fast scrolling list with clearly visible: status, priority, subject, company/contact, assignee, updated-at.
- Quick filters: My tickets, Unassigned, High priority, Needs response, Recently updated.

### Ticket detail
- Header with key metadata and quick actions (comment, status).
- Sections: Summary, Requester/Company, Status/Priority/Assignee, SLA/Due (if available), Description, Conversation/Notes, Related (optional).

## Requirements

### Functional Requirements

#### Mobile app
- SSO login (Microsoft + Google) and session persistence.
- Ticket list: pagination, pull-to-refresh, server-side filtering/sorting, search.
- Ticket detail: read-only view of all relevant fields and timeline/comments.
- Ticket updates: add comment/note; change status.
- Business-critical updates (initial set proposed; confirm):
  - Assign/unassign (assign to self).
  - Set priority.
  - Set due date / next response due (if supported).
  - Add watchers/subscribers (if supported).
  - Add time entry (if time tracking is core to your PSA workflows).
  - Add attachments to a comment (optional, can be Phase 2 if complexity is high).
- Comments must support internal vs public visibility.

#### Alga PSA server
- Support native/mobile SSO flows using the same Microsoft/Google provider configurations as web.
- Provide mobile-friendly token issuance (short-lived access token + refresh token) for REST API usage.
- Provide token revocation/logout and rotation protections suitable for mobile clients.
- Ensure REST endpoints used by mobile are stable, versionable, and permission-checked equivalently to web.

### Non-functional Requirements

- Performance: ticket list and ticket detail should feel responsive on cellular networks (optimize payloads; use pagination).
- Reliability: robust retry/backoff for transient network failures; clear error messages for auth/permission errors.
- Security: tokens stored in OS secure storage; prevent token leakage via logs; support remote session invalidation.
- Accessibility: WCAG-aligned mobile accessibility (dynamic type, screen reader labels, touch targets).
- Observability: error reporting, login funnel metrics, API latency metrics, and basic mobile analytics.

## Data / API / Integrations

### Authentication & SSO (proposed)
- Use Alga’s existing web login + SSO providers in the system browser.
- After successful login, Alga issues a short-lived, single-use handoff token (OTT) that is returned to the app via deep link.
- The mobile app exchanges the OTT for a short-lived mobile API credential (and refresh/rotation mechanism) usable with REST APIs.
- Token scopes/claims reflect tenant, user, permissions, and (optionally) selected workspace/queue context.

### REST API usage
- Ticket list endpoint(s) must support: pagination, sorting, filtering (assignee, status, priority, queue/board, updated range), and free-text search (subject/id).
- Ticket detail endpoint must include: core fields + comments/timeline (or separate endpoints with cursor pagination for comments).
- Ticket update endpoints: add comment/note, change status, and critical field updates.

### Compatibility
- V1 targets Alga hosted deployments only.
- Self-hosted/on-prem should be supported in a later phase (not a V1 requirement), so auth and callback URLs must be designed to accommodate multiple base domains without major refactors.

## Security / Permissions

- Mobile app must not bypass web permission checks; all data fetched via authenticated REST endpoints with server-side enforcement.
- Implement refresh token rotation and revoke-on-suspicion patterns.
- Support logout that invalidates refresh tokens server-side.
- Device security: store secrets in Keychain/Keystore; support biometric unlock to open the app (optional).
- Protect PII: optional “hide sensitive fields in notifications” setting.

## Observability

- Client-side: crash reporting, JS error reporting, network error rates, screen load timing.
- Server-side: auth flow telemetry (success/failure by provider), token mint/refresh rates, API endpoint latency by route, 401/403 breakdown for mobile user agents.

## Rollout / Migration

- Server changes ship behind configuration flags (enable mobile auth + register mobile OAuth clients per tenant/environment).
- Mobile app internal beta (TestFlight / Play Store internal testing) → limited external beta → GA.
- Document required configuration: provider app registrations (redirect URIs), allowed origins/domains, and API base URL per environment.

## Open Questions

1. Do we need a non-SSO fallback login method for mobile (credentials/magic link), or require SSO-enabled tenants only for V1?
2. What are the canonical “ticket statuses” and allowed transitions we must support on mobile (and how to fetch them)?
3. What is the minimal ticket “list DTO” and “detail DTO” for mobile to keep payloads small?
4. Do we need audit trail markers like “updated from mobile” in ticket timeline?
5. Should the app support multiple Alga hosted domains (vanity domains) for enterprise customers in V1?

## Acceptance Criteria (Definition of Done)

- A user can authenticate on iOS and Android using Microsoft/Google SSO where configured, and obtain a usable API session without re-login on app restart (until logout/expiry).
- A user can view ticket lists with pagination and common filters; list state is preserved when navigating back from a ticket.
- A user can open a ticket and view key fields and a comment/timeline history.
- A user can add a comment/note and change ticket status; updates reflect in the UI after server confirmation.
- The server provides secure mobile token issuance/refresh and enforces permissions for all mobile API calls.
- Basic observability exists for auth failures, API errors, and app crashes.
