# Co-managed IT smoke test — 2026-09-11

Revision: `feature-co-managed-it` worktree, served by `next dev` on
`http://localhost:3374` with `NEXT_PUBLIC_FORCE_FEATURE_FLAGS=release-v1-6-feature:true`,
against the migrated `server_co_managed` database (MSP tenant `Oz`, product
`psa`/`pro`). Driven through the Alga Dev IDE browser pane
`0d713fde-4f6c-4485-844a-eb1967bf7f8c`.

Screenshots are in this directory (`smoke-*.png`).

## Journey and result

| Step | Action | Result |
| --- | --- | --- |
| 1 | Open a client's co-managed view (`/msp/clients/<id>?tab=co-managed`) | Stable `co-managed` focus view in the Service rail; compact summary; ended relationship offers explicit history (`smoke-01`, `smoke-12`). |
| 2 | Open a client with no relationship (White Rabbit, Wonderland) | Client-fixed setup form; workspace name prefilled from the client; seats/visibility/escalation board present (`smoke-02`, `smoke-06`, `smoke-15`). |
| 3 | Complete setup and submit | Reservation created; summary switches to “Preparing workspace / 0 of 1 technician seats”; progress and recovery controls render; persisted as a `queued` provisioning operation and `provisioning` relationship (`smoke-07`, `smoke-08`, `smoke-10`). |
| 4 | Retry recovery | Retry control enqueues the original operation; no client-side error (`smoke-11`). |
| 5 | Refresh the open view | The tab and focus view survive the refresh (`smoke-12`). |
| 6 | Global overview `/msp/co-managed` | Pool totals (purchased/allocated/available), pool editor, and an authorized client table with Client/Workspace/Status/Seats/Actions plus working search, empty state, and Manage links (`smoke-04`, `smoke-13`). |
| 7 | Overview “Manage access” | Navigates to the exact client relationship (`/msp/clients/<id>?tab=co-managed&relationshipId=<rel>`) instead of a duplicate dialog (`smoke-17`). |
| 8 | Legacy adapters | `/msp/co-managed?clientId=`, `/msp/co-management?operationId=`, `/sla`, `/administration`, and `/departure` all resolve to the canonical client section (`smoke-03`). An invalid operation shows the generic unavailable state. |
| 9 | Client Tickets tab | Renders the combined sponsor-client queue (native plus shared work) with rows for the client (`smoke-05`, `smoke-16`). |
| 10 | Account Management `/msp/account` | Hosted co-managed pool editor mounts inside the account settings (`smoke-14`). |

## Defects found and fixed during the smoke test

1. **Overview table headers were untranslated.** `coManaged.overview.client`,
   `.workspace`, `.status`, `.seats`, and `.actions` were referenced but absent
   from every locale, so the headers fell back to lowercase key text. Added the
   five keys to `en`, `de`, `es`, `fr`, `it`, `nl`, `pl`, `pt` and regenerated
   the pseudo-locales.
2. **The co-managed tab unmounted during a refresh**, closing an open focus
   view after setup. `CoManagedClientIntegration` now keeps its current slots on
   a manual refresh and only resets on a client/relationship change or a
   first-load failure.
3. **Access/SLA/delegation sections rendered during provisioning**, producing
   load errors before a relationship is active. `CoManagedClientView` now renders
   those sections only for an `active` relationship.
4. **Selecting a relationship (viewing history) navigated the client route**,
   which re-rendered the server tree and closed the co-managed focus view — the
   “whole screen refreshes” report. The integration now owns the selected
   relationship, loads it in place, and only syncs the URL shallowly. The header
   summary action opens the tab through a new in-place `onOpenTab` signal
   instead of a route navigation (`smoke-18`, `smoke-19`).
5. **The “View history” button caused a full-page blank/refresh.** The button
   linked to the legacy `/msp/co-management/departure?operationId=…` route,
   whose adapter (by design) redirects a sponsor operation back to the same
   client section — a circular navigation that reloaded the whole screen to end
   up in the same place. The ended-history action now links to the retained
   shared-work archive, and a live relationship embeds the departure experience
   in the client view instead of routing through the legacy adapter
   (`smoke-20`).

## Notes and limits

- The dev environment has no Stripe configuration, so the hosted pool editor
  correctly shows “The payment provider is not configured.” The purchase and
  reconciliation journey is covered separately by the emulator-backed
  integration test (`server/src/test/integration/coManagedPurchaseEmulator.integration.test.ts`).
- The Temporal worker for this worktree did not advance the new operation past
  `queued`, so the run stops at the progress/recovery state rather than customer
  acceptance. That is an environment limit, not a UI failure.
- Screenshots are desktop light mode; the earlier T021 capture covers dark mode.

## Verification after the fixes

`server/src/test/unit/product` 669 passing; the emulator purchase journey and
the resolver/overview migrated-database cases passing; `tools/i18n/audit-all.cjs`
reports 0 untranslated, 0 forbidden, 0 structural; server typecheck matches its
baseline.
