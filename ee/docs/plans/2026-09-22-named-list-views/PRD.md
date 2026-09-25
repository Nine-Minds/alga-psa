# PRD — Named List Views

- Slug: `named-list-views`
- Date: `2026-09-22`
- Status: Draft (awaiting scope confirmation)
- Branch: `feature/names-views`

## Summary

Let MSP users save the current configuration of a list screen (filters, sort, visible columns, column order, column widths, density, page size) as a **named view**. Each view is either **private** (visible to its owner only) or **shared** (visible to every MSP user who can open that list). Users switch between views from a view picker on the list toolbar. A view can be opened from a link, and each user can set one view per list as their default.

The work adds one generic layer, a `list_views` table, server actions and a `ListViewPicker` UI with a per-list adapter contract. Five list screens then adopt it: Tickets, Projects, Clients, Contacts and Assets.

## Problem

List configuration in Alga today is either temporary or controlled by admins:

- **Tickets:** the live state is kept in the URL. An admin can save **one** default arrangement per board, plus a tenant-wide default (`boards.list_view_settings`, `tenant_settings.ticket_display_settings.list`). A technician who wants "My overdue P1s" and "Unassigned in Service Desk" has to rebuild the filters every time, or bookmark long URLs.
- **Projects, Clients, Contacts, Assets:** filters live in `useState` and are lost on reload. Only page size or view mode is kept, per user.
- **No sharing:** a dispatcher can't publish "Triage queue" for the team without changing the board default, which changes the list for everyone.

## Goals

1. Save the current list configuration under a name, as a private or shared view.
2. Switch between views in one click, and see when the live list has drifted from the applied view.
3. Update an existing view in place, save it as a new view, rename it, change its visibility, or delete it, subject to ownership and permission rules.
4. Set a personal default view per list, applied when the user opens the list with no explicit state in the URL.
5. Make views linkable (`?view=<id>`), so a shared view can be sent to a teammate.
6. Build this once as a generic layer (storage, actions, picker, adapter contract) so adding the next list screen means writing an adapter, not re-implementing views.
7. Roll out on Tickets, Projects, Clients, Contacts and Assets.

## Non-goals

- Sharing scoped to specific **teams, roles or individual users**. v1 has exactly two visibilities, private and shared. The schema leaves room for more: `visibility` is a text column with a check constraint, not a boolean.
- Client-portal lists. MSP only.
- Row **grouping**. DataTable has no grouping primitive, and adding one is a separate project.
- Replacing the ticket **board default** and **tenant default** views. They remain the admin-authored baseline (see "Relationship to board defaults").
- Scheduled or emailed views, view-based notifications, or views as report sources.
- Folders, drag-to-reorder of views, or view usage analytics.
- Billing and invoice screens (Automatic Invoices, Drafts, Finalized). These can adopt later through an adapter.
- Audit logging, metrics and feature flags. Not requested.

## Users and primary flows

**Personas:** technician (private views for their own work), dispatcher or service manager (publishes shared queues), admin (manages shared views and board defaults).

### Flow A — Save a private view

1. On Tickets, set filters (assigned to me, overdue, priority P1), sort by due date, and hide the Client column.
2. Open the view picker and choose **Save as new view…**
3. Enter the name "My overdue P1s". Visibility defaults to **Private**. Save.
4. The picker now shows "My overdue P1s" as the active view, and the URL contains `?view=<id>`.

### Flow B — Switch views

1. Open the view picker. It lists **My views** (private, alphabetical), then **Shared views** (alphabetical, each showing its owner's name).
2. Select a view. The list applies its filters, sort, columns, widths, density and page size, and resets to page 1.
3. Select **Default view** to return to the baseline (the board or tenant default on Tickets, the built-in defaults elsewhere).

### Flow C — Modify and update

1. With a view applied, change a filter. A dirty indicator appears on the picker trigger.
2. The picker offers **Save changes to "<name>"** if the user may edit the view, **Save as new view…**, and **Discard changes** (re-applies the stored view).

### Flow D — Share

1. A user with share permission saves a view as **Shared**, or switches an existing private view to Shared from **Manage view**.
2. Every MSP user with read access to that list sees it under Shared views.

### Flow E — Personal default

1. From a view's row menu, choose **Set as my default**.
2. Opening the list with no `view` and no filter parameters in the URL applies that view.
3. **Clear my default** reverts to the baseline.

### Flow F — Link

1. Copy the page URL while a view is applied. A teammate who opens it gets the shared view. For a private view they do not own, they get the baseline list and a toast: "This view is private or no longer exists."

## Relationship to ticket board defaults

Ticket lists already resolve **board default → tenant default → column catalog**. Named views sit **above** that chain:

- **Baseline:** the resolved board or tenant default, unchanged.
- **Named view:** a full snapshot that replaces the baseline for every group it defines. It uses the same per-group replacement semantics as `resolveTicketViewSettings`.
- **Board scope:** a ticket view stores its **board scope** (`boardId`, `boardIds`, `excludeBoardIds`, `boardFilterState`), unlike board defaults, which exclude it. Applying a view navigates to that board tab. This is what makes "Unassigned in Service Desk" meaningful. `searchQuery` is still excluded.
- **Existing menu:** `TicketViewMenu` keeps its "Save as board/tenant default" items for users with `ticket_settings:update`. Its column and density controls stay the editing surface for the live view. The new picker sits next to it and handles only named-view operations.

## UX / UI notes

- **`ListViewPicker`** lives in `packages/ui` (i18n namespace `common`, key prefix `listViews.*`).
  - **Trigger:** a toolbar button showing the active view's name, or "Default view", plus a chevron and a dirty dot. Placed left of the list's existing View/column menu.
  - **Dropdown:**
    - A "Default view" row.
    - **My views** and **Shared views** sections, each with a search box once there are more than 8 views.
    - A shared view that is also the user's own shows a "shared" icon. Each row has a star if it is the user's default.
    - A row's hover menu (`⋯`) offers Manage, Set/Clear my default, Copy link and Delete.
    - A footer offers **Save changes to "<name>"** (disabled when not dirty or not editable), **Save as new view…** and **Discard changes**.
  - **Save / Manage dialog:** the custom `Dialog` with a sticky footer. Fields are Name (required, 1–100 characters, unique among the owner's views for that list) and Visibility (radio: Private / Shared; the Shared option is disabled with a hint when the user lacks permission). Manage adds Delete, with confirmation.
- **Toasts:** views that reference deleted entities (a tag, user, board, status or client) apply with those references dropped, and a toast lists what was dropped. The stored view is not rewritten until the user saves.
- Every interactive element gets a kebab-case `id` (`<list>-view-picker-*`).
- All strings are localized through `common` (`listViews.*`), with keys added to every locale file, including the `xx`/`yy` pseudo-locales.

## Data model

New table `list_views`, tenant-distributed (Citus, colocated with `tenants`):

| column | type | notes |
|---|---|---|
| `tenant` | uuid not null | FK → tenants; part of PK |
| `view_id` | uuid not null default gen_random_uuid() | PK `(tenant, view_id)` |
| `list_key` | text not null | e.g. `tickets`, `projects`, `clients`, `contacts`, `assets`; validated in app against a registry |
| `name` | text not null | trimmed, 1–100 chars |
| `owner_user_id` | uuid not null | FK → users `(tenant, user_id)` |
| `visibility` | text not null | check in (`private`, `shared`) |
| `settings` | jsonb not null | adapter-validated `ListViewSettings` envelope |
| `schema_version` | integer not null default 1 | per-list adapter migrations on read |
| `created_at` / `updated_at` | timestamptz not null default now() | |

**Indexes:**

- `(tenant, list_key, visibility)` for the list query.
- Unique `(tenant, list_key, owner_user_id, lower(name))`, so a user can't have two views with the same name on one list.

**Personal default:** stored as a `user_preferences` row, `setting_name = 'listViews.default.<list_key>'`, whose value is the `view_id`. It is written and read through the new list-view actions, which always use the session user. They never take a `userId` argument.

**Settings envelope** (`packages/types`):

```ts
interface ListViewSettings<F = Record<string, unknown>> {
  filters?: F;                                  // adapter-typed
  sort?: { by: string; direction: 'asc' | 'desc' };
  columns?: {
    visibility?: Record<string, boolean>;
    order?: string[];
    sizing?: Record<string, number>;            // px
  };
  density?: number;                             // 0..100 step 10 (tickets)
  pageSize?: number;
}
```

**Adapter contract** (`ListViewAdapter<TLiveState, F>`), one per list, registered by `list_key`:

- `listKey`, plus the permission that gates reading the list (e.g. `ticket:read`).
- `settingsSchema`: zod, strict. Unknown keys are rejected on write.
- `capture(live) → ListViewSettings`: what gets saved.
- `apply(settings, live) → next live state`: what gets loaded.
- `sanitize(settings, ctx) → { settings, dropped[] }`: removes references to entities that no longer exist.
- `differs(live, settings) → boolean`: drives the dirty dot.
- `migrate(settings, fromVersion)`: upgrades documents stored under an older `schema_version`.

**Owner removal:** Citus doesn't support `ON DELETE SET NULL`. When a user is hard-deleted, the user-deletion action deletes their private views and reassigns their shared views to the deleting admin. When a user is deactivated, their views stay: private views become inert, and shared views remain visible, labeled with the owner's name.

## API / server actions

Server actions live in non-UI package code, most likely a new `packages/list-views` package (or a `listViews` module in `packages/core`); decide in the design session and record it in the SCRATCHPAD. All use `withAuth`, `createTenantKnex`, `tenantDb` and `withTransaction`.

| action | who | behavior |
|---|---|---|
| `listListViews(listKey)` | holder of the list's read permission | caller's private views + all shared views for the list, with owner display name, `isOwner`, `canEdit`, `isMyDefault` |
| `getListView(viewId)` | same | returns the view if it is shared or owned by the caller; otherwise a not-found error. Private views are never distinguished from missing ones. |
| `createListView(listKey, {name, visibility, settings})` | read permission; `shared` also needs `list_view:share` | validates with the adapter schema |
| `updateListView(viewId, patch)` | owner, or `list_view:manage` for shared views | a patch may change name, visibility or settings; a change to `shared` needs `list_view:share` |
| `deleteListView(viewId)` | owner, or `list_view:manage` for shared views | also clears any `listViews.default.*` preference that points at it, for every user |
| `setMyDefaultListView(listKey, viewId \| null)` | session user | the view must be visible to the caller |

**New permissions** in `server/migrations/utils/permissions/catalog.cjs`, reconciled into all tenants:

- `list_view:share`: publish views as shared. MSP. Default grants: Admin, Manager, Dispatcher.
- `list_view:manage`: edit or delete *other users'* shared views. MSP. Default grant: Admin.

An owner may always edit or delete their own views. Taking a shared view back to private requires ownership, or `list_view:manage`.

## Engine changes (lower layers)

- **DataTable** (`packages/ui/src/components/DataTable.tsx`):
  - Add controlled `columnSizing` / `onColumnSizingChange` props. Today sizing lives only in localStorage (`datatable-column-sizing:<id>`), so a view can't capture or apply it.
  - Keep the localStorage fallback when the props are absent.
  - Add controlled `columnOrder` (string[]) so non-ticket lists can reorder without rebuilding `columns`.
  - Add controlled `columnVisibility` (Record<string, boolean>). A hidden column is excluded before the auto-fit runs.
- **Generic hook** `useListViews({ adapter, live, setLive })`, in `packages/ui` or the new package. It owns:
  - loading the list of views
  - resolving the active view from the URL, then the user default, then the baseline
  - apply, save, update and discard
  - dirty state
  - the `?view=` URL parameter

  Screens provide their live state and a setter; they do not re-implement any of this.
- **Filter state out of `useState`:** for Projects, Clients, Contacts and Assets, move filter state into a single typed live-state object that can be captured and applied. Ideally mirror it to the URL like Tickets does, so the `?view=` link plus overrides can be deep-linked. Whether all four screens get URL state in v1 is an open question (see below).

## Rollout / migration

- One migration: create `list_views`, distribute it, add FKs, and register the table in `tenantTableMetadata.ts` and `server/migrations/utils/tenantDb.cjs`.
- Add the new permissions to the catalog; `reconcileAllTenants` grants the defaults.
- No backfill. Existing board and tenant defaults are untouched.
- No feature flag (not requested).

## Risks

- **Stale references:** a view referencing a deleted tag, user or board must not break the list. Mitigation: adapter `sanitize` plus a toast; stored views are not rewritten automatically.
- **Private-view leakage:** read queries must filter on `visibility = 'shared' OR owner_user_id = <session user>`, and a private view must be indistinguishable from a missing one. Covered by the DB-backed tests.
- **Adapter drift:** when a list adds or renames a filter or column, old view documents must still load. Mitigation: a strict schema on write, a lenient sanitize on read, and `schema_version` + `migrate`.
- **Ticket complexity:** tickets have three layers of state (URL, board default, named view). Mitigation: named views reuse the `ticketViewSettings` capture, sanitize and diff helpers instead of forking them. `LEVERAGE` markers go where they overlap with the generic adapter.
- **Existing preference-action gap:** `setUserPreference` takes an arbitrary `userId` and doesn't check it against the caller. The new actions don't use that path, and the gap is outside this plan's scope. It is noted in the SCRATCHPAD for a separate fix.

## Open questions

1. **Sharing granularity:** is "private / shared with everyone" enough for v1, or is "shared with team" required at launch? The schema allows adding it; this plan assumes no.
2. **Adopter set:** is Tickets + Projects + Clients + Contacts + Assets the right first wave? Should Tickets ship first on its own?
3. **URL state:** should every adopted list mirror its filters to the URL, as Tickets does, or is `?view=<id>` alone enough for the non-ticket lists?
4. **Package home:** a new `packages/list-views` package, or modules inside `packages/ui` (client) and `packages/core` (actions)? Must respect the build-order and `dist` resolution constraints.
5. **Default share grants:** is Admin + Manager + Dispatcher the right default set for `list_view:share`?
6. **Admin-assigned defaults:** should an admin be able to mark a shared view as the *tenant default* for a list, replacing the ticket tenant default? This plan says no; board and tenant defaults stay as they are.

## Acceptance criteria / definition of done

- On all five adopted lists, a user can save, apply, update, save-as, rename, re-scope (private↔shared), delete and set a default view. The applied configuration restores filters, sort, column visibility, order, widths, density (tickets) and page size.
- Private views are never returned to, or loadable by, another user, whether through the picker, a direct link or a server action call.
- Sharing requires `list_view:share`. Editing or deleting someone else's shared view requires `list_view:manage`.
- `?view=<id>` deep links work, and an inaccessible id falls back to the baseline with a toast.
- A view referencing deleted entities applies without error and reports what it dropped.
- Ticket board and tenant defaults behave exactly as before for users who never touch named views.
- All new strings are localized, `validate-translations` passes, and every interactive element has an `id`.
- The DB-backed integration tests and the representative UI tests in `tests.json` pass.
