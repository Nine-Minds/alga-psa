# Manual QA Checklist — Mobile Ticketing MVP

Date: `2026-02-03`  
Scope: React Native mobile app + mobile auth endpoints (Alga-hosted)

This checklist is used to validate MVP behavior end-to-end in a real device/simulator environment.

## Auth

- [ ] Sign in opens system browser to hosted login.
- [ ] Deep link callback returns to app and completes OTT exchange.
- [ ] Session persists across app restart.
- [ ] Refresh rotates credentials before expiry; revoked sessions force sign-in.
- [ ] Logout revokes session server-side and clears local storage.
- [ ] Capability discovery gates sign-in when mobile auth disabled or host not allowlisted.

## Tickets — List

- [ ] Initial load returns paginated list; infinite scroll loads next pages.
- [ ] Pull-to-refresh reloads page 1 and replaces results.
- [ ] Rows show ticket number, title, status, priority, assignee, client, and updated-at.
- [ ] Status/priority badges are readable with sufficient contrast.
- [ ] Default sorting is updated-at descending; sort selector changes server-side sort.
- [ ] Search debounces input and queries server-side.
- [ ] Filters (status, assignee, priority, updated-since) apply server-side and can be combined.
- [ ] Quick filters (My tickets, Unassigned, High priority, Recently updated) work.
- [ ] Active filters summary/chip bar reflects current filters; “Clear all” resets.
- [ ] Filters persist per user across app restarts.
- [ ] Empty, offline, and error states are clear with retry behavior.
- [ ] Prefetch of first ticket details improves navigation responsiveness.
- [ ] Ticket stats header loads and matches expected counts (if enabled).
- [ ] 403/no-access and RBAC restrictions show appropriate UX (no data leakage).

## Tickets — Detail

- [ ] Ticket header shows number/title/status/priority/assignee.
- [ ] Requester/contact and client/company fields render.
- [ ] Created/updated/closed timestamps display with relative + absolute formatting.
- [ ] Description renders safely; external links require confirmation.
- [ ] Comments/timeline loads with pagination (“Load more”) and entries are ordered.
- [ ] Internal vs public comments are clearly labeled.
- [ ] Copy ticket id/number works; “Open in web” opens correct hosted URL.
- [ ] 403/404 states are friendly and do not leak data.

## Ticket updates

- [ ] Add comment supports internal/public visibility; drafts persist per ticket and clear on success.
- [ ] Comment length validation prevents oversize posts; errors are actionable.
- [ ] Status change picker loads statuses; optimistic update rolls back on failure; 409 conflict prompt works.
- [ ] Assignment (assign-to-me/unassign), priority, due date, watch toggle, and time entry flows work as expected.
- [ ] Mutations include audit headers (device/app metadata) and respect RBAC (403) and validation errors (400/422).
- [ ] Offline prevents sending updates (draft preserved).

## Settings

- [ ] Diagnostics show app version/build, platform, env, and base URL.
- [ ] Account section shows signed-in status, user, and tenant id.
- [ ] Clear cache clears in-memory caches and prompts confirmation.
- [ ] About/Legal opens and link-outs to privacy/terms work.

