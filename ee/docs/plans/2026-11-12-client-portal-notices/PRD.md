# PRD — Client Portal Notices

- Slug: `client-portal-notices`
- Date: `2026-11-12`
- Status: Draft

## Summary

MSP users can publish short notices (maintenance windows, outages, holiday hours, known issues) that render as a bar at the top of the client portal for the client users they are aimed at. A notice has a message, a severity, an optional link, an optional schedule, an audience, and a dismissible flag. Several notices can be live at once.

## Problem

Today an MSP has no way to tell clients something inside the portal. The only bar in the portal top bar is a system "page is out of date" banner; the dashboard greeting is a fixed string; branding settings cover only logo and colors. MSPs fall back to email blasts or ticket templates, which miss clients who are already logged in and about to open a ticket for the very thing being announced. The result is duplicate tickets during incidents and clients who never saw the maintenance notice.

## Goals

1. An MSP user with settings access can create, edit, schedule, and delete portal notices from Settings → Client Portal.
2. A notice is shown to the right client users only: all clients, a chosen set of clients, or clients carrying chosen tags.
3. A notice is shown only inside its schedule window; expired notices stop showing without anyone cleaning up.
4. Several notices can be live at once, ordered by severity then recency.
5. Informational notices can be dismissed per user, durably (server-side, across devices); critical notices cannot be dismissed.
6. Notice text is localized: per-locale text with a required default that every locale falls back to.
7. MSP users can see which notices are live, scheduled, or expired, and what each one's audience resolves to, without reading IDs.

## Non-goals

- Email, push, SMS, or any delivery channel other than the portal bar.
- Read receipts or per-recipient delivery tracking.
- Rich text or markdown in the message. Plain text plus one optional link.
- Showing notices anywhere other than the bar under the portal top bar (for example the ticket creation form). The notice model should not preclude it, but v1 does not build it.
- Notices in the MSP-facing app, or REST/MCP/workflow-event surfaces for notices.
- Feature flag, metrics, or audit-log work beyond what the platform gives every settings write.
- Audience criteria other than all / specific clients / client tags.

## Users and Primary Flows

**MSP admin (settings:update)**
1. Settings → Client Portal → Notices. Sees a table of notices with message preview, severity, audience summary, schedule, and status (Live / Scheduled / Expired).
2. Add notice: enter default-locale message, optionally per-locale messages; choose severity (Info / Warning / Critical); optional link URL and label; optional start and end date-times; dismissible toggle (forced off for Critical); audience (All clients / Specific clients / Clients with tags).
3. Save. If live, it appears for the audience on their next portal page load.
4. Edit or delete from the table. Editing the message or audience of a notice clears prior dismissals so it re-appears.
5. Preview: render the bar as a client user would see it, in a chosen locale, before saving.

**Client portal user**
1. Loads any portal page. Live notices for their client render stacked under the top bar, most severe first.
2. Optional link opens in a new tab.
3. Dismissible notice: clicking dismiss hides it for this user, on every device, until the notice is edited.

## UX / UI Notes

- Render with the standard `Alert` component (as `StaleActionBanner` does), severity mapped to the existing info / warning / destructive variants, full width under the top bar, `rounded-none border-x-0`. Do not build a custom banner.
- Notice bar placement: inside `ClientPortalTopBar` below the header row, beside `StaleActionBanner`, so it appears on every portal page and does not shift page content separately.
- Cap visible notices (default 3) with an inline "+N more" disclosure so a pile-up never pushes content off screen.
- Authoring UI uses existing standard components: `DataTable`, `Dialog`, the standard form controls, date-time picker, client picker, and tag picker. All elements need stable `id`s per the UI standards. No raw IDs in tables: audience is shown as client names or tag names.
- Status chip in the table (Live / Scheduled / Expired) is derived, not stored.
- Message hard cap 500 characters per locale; link label cap 60.

## Requirements

### Functional Requirements

- CRUD for notices, tenant-scoped, gated by `settings:update` (write) and `settings:read` (list).
- Notice fields: severity (`info` | `warning` | `critical`), localized content map (required default plus optional locales, each with message and optional link label), optional link URL, optional `starts_at`, optional `ends_at` (must be after `starts_at`), `dismissible`, audience.
- Audience types: `all`; `clients` (explicit client list); `tags` (client tag list; a client matches if it carries any listed tag). Audience resolves at read time against the user's client, never snapshotted.
- A notice is live when `now >= starts_at` (or no start) and `now < ends_at` (or no end).
- Client users receive only live notices whose audience matches their client, excluding ones they dismissed.
- Critical notices are never dismissible regardless of the stored flag.
- Locale resolution: user's resolved portal locale if present in the content map, else the default.
- Link URLs must be `https:` or a same-origin relative path; anything else is rejected at write time and never rendered as a link.
- Message text is rendered as plain text only.

### Non-functional Requirements

- The portal layout must not take a noticeable latency hit: one query for live notices per layout render, joined with the user's dismissals, no N+1.
- New tables are tenant-scoped and, on Citus, distributed on `tenant` colocated with `tenants` using the shared migration helper. Relations enforced in the application, per house style. No `now()` inside CASE/COALESCE.

## Data / API / Integrations

New tables (names indicative):
- `client_portal_notices`: `tenant`, `notice_id`, `severity`, `content` (jsonb: locale → `{ message, linkLabel? }`, `default` key required), `link_url`, `starts_at`, `ends_at`, `dismissible`, `audience_type`, `created_by`, `created_at`, `updated_at`.
- `client_portal_notice_targets`: `tenant`, `notice_id`, `target_type` (`client` | `tag`), `target_id`. Empty for `all`.
- `client_portal_notice_dismissals`: `tenant`, `notice_id`, `user_id`, `dismissed_at`. Unique on (`tenant`, `notice_id`, `user_id`).

Server actions (in the client-portal package, `withAuth`):
- MSP side: list, get, create, update, delete notices; audience-resolution preview (names of matching clients).
- Portal side: `getActiveClientPortalNotices` (user's client resolved from the session user's contact), `dismissClientPortalNotice`.

Tag targeting reuses the existing tag mapping for clients; client selection reuses the existing client picker data source.

## Security / Permissions

- Write and list actions require `settings:update` / `settings:read`; MSP-only (client portal users are refused).
- Portal read action is available to any authenticated client portal user and returns only notices matching that user's own client; the client is derived server-side, never taken from the request.
- All queries tenant-scoped via the tenant DB helper.
- Dismiss only affects the calling user's own row, and only for a notice they could see.
- Message and link label rendered as text, link scheme-validated, links open with `rel="noopener noreferrer"`.

## Observability

Out of scope for v1.

## Rollout / Migration

- Additive migrations only; no backfill. No notices exist until an MSP creates one, so existing portals are unchanged.
- No feature flag.

## Open Questions

1. Should audience also support client type (company vs individual) or contract/billing-plan criteria? Proposed: no for v1.
2. Dismissal on edit: clear all dismissals on any content/audience edit (proposed), or only on message change?
3. Per-locale authoring UX: tabs per enabled portal locale, or a single "Add translation" repeater? Proposed: repeater, default first.
4. Maximum simultaneous notices shown before collapse: 3 proposed.
5. Should the MSP-facing app also get a read-only indicator that a notice is live (for example on the Client Portal settings nav)? Proposed: no.

## Acceptance Criteria (Definition of Done)

- An MSP admin can create a notice aimed at all clients, a set of clients, or tagged clients, and a client user in that audience sees it on every portal page; a client user outside the audience does not.
- A scheduled notice is invisible before `starts_at` and invisible after `ends_at` with no manual action.
- A dismissible notice stays hidden for that user across sessions and devices; other users still see it; editing the notice shows it again.
- A critical notice has no dismiss control.
- A user whose locale has a translation sees it; every other locale sees the default.
- A non-MSP user cannot create, edit, or delete notices; a user without settings access cannot list them.
- Notices from one tenant never appear in another tenant, verified against a migrated schema.
- Javascript-scheme or otherwise invalid links are rejected.
