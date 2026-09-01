# Configurable notification priorities

**Branch:** `feature/notification-priorities`
**Date:** 2026-08-11
**Status:** Design complete; no product or test code implemented
**Source task:** 29.8.46 — Configurable notification priorities (release v1.5)

## Outcome

Give every in-app notification a priority — **high**, **normal**, or **low** —
so the bell stops presenting a weekly digest and an exhausted-AI-credits alert
as fourteen identical blue dots. Priority is configured per notification
subtype in three layers: each subtype ships with a sensible system default,
tenant admins can override it in the existing internal-notification settings
screen, and each user can override it again for themselves in their profile's
notification preferences — the user's choice always wins, because it is their
attention being managed. The resolved priority (user ?? tenant ?? default) is
stamped onto each notification at creation time and then drives three things
in the MSP and client-portal UIs:

1. **Badge counting** — the bell badge counts unread *high* notifications
   only, in the muted attention-red used for the high tier. When no high
   items are unread but normal/low unread exist, the bell shows a subtle
   neutral dot instead of a number.
2. **Panel sections** — the bell dropdown groups by tier: a "Needs attention"
   section pinned on top (high), the normal stream in the middle, and low
   items collapsed behind a "Low priority (n)" expander.
3. **Filtering and visual weight elsewhere** — the full notifications list
   (User Activities and the client-portal activity tab) gains a priority
   filter and a per-row priority indicator while keeping chronological order.
4. **A real "View all" destination** — the bell's "View all notifications"
   deep-links into the User Activities screen's card view with the
   notifications section shown in full: server-paged with numbered
   pagination instead of today's 5-item cap. The deep link (and every
   section's "View All" button) switches the view ephemerally — the user's
   saved Cards/Table default only changes when they use the view switcher
   explicitly.

Mobile push carries the priority as **payload metadata only**: the Expo push
`data` object gains a `priority` field so the mobile app can render and sort
accordingly. Which templates push, and how loudly the OS delivers them, does
not change in this card.

All user-visible changes are gated behind the `release-v1-5-feature` feature
flag. With the flag off, the badge, panel, settings screen, and activities
list look and behave exactly as today. Schema changes, priority stamping, and
push metadata are flag-independent because they are invisible to users.

## Current state (verified in this worktree)

- The in-app system rides on four tables from
  `server/migrations/20251031160000_create_internal_notifications.cjs`:
  `internal_notification_categories` and `internal_notification_subtypes`
  (both global, not tenant-scoped), `internal_notification_templates`
  (global, one row **per language** — unique on `name` + `language_code`,
  FK to subtype), and `internal_notifications` (tenant-scoped instance rows
  with a `type` enum `info|success|warning|error` but no priority).
- Tenant-level overrides for enablement already exist:
  `tenant_internal_notification_category_settings` and
  `tenant_internal_notification_subtype_settings`
  (`server/migrations/20251211120000_add_tenant_notification_settings.cjs`,
  Citus-aware pattern).
- Creation funnels through `createNotificationFromTemplateInternal` in
  `packages/notifications/src/actions/internal-notification-actions/internalNotificationActions.ts`,
  which loads the template, renders it, inserts the instance, broadcasts via
  `packages/notifications/src/realtime/internalNotificationBroadcaster.ts`,
  and runs post-creation hooks (push lives in a hook).
- The bell UI is `packages/notifications/src/components/NotificationBell.tsx`
  → `NotificationDropdown.tsx` → `NotificationItem.tsx`, mounted in
  `server/src/components/layout/Header.tsx` and
  `packages/client-portal/src/components/layout/ClientPortalTopBar.tsx`.
- The "View all" experiences already synthesize a priority **derived from
  `type`** in two duplicated mappers:
  `packages/user-activities/…/activityAggregationActions.ts`
  (error→HIGH, warning→MEDIUM, else LOW) and
  `packages/client-portal/src/actions/client-portal-actions/notificationActivities.ts`.
  This card replaces that derivation with the real stored priority.
- Push is Expo-only: `server/src/lib/pushNotifications/expoPushService.ts`
  (hardcodes Expo `priority: 'high'` for delivery — unrelated to this
  feature and unchanged) behind a template-name allowlist in
  `pushNotificationDispatcher.ts`.
- Tenant admin settings screen:
  `packages/notifications/src/components/settings/InternalNotificationCategories.tsx`
  (per-category/per-subtype enable switches with batch save), mounted at
  `server/src/app/msp/settings/notifications/page.tsx`.
- The bell's "View all notifications" today lands on `/msp/user-activities`
  bare. `UserActivitiesDashboard` renders whichever view mode the
  `activitiesDashboardViewMode` user preference holds (default `table`);
  the card view's `NotificationsSection` fetches, sorts, and slices to a
  hard `limit={5}` with no paging; and every section's "View All" button
  calls `setViewModePreference('table')` — silently rewriting the user's
  saved default as a side effect of navigation.

## Design decisions (settled in the design session)

| Decision | Choice |
| --- | --- |
| Scale | 3 tiers: `high` / `normal` / `low` |
| Attach point | Notification **subtype** (not per-language template rows, not per template name). MSP and client-portal variants of one event share a priority. |
| Configuration | Three layers: system default per subtype → tenant admin override → per-user override; the user's setting always wins |
| Badge | Count unread high only; color escalates when high present; dot (no number) when only normal/low unread |
| Panel | Sections by tier: "Needs attention" (high) pinned top, normal stream, low collapsed behind an expander |
| Full-page lists | Priority filter + per-row indicator, chronological order preserved |
| "View all" flow | Bell deep-links to User Activities card view with the notifications card expanded in place (other sections collapsed below): flat chronological list, numbered server-side pagination, priority filter chips. Ephemeral — no view-mode preference write; all sections' "View All" buttons stop persisting the view mode. |
| Notification card style | Squarer corners (~5px), no colored left rail; soft shadow treatment (high tier adds a muted attention-red ring, low renders dimmed) |
| High-tier visual language | Muted "attention red" (desaturated, no tinted row background) for rails, pills, section header, and badge — attention-worthy, not emergency |
| Mobile push | Priority included as payload metadata; no delivery gating, no OS-priority mapping |
| Email notifications | Out of scope (separate `notification_*` system untouched) |
| Feature flag | `release-v1-5-feature` gates every user-visible change |

### Rejected alternatives

- **Priority per template row or template name.** Template rows are language
  variants (unique on `name` + `language_code`), so a column there duplicates
  the value per locale; keying by template name would need a new
  template-listing settings layer and diverge from how enable/disable
  configuration works (category → subtype). The subtype is the unit admins
  already manage and the unit the tenant-override tables already model.
- **4-tier scale with Critical.** Three tiers cover the observed need
  (badge-worthy / standard / quiet); a fourth tier adds vocabulary without a
  distinct behavior.
- **Priority-gated or OS-mapped push.** The card asks for priority to *reach*
  mobile push; changing which notifications push or how the OS presents them
  is a behavior change with its own risk surface, deferred deliberately.
- **Caller-supplied priority.** `createNotificationFromTemplateInternal` will
  not accept a priority from call sites; it is resolved from configuration
  only. ~40 emit sites already pass ad-hoc `type` values — priority stays
  centrally governed so configuration is authoritative.
- **Admin-locked subtypes.** A per-subtype "enforced" flag letting tenant
  admins pin priorities against user overrides was considered and rejected:
  it adds schema and UI concepts for a policing need nobody has demonstrated,
  and the user is the best judge of their own attention. Revisit only if
  real tenants ask for it.

## Data model

One new migration (Citus-aware, following the
`20251211120000_add_tenant_notification_settings.cjs` pattern):

1. `internal_notification_subtypes.default_priority` — `text NOT NULL
   DEFAULT 'normal'` with `CHECK (default_priority IN
   ('high','normal','low'))`. Global table; plain column add.
2. `tenant_internal_notification_subtype_settings.priority` — nullable
   `text` with the same CHECK. `NULL` means "inherit the system default".
   No new table: this is exactly the existing tenant-override row's job.
3. `user_internal_notification_preferences.priority` — nullable `text` with
   the same CHECK. `NULL` means "inherit tenant/default". Priority is only
   meaningful on subtype-level rows (`subtype_id` set); category-level rows
   (`subtype_id IS NULL`) keep priority `NULL` — the enable/disable
   semantics of category rows are unchanged.
4. `internal_notifications.priority` — `text NOT NULL DEFAULT 'normal'`
   with the same CHECK, on the distributed table.
5. **Seed defaults** (UPDATE by subtype name; everything not listed stays
   `normal`):
   - **High:** `sla-breach`, `sla-escalation`, `rmm-alert-triggered`,
     `payment-overdue`, `system-announcement`, `project-budget-exceeded`
   - **Low:** `opportunity-weekly-digest`, `milestone-completed`,
     `sla-response-met`, `sla-resolution-met`
6. **Backfill existing instance rows** from their subtype's default:
   `UPDATE internal_notifications` joined through
   `internal_notification_templates` on `template_name` (any language row —
   all share the subtype) to `internal_notification_subtypes`. Rows whose
   template name no longer resolves keep the column default `'normal'`.
   Use the tenant-safe batch pattern if the table is large.

`down()` drops the four columns.

A CHECK-constrained text column is preferred over a Postgres enum to match
the tenant-settings migration style and avoid enum-alteration friction later.

## Server changes

- **Types** (`packages/notifications/src/types/internalNotification.ts`):
  add `InternalNotificationPriority = 'high' | 'normal' | 'low'`; add
  `priority` to `InternalNotification`; extend the subtype/preference
  interfaces with `default_priority` and the tenant override. Do **not**
  add priority to `CreateInternalNotificationRequest`.
- **Resolution at creation**: in `createNotificationFromTemplateInternal`,
  resolve `user override ?? tenant override ?? subtype default ?? 'normal'`
  (one joined query alongside the existing subtype/enablement lookup, which
  already touches the user-preference and tenant-setting tables) and stamp
  it on the inserted row. The instance row is per-user, so per-user
  resolution needs no fan-out changes. Verify the broadcaster and the Hocuspocus
  `NotificationExtension.js` mirror pass the new field through to the client
  (they forward the notification object; confirm no field whitelisting).
- **Read actions**: include `priority` in `getNotificationsAction` results;
  extend the unread-count path so the bell can render without a second
  round-trip — return `{ total, high }` (keep the existing action's return
  shape backward-compatible or add a sibling action; prefer extending the
  payload).
- **Settings actions**: extend the internal category/subtype fetch action to
  return `default_priority` plus the tenant's override, and extend the
  subtype settings update path to accept `priority` (nullable = reset to
  default). Same permissions as the existing settings screen. Extend the
  user-preference fetch/update actions the same way so a user can read the
  effective priority (their override, else tenant/default) and set or clear
  their own on subtype rows.
- **Paged notification activities**: extend the notification-activities
  fetch in `packages/user-activities` (and its shared aggregation action)
  to accept offset/limit and return a total count, so the full card view
  can render numbered pagination server-side instead of slicing a
  full fetch client-side.
- **Activities mappers**: replace the two duplicated `type`→priority
  derivations (`activityAggregationActions.ts`,
  `notificationActivities.ts`) with the stored priority
  (`high→ActivityPriority.HIGH`, `normal→MEDIUM`, `low→LOW`), keeping the
  old derivation only as a fallback when `priority` is absent.
- **Push metadata**: in `pushNotificationDispatcher.ts` /
  `expoPushService.ts`, add the notification's priority to the Expo message
  `data` payload. The `TICKET_PUSH_TEMPLATES` allowlist and Expo delivery
  options are unchanged.

## UI changes (all gated on `release-v1-5-feature`)

Use the client-side feature-flag hook per
`server/src/lib/feature-flags/README.md`; with the flag off every component
renders exactly the current markup.

- **`NotificationBell.tsx`** — flag on: badge number = unread high count,
  red styling when > 0; when 0 high but total unread > 0, render a small
  neutral dot instead of the numeric pill. Flag off: total-count badge as
  today.
- **`NotificationDropdown.tsx`** — flag on: three-part list — "Needs
  attention (n)" header + high items pinned on top, normal items below,
  low items collapsed behind a "Low priority (n)" expander (chronological
  within each section; empty sections render nothing). "Mark all read",
  refresh, and footer behavior unchanged and still act on all tiers.
- **`NotificationItem.tsx` / `NotificationDetailView.tsx`** — flag on:
  high rows get a muted attention-red left accent (no tinted background —
  deliberately not emergency styling), low rows render dimmed. The `type` icon logic stays; priority styles the row, type
  styles the icon. Keep UI copy saying "priority" distinct from the ticket
  priority already rendered from `metadata.changes.priority`.
- **`InternalNotificationCategories.tsx`** (tenant admin settings) — flag
  on: add a priority `CustomSelect` (High / Normal / Low) to each subtype
  row showing the effective value, participating in the existing
  dirty-state batch save, with a "reset to default" affordance (shown when
  a tenant override exists). Flag off: switches only, as today.
- **`InternalNotificationPreferences.tsx`** (user profile, MSP and client
  portal) — flag on: add the same priority `CustomSelect` to each subtype
  row showing the effective value, with a "reset" affordance when a personal
  override exists; writes to `user_internal_notification_preferences`. Flag
  off: switches only, as today.
- **User Activities** (`NotificationsSection.tsx`,
  `NotificationSectionFiltersDialog.tsx`, `NotificationCard.tsx`) — flag
  on: priority filter (All / High / Normal / Low) wired to the real stored
  priority, plus a per-row priority indicator. Order stays chronological.
- **"View all" flow** (flag on):
  - The bell footer's "View all notifications" navigates to
    `/msp/user-activities?focus=notifications`.
  - `UserActivitiesDashboard` treats `focus=notifications` as an ephemeral
    view override: render the card view with the notifications card
    **expanded in place** to its full mode and the other dashboard
    sections (Schedule, Tickets, Projects, Workflow Tasks) rendered
    collapsed below it — still present and expandable, so the screen
    stays the familiar dashboard. No call to `setViewModePreference`;
    the Cards/Table switcher remains the only thing that writes the
    saved preference.
  - `NotificationsSection` full mode stays a single flat chronological
    list — deliberately the closest shape to today's section — with
    numbered server-side pagination (product-standard pager), the
    existing Unread/All/Read tabs, and the priority filter chips
    (All / High / Normal / Low). Priority shows on rows as accent, not
    as grouping; the bell panel keeps the tiered layout, this page keeps
    the stream. The dashboard's default card layout keeps the 5-item
    preview.
  - `NotificationCard` is restyled in the same pass: corner radius
    reduced (~5px), the colored left rail removed, cards carried by a
    soft shadow (no border); high-tier cards add a muted attention-red
    ring to the shadow, low-tier cards render dimmed.
  - `handleViewAll` in `UserActivitiesDashboard` stops persisting
    `'table'` for **all** sections — every "View All" switches the view
    ephemerally for the current visit only.
  - Flag off: plain `/msp/user-activities` link, 5-item section, and
    today's persist-on-View-All behavior are preserved.
- **Client portal** (`ClientNotificationsList.tsx` and the bell in
  `ClientPortalTopBar.tsx`) — same panel sectioning and indicators as MSP.
- **i18n**: every new string (section headers, expander, filter labels,
  settings labels, priority names) added to all supported locales
  (en/fr/es/de/nl/it/pl/pt) — translation-quality checks are enforced in CI.

## Testing

- **Unit**: priority resolution (default only / tenant override / user
  override beats tenant / missing subtype → normal); activities mapper
  (stored priority wins, legacy fallback works).
- **Migration**: backfill assigns subtype defaults to existing rows and
  leaves unresolvable template names at `normal`.
- **Action-level integration** (existing patterns): unread counts split by
  tier; settings updates write and clear the tenant and user overrides;
  created notifications carry the stamped, per-user-resolved priority.
- **Component/flag**: bell and dropdown render current markup with the flag
  off and the new sections/badge with the flag on (mock the flag hook);
  dashboard honors `focus=notifications` without writing the view-mode
  preference, and "View All" no longer persists the view mode when the
  flag is on (still does when off).
- Full click-through happens in the card's later Smoke Test step (dev
  server on port 3729; `NEXT_PUBLIC_FORCE_FEATURE_FLAGS=release-v1-5-feature:true`
  to force the flag on).

## Out of scope

- Email notification system (`notification_*` / `system_email_templates`).
- Push delivery gating, Expo/OS delivery-priority mapping, Android channels,
  and mobile-app rendering of the new metadata (mobile consumes the payload
  field in its own release).
- The EE platform-notification banner system (`platform_notifications`).
