# PRD — AlgaPSA Mobile 1.5

- Slug: `2026-08-20-mobile-1-5`
- Date: `2026-08-20`
- Status: Implementation in progress
- Release theme: Field execution and sales follow-through
- Target app version: `1.5.0`

## Summary

Mobile 1.5 makes ticket work safer and more complete in the field, and brings
the mobile Opportunities experience back into alignment with the sales module
that changed after the 1.4 release.

The release is anchored by a customer-requested ticket checklist experience.
It also replaces eager, accidental ticket mutations with explicit staged
updates and notification controls, repairs the mobile Opportunity Queue API
contract, adds fast opportunity capture, and adopts the current opportunity
step-completion semantics.

## Committed Scope

### 1. Ticket checklists

- [x] Add authenticated REST endpoints for mobile checklist reads and writes;
      reuse the existing tenant-scoped checklist logic and ticket permissions.
- [x] Show checklist progress on ticket detail (`3 of 5 complete`).
- [x] Show required items distinctly.
- [x] Show completion attribution (who completed an item and when).
- [x] Complete and uncomplete checklist items with an optimistic UI and a
      correct rollback/error state.
- [x] Add a checklist item from mobile.
- [x] Refresh checklist progress after mutations and ticket refreshes.
- [x] When ticket closure is blocked by required checklist items, explain the
      failure and take the user to the incomplete checklist.
- [x] Keep checklist completion as an immediate one-tap operation; it does not
      use the ticket-edit confirmation bar.

Checklist template administration, item reordering, assignment editing, and
checklist deletion remain web-only in 1.5. Applying an existing template is a
stretch item.

### 2. Explicit ticket update confirmation

Selections in ticket edit controls must be staged locally. They must not call
the API until the user presses the bottom Apply action.

Apply this behavior to:

- [x] Status changes.
- [x] Priority changes.
- [x] Assign and unassign.
- [x] Contact changes.
- [x] Due-date changes.
- [x] Title saves.
- [x] Description saves.
- [x] Tag changes, using multi-select followed by Apply.
- [x] Ticket closure through a resolution comment.

Each edit surface uses a fixed bottom action area with Cancel and a specific
Apply label where helpful, for example `Change status`, `Assign`, or `Save
description`. Closing, unassigning, and overriding close rules may add a
stronger consequence warning. Ordinary edits must not show a redundant second
confirmation dialog after the user presses Apply.

These operations remain immediate because they are low risk or operate on the
current user's own state:

- Checklist completion.
- Watch/unwatch.
- Copy and open-link actions.
- Starting and stopping timers.

### 3. Silent ticket updates

The ticket update action area includes the existing two-level notification
suppression model:

- [x] `Don't notify the customer` sets
      `suppressContactNotifications=true`.
- [x] `Also don't notify agents and watchers` additionally sets
      `suppressInternalNotifications=true` and is unavailable unless customer
      suppression is selected.
- [x] Thread the options through status, priority, assignment, contact, due
      date, title, description, and other supported ticket update APIs.
- [x] Extend tag and resolution-comment APIs where necessary so the control's
      behavior is honest and consistent.
- [x] Reset suppression after a successful Apply or when the edit surface is
      dismissed.
- [x] Preserve the selected suppression options after a failed Apply so the
      user can correct the problem and retry.
- [x] Show explicit success feedback, such as `Status updated without
      notifying the customer` or `Status updated with no notifications`.
- [x] Preserve server-side activity/audit annotations for silent changes;
      workflows and webhooks continue to receive their normal events with the
      suppression metadata.

The control suppresses notifications caused by the staged ticket operation.
It is not a persistent ticket-wide mode, and users must never carry silent
state unknowingly into a later edit.

### 4. Opportunity Queue compatibility refresh

- [x] Replace the mobile-only `{ greeting, sections[] }` assumption with the
      real server contract: `user_first_name`, `do_today`, `going_quiet`,
      `money_found`, `found_totals`, and `lesson`.
- [x] Render due-today and going-quiet actions with the server's current
      overdue fields.
- [x] Render structured, translatable why-sentences rather than expecting a
      precomposed `{ text, emphasis }` object.
- [x] Render money-found suggestions and per-currency totals without combining
      unlike currencies.
- [x] Support suggestion actions that are appropriate on mobile, or present a
      clear read-only/web handoff where an action is deliberately deferred.
- [x] Add a cross-package contract fixture/test so mobile queue mocks cannot
      drift from the server response again.

### 5. Quick-create opportunity

- [x] Add a prominent New Opportunity action from the Opportunities surface.
- [x] Require only client and title from the user.
- [x] Default deal type from the selected client's lifecycle.
- [x] Default the first action and its due date while preserving the sales
      discipline invariant that every open opportunity has a next action.
- [x] Offer optional contact, expected close, currency, MRR, one-time revenue,
      and hardware value fields in a secondary/expandable area.
- [x] Open the newly created opportunity after a successful create.
- [x] Enforce existing opportunity create permissions and capability gating.

### 6. Opportunity step-plan compatibility

- [x] Show the current opportunity step and the relevant planned successors.
- [x] Complete the current step from mobile.
- [x] Choose an already-planned successor or create the next action and due
      date.
- [x] Optionally attest that completing the step reached the next sales
      checkpoint.
- [ ] Open linked tickets and project tasks from a step when present.
- [x] Keep Won and Lost transitions in their dedicated server flows.

A complete visual plan editor, drag reordering, template administration, and
pipeline reports are not committed to 1.5.

### 7. Release hardening

- [x] Set Expo and npm package metadata to `1.5.0` and keep them aligned.
- [x] Increment iOS `buildNumber` and Android `versionCode` beyond build 29.
- [x] Provision the Android Play submit credential in CI rather than relying
      on an ignored local `google-service-account.json` file.
- [x] Remove the unintended Android microphone permission unless a shipped
      feature requires it.
- [x] Ensure the distribution workflow cannot bypass lint, typecheck, tests,
      and resolved Expo configuration checks.
- [x] Add release contract tests for ticket notification suppression and the
      Opportunity Queue response.
- [ ] Complete iOS and Android device smoke tests for the committed flows.
- [ ] Update store release notes and screenshots for checklists, safe ticket
      edits, and quick opportunity creation.

## Stretch Scope

- [ ] Apply an existing checklist template from mobile.
- [ ] Full opportunity step-plan timeline with mobile plan editing.
- [ ] Opportunity owner reassignment and assigned/owned pipeline filters.
- [ ] Deep links directly to opportunity detail and ticket checklist sections.

Stretch work must not delay the committed ticket checklist, safe-edit,
notification-suppression, Queue compatibility, or quick-create scope.

## Non-goals

- No mobile checklist template administration.
- No persistent global `silent mode`.
- No confirmation prompt for every low-risk one-tap action.
- No full Opportunity Reports experience on mobile.
- No offline mutation queue in 1.5.
- No change to the server's notification suppression hierarchy or audit
  semantics.

## Acceptance Criteria

1. Selecting a status, priority, assignee, contact, date, or tag never mutates
   the ticket before Apply.
2. Cancel or dismiss discards staged changes and notification choices.
3. Each supported update can notify everyone, suppress customer notifications,
   or suppress all customer/internal notifications; the server receives the
   exact corresponding flags.
4. Silent state resets after success and never leaks into a later edit.
5. Required checklist items are visible and actionable, and an incomplete
   required checklist produces a useful ticket-close failure on mobile.
6. Checklist completion remains fast and one-tap, with rollback on failure.
7. The Opportunity Queue renders real server data for due-today, going-quiet,
   money-found, translations, and multiple currencies.
8. A user with permission can create an opportunity from client and title and
   immediately see its default current action.
9. Mobile can complete the current opportunity step without breaking the
   server's successor and stage invariants.
10. Lint, typecheck, unit tests, contract tests, Expo config resolution, and
    iOS/Android smoke tests pass before store submission.

## Test Plan Summary

- API tests for checklist CRUD subset, notification flags, opportunity create,
  Queue response parsing, and opportunity step completion.
- Component tests proving picker selection does not call an API until Apply.
- Component tests for Cancel, retry after error, suppression hierarchy, reset
  after success, and accessible fixed-bottom controls.
- Close-rule integration tests with incomplete/complete required checklists and
  silent close options.
- Opportunity contract tests using a server-owned Queue fixture, including
  structured why-sentences and two currencies.
- Manual device coverage for small phones, tablets, keyboard-visible layouts,
  dark mode, offline/error states, and screen-reader labels.
