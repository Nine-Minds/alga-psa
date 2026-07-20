# Fix settings sub-tab navigation breaking after route migration

**Branch:** `fix/rob-nvts-tax-issue`
**Date:** 2026-07-15
**Reported as:** NVTS — Tax settings actions fail (Billing → Tax sub-tab)

## Problem

The July 10 settings-route split moved heavy settings tabs to their own
`/msp/settings/<id>` route segments (e.g. `/msp/settings/billing`). Three sub-tab
components still hardcode the **old** base path `/msp/settings?...` in their
`updateURL` helper. When a user clicks a sub-tab — e.g. **Tax** under Billing —
`window.history.pushState` silently rewrites the URL off the segment onto
`/msp/settings?section=tax`.

The React tree stays mounted (pushState does not reload), but server actions the
sub-tab UI fires now POST against the `/msp/settings` App Router tree, which no
longer contains that tab and whose compatibility redirect in
`server/src/app/msp/settings/page.tsx:48` only fires for `?tab=<migrated>`. The
malformed `?section=tax` URL is not redirected, so the actions resolve against the
wrong route tree and fail together — HTTP 200, no tab-specific server error.
Production logs showed `POST /msp/settings?section=tax`, the exact signature.

## Root cause (confirmed in code)

The base path is hardcoded instead of derived from the current location:

- `packages/billing/src/components/settings/billing/BillingSettings.tsx:113-128`
  — the reported Tax bug; also carries a stale `/msp/settings?tab=billing`
  no-params fallback.
- `packages/scheduling/src/components/settings/time-entry/TimeEntrySettings.tsx:45`
  — same pattern (`subtab` param).
- `server/src/components/settings/import-export/ImportExportSettings.tsx:85`
  — same pattern (`section` param).

All three tabs have `hasOwnRoute: true` in
`server/src/components/settings/settingsTabsRegistry.ts` and are mounted under
their own segment, so the hardcoded base is wrong for every one of them.

The notifications segment page
(`server/src/app/msp/settings/notifications/page.tsx:103-105`) already builds the
URL correctly with `` `${window.location.pathname}?${...}` `` — the fix mirrors
this known-good code.

## Out of scope / verified safe (do not change)

- `href="/msp/settings?tab=X"` links (`server/src/config/menuConfig.ts`,
  `packages/onboarding/src/lib/stepDefinitions.ts`, and various cross-links). The
  compat redirect in `page.tsx` turns `?tab=<migrated>` into the segment path, so
  these deep links work.
- `server/src/components/settings/general/NotificationsTab.tsx:101` — the
  `notifications` tab is **not** migrated (`hasOwnRoute` absent), so this component
  is still rendered inside the legacy `SettingsPage` at the base `/msp/settings`,
  where the hardcoded `/msp/settings?...` base is correct.
- The `/msp/billing?tab=...` rewrites in `packages/billing/.../billing-dashboard/*`
  — these belong to the separate billing **dashboard** route, unrelated.

## The fix

In each of the three `updateURL` functions, anchor the shallow `pushState` to the
segment the component is actually mounted on:

1. **`packages/billing/src/components/settings/billing/BillingSettings.tsx`**
   (`updateURL`, ~lines 113-129):
   - Replace the URL construction so the base is `window.location.pathname`:
     ```ts
     const query = currentSearchParams.toString();
     const newUrl = query
       ? `${window.location.pathname}?${query}`
       : window.location.pathname;
     ```
   - This removes the hardcoded `` `/msp/settings?${...}` `` and the stale
     `'/msp/settings?tab=billing'` fallback.
2. **`packages/scheduling/src/components/settings/time-entry/TimeEntrySettings.tsx`**
   (`updateURL`, ~line 45):
   - Replace `const newUrl = `/msp/settings?${currentSearchParams.toString()}`;`
     with the pathname-anchored form:
     ```ts
     const query = currentSearchParams.toString();
     const newUrl = query
       ? `${window.location.pathname}?${query}`
       : window.location.pathname;
     ```

3. **`server/src/components/settings/import-export/ImportExportSettings.tsx`**
   (`updateURL`, ~line 85):
   - Same replacement as time-entry (`section` param variant).

Keep the intentional shallow `window.history.pushState` in all three — switching
sub-tabs must not trigger a navigation/reload; only the base path was wrong.

The existing `tab`-param bookkeeping in these helpers (`if (!currentSearchParams.has('tab'))`)
is a no-op on the segment routes (there is no `tab` param there) and can be left
as-is to minimize the diff.

## Manual verification

1. Start the dev server (host port 3400 for this worktree).
2. Navigate to `http://localhost:3400/msp/settings/billing`.
3. Click the **Tax** sub-tab. Confirm the URL becomes
   `/msp/settings/billing?section=tax` (path preserved, not `/msp/settings?...`).
4. Edit and save a tax setting; confirm the save action succeeds (no generic
   failure toast) and, in the browser console/network tab, the server action POSTs
   to `/msp/settings/billing`, not `/msp/settings`.
5. Spot-check the two siblings: `/msp/settings/time-entry` sub-tabs and
   `/msp/settings/import-export` sections keep their segment path when switched.

## Files touched

- `packages/billing/src/components/settings/billing/BillingSettings.tsx` (fix)
- `packages/scheduling/src/components/settings/time-entry/TimeEntrySettings.tsx` (fix)
- `server/src/components/settings/import-export/ImportExportSettings.tsx` (fix)
