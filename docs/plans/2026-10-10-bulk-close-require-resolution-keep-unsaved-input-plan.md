# Bulk close: require resolution when the board requires it, keep unsaved dialog input

Customer ticket: alga-2026-0002381 (AJATechnologies, "Ticket status change - add reason field").
Base: `main` at `b0d0b4dacf`. Builds on the bulk resolution field from PR #3578 (commit 6f7273fc39).

## Current state (verified in this worktree)

- `packages/tickets/src/components/BulkChangeStatusDialog.tsx` shows a `TextArea` labelled
  `bulk.status.resolutionLabel` ("Resolution comment (optional)") whenever the chosen status is in
  `closedStatusIds`. `canConfirm` only checks that a status is chosen and nothing is loading. It renders
  the shared `Dialog` with `onClose` wired straight through, so Escape, an overlay click and the X all
  close it and drop the typed text.
- `server/src/app/msp/tickets/_components/BulkChangeStatusRouteClient.tsx` loads
  `getBoardTicketStatuses(selectedTicketsSharedBoardId)` and derives `closedStatusIds`. It does not read
  close rules.
- Close rules read path:
  - Client-callable action `getBoardCloseRules(boardId)` in
    `packages/tickets/src/actions/close-rules/closeRuleActions.ts`. It returns `IBoardCloseRules` with
    defaults when no row exists. BoardsSettings already uses it.
  - It wraps the same `board_close_rules` row that `getBoardCloseRulesRow` (shared/lib/ticketCloseRules)
    returns to the server-side enforcer.
  - Server enforcement only applies a gate when `is_enabled && require_resolution_comment`
    (`closeRulesHaveEnabledGates` + `evaluateGates`).
- `bulkUpdateTicketStatus` writes the trimmed resolution per ticket before the status change, and only
  when the target status `is_closed`. Unchanged by this card.
- **Unsaved-input guard already exists in flight:** PR #3557
  (`feature/alga-2026-0002369-esc-cmd-arrow-in-ticket-editor`, alga-2026-0002369) adds the following to
  the shared `Dialog`:
  - a `hasUnsavedChanges` prop;
  - `packages/ui/src/components/DismissGuard.tsx` (`useDismissGuard`, `useRegisterDismissGuard`);
  - `packages/ui/src/lib/leaveGuard.ts`;
  - `packages/ui/src/keyboard-shortcuts/editable.ts`;
  - `common.unsavedChangesGuard.*` locale keys.

  With this guard, every dismiss path (Radix `onOpenChange(false)` from Escape or an outside click, the
  focus-trap-disabled pointerdown listener, the nested overlay, nested Escape and the X) goes through
  `requestClose`. That function asks "Discard unsaved changes?" (Keep editing / Discard changes) instead
  of closing.

  As of 2026-10-09 the PR is **OPEN, mergeStateStatus DIRTY (conflicts with main), CI red**, and it was
  last updated 2026-09-29.
- Merged precedent `useUnsavedChangesGuard` (packages/projects/src/lib, commit 3037ed0750) is per-dialog
  and project-local. It is not the shared-Dialog mechanism, so it is not reused here.

## Decision 1: Required resolution (UX only)

1. **Route client loads close rules next to statuses.** In the existing effect keyed on
   `selectedTicketsSharedBoardId`:
   - Call `getBoardCloseRules(boardId)` in parallel with `getBoardTicketStatuses` using
     `Promise.allSettled`.
   - Derive `resolutionRequired = rules.is_enabled && rules.require_resolution_comment`. This matches
     the server's gating exactly.
   - No new action and no new query shape.
   - A close-rules failure (rejection or action error) logs and falls back to `false`. The field stays
     optional and the server still enforces. A close-rules failure must not blank the status list or
     raise an error toast.
   - Reset to `false` whenever the board is unresolved, mixed, or changes.
   - `isLoadingStatuses` stays true until both settle, so Confirm can't race the flag.
2. **Dialog prop** `resolutionRequired?: boolean` (default `false`) on `BulkChangeStatusDialog`.
3. **Dialog behavior.** Set `isResolutionRequired = isClosingStatus && !!resolutionRequired`.
   - Label: new key `bulk.status.resolutionLabelRequired` = "Resolution comment" when required.
     Otherwise keep `bulk.status.resolutionLabel` ("(optional)").
   - Mark the textarea `required` / `aria-required="true"`. If `TextArea` does not forward
     `required`, pass `aria-required` through its rest props.
   - Hint (only when required): `bulk.status.resolutionRequiredHint` = "This board requires a
     resolution comment before tickets can be closed." Render it in place of the existing generic
     helper so the user sees one explanation, not two. Link it via `aria-describedby`.
   - `canConfirm` adds `&& (!isResolutionRequired || trimmedResolution.length > 0)`.
   - Non-closing status, or a board that doesn't require a resolution: behavior is byte-for-byte
     today's.
4. **Known strictness delta (accepted):** the server also accepts a resolution comment that already
   exists on a ticket. The dialog will still ask for one on a required board. The card asks for this,
   and a bulk close should carry its own resolution. Server rules are unchanged, so there is no data
   risk.
5. **Locales:** add the two new keys to `server/public/locales/en/features/tickets.json` and to every
   real locale (de, es, fr, it, nl, pl, pt, sv). Regenerate the xx/yy pseudo-locales with the repo
   script.

## Decision 2: Keep unsaved input (reuse #3557, no second mechanism)

1. **Do not add a new prop or mechanism to `Dialog.tsx`.** The opt-in prop the card asks for is #3557's
   `hasUnsavedChanges`. Its behavior is stronger than "block". Outside click and Escape open a
   discard confirmation instead of closing, so text is never dropped silently, and "Keep editing"
   returns focus to the textarea.
2. **Wire-up in BulkChangeStatusDialog:**
   `<Dialog … hasUnsavedChanges={resolution.trim().length > 0}>`.
   - The guard keys on the text, not on visibility. Text typed under a closing status and kept in state
     while the user flips statuses is still the user's work.
   - The explicit **Cancel** button keeps calling `onClose` directly. The card wants explicit Cancel to
     keep working, and the guard API intentionally leaves manual buttons unguarded unless they opt in.
   - The **X** asks first, as it does for every #3557-guarded dialog. The card allows "optionally with a
     discard confirm", and this keeps the X consistent across the app.
   - Success closes through the route (`refreshAndClose`). That bypasses `requestClose`, so a successful
     submit never prompts.
3. **Sequencing (needs an XO call; see Escalations):**
   - **Preferred:** #3557 is rebased, gets green CI and merges first. This card then rebases and
     carries only the BulkChangeStatusDialog wire-up and tests.
   - **Fallback if #3557 is not on main when implementation starts:** this branch carries #3557's
     UI-layer guard as **identical files**, in one commit titled "chore(ui): land shared dialog dismiss
     guard from #3557". The commit contains:
     - `DismissGuard.tsx` + `DismissGuard.test.tsx` (Dialog cases);
     - `lib/leaveGuard.ts` + test;
     - `keyboard-shortcuts/editable.ts` + test + its index export;
     - the `Dialog.tsx` hunks (`hasUnsavedChanges`, `useDismissGuard`, `requestClose` routing,
       `DismissGuardProvider`, `confirmElement`, editor-popup Escape capture);
     - the `common.unsavedChangesGuard.*` keys in all locales.

     The ticket-editor and Drawer wiring stays in #3557, and #3557 rebases onto it afterwards with the
     overlapping hunks resolving to no-ops. Do **not** write a bespoke `preventOutsideClose` on top of
     `preventCloseRef`. That would be the second mechanism the card forbids.

## Files to change

| File | Change |
|---|---|
| `server/src/app/msp/tickets/_components/BulkChangeStatusRouteClient.tsx` | Load `getBoardCloseRules` alongside statuses; `resolutionRequired` state; pass prop |
| `packages/tickets/src/components/BulkChangeStatusDialog.tsx` | `resolutionRequired` prop; required label, hint and aria; Confirm gating; `hasUnsavedChanges` on `Dialog` |
| `packages/tickets/src/components/BulkChangeStatusDialog.resolution.test.tsx` | Required/optional cases (dialog mock now records `hasUnsavedChanges`) |
| `packages/tickets/src/components/BulkChangeStatusDialog.dismissGuard.test.tsx` (new) | Real `Dialog` + guard: Escape / outside click with text does not close |
| `server/public/locales/*/features/tickets.json` (+ pseudo) | `bulk.status.resolutionLabelRequired`, `bulk.status.resolutionRequiredHint` |
| Fallback only: `packages/ui/src/components/{Dialog,DismissGuard}.tsx`, `packages/ui/src/lib/leaveGuard.ts`, `packages/ui/src/keyboard-shortcuts/{editable,index}.ts`, `server/public/locales/*/common.json` | Verbatim #3557 UI-layer guard |

## Tests (80/20)

Extend `BulkChangeStatusDialog.resolution.test.tsx` (existing mocks for Dialog, Switch, CustomSelect):

- **T1** Required board + closing status: label has no "(optional)", hint is shown, Confirm is disabled.
  Typing whitespace keeps it disabled. Typing text enables it, and submit sends the trimmed text.
- **T2** Required board + non-closing status: no field, Confirm is enabled once a status is chosen.
- **T3** Optional board (prop omitted): today's label and helper, and Confirm is enabled with an empty
  resolution. This is a regression guard.

New `BulkChangeStatusDialog.dismissGuard.test.tsx`, using the **real** `@alga-psa/ui/components/Dialog`
and the same i18n mocks:

- **T4** Type a resolution, then press Escape. The dialog stays open, the "Discard unsaved changes?"
  prompt appears, `onClose` is not called, and "Keep editing" leaves the text intact.
- **T5** Type a resolution, then click outside. `onClose` is not called and the text is intact.
  - Flush the timer first. Radix registers its outside-pointerdown listener in a `setTimeout(0)`, so run
    `await act(() => new Promise(r => setTimeout(r, 0)))` and then
    `fireEvent.pointerDown(document.body)`.
  - The projects suite noted that jsdom may not drive Radix's outside-pointer path. If that holds, first
    assert that a pristine dialog does close on the same gesture. If even that won't fire, the
    assertion is vacuous: drop T5 from jsdom and cover it in the browser smoke below. Do not mock Radix
    to fake it.
- **T6** Empty resolution, then Escape closes immediately with no prompt.

Route client: one small test that `resolutionRequired` comes from `is_enabled && require_resolution_comment`
and falls back to `false` when `getBoardCloseRules` rejects. Mock both actions.

## Manual smoke (dev origin http://feature-bulk-close-require-resolution-when-board-require.localhost:3681)

1. Settings → Boards → pick a board → Close rules: enable "Require resolution comment".
2. Tickets list: select 2+ tickets on that board → Bulk change status → choose a closed status.
   - The field reads "Resolution comment" with the hint, and Confirm is disabled.
   - Type text and Confirm enables. Submit and both tickets close with a resolution comment.
3. Repeat, type text, then click the backdrop. The discard prompt appears; Keep editing keeps the text.
   Press Escape and get the same result. Discard closes the dialog.
4. Turn the rule off (or use another board). The label reads "(optional)" and Confirm works with an
   empty field.

## Escalations

- `escalate-to-xo`: sequencing against PR #3557, which is open, conflicted and red. Choose between
  merging #3557 first (preferred) and authorizing the fallback that carries its UI-layer guard on this
  branch. Merge and approval decisions are above the OOD's authority.
