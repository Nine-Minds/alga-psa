# Ticket bundles: change the master from the bundle dialog and from the child ticket

Customer ticket: alga-2026-0002892 (Joymode Business Solutions).

## Problem

A customer bundled some tickets, added one more ticket to the bundle with the bulk bundle dialog, and wanted the newly added ticket to be the master. The master dropdown in the dialog was disabled and nothing told them how to change the master.

Changing the master is supported today, in one place only: the Promote button on each child row in the Bundle panel of the current master's ticket page (`packages/tickets/src/components/ticket/TicketDetails.tsx`, button id `ticket-bundle-promote-child-<ticket_id>`, handler `handlePromoteChildToMaster`). It calls `promoteBundleMasterAction` (`packages/tickets/src/actions/ticketBundleActions.ts`). Nothing leads the user there from the two places they are likely to be:

- `packages/tickets/src/components/BulkBundleDialog.tsx` disables the master dropdown when exactly one selected ticket is already a bundle master (`disabled={loadingMasters || hasMultipleMasters || existingMasterIds.size === 1}`). The notice `bulk.bundle.existingMasterLocked` says the existing master will be used and gives no way to change it.
- A child ticket's own page shows only the bundle notice (link to the master, plus `details.bundle.childLockedNotice` or `details.bundle.childLinkedNotice`). It has no way to make that ticket the master.

Also, Promote on the master's page runs with no confirmation, although it moves the bundle's settings to another ticket.

## Goal

The master of a bundle can be chosen wherever the user is thinking about the bundle: in the bulk bundle dialog, on the child ticket, and on the master ticket. All three run the same promotion and ask for the same confirmation.

## Design

### One promotion function

Promotion is written inline in `promoteBundleMasterAction`. Move it into a transaction-level function in `packages/tickets/src/actions/ticketBundleUtils.ts`, beside `attachChildrenToBundle`, so it can be composed inside another transaction. `promoteBundleMasterAction` becomes a thin caller. Its behavior does not change: the new master must be a current child of the old master and must not have children of its own, the bundle settings row (`mode`, `reopen_on_child_reply`) moves to the new master, the other children are re-pointed, the old master becomes a child, and a `TICKET_MERGED` workflow event with reason `bundle:promote_master` is published after commit.

### `bundleTicketsAction` honors the master it is given

Today the dialog can only submit the existing master as `masterTicketId`. Change the action's contract to: after it succeeds, `masterTicketId` is the master of the bundle that contains every listed ticket.

- No listed ticket is an existing master: as today.
- The requested master is the one existing master: as today.
- Exactly one listed ticket is an existing master and it is not the requested master: in one transaction, attach the other listed tickets to the existing master with `attachChildrenToBundle`, then promote the requested master with the promotion function. If either step fails, nothing is changed.
- Two or more listed tickets are existing masters: rejected as today. Merging bundles is a separate feature.

Do this on the server. Do not make two calls from the client. Do not add a flag or mode to the action: the requested master already says what is wanted.

Workflow events for this path: the bundle publications from the attach step and the `bundle:promote_master` event from the promote step both go out after commit, as they do when the two are done separately.

The settings of the existing bundle are kept (and moved to the new master). The dialog's sync toggle must not silently change the mode of an existing bundle in this path; check what the dialog does today when the existing master is used and keep that behavior.

### Bulk bundle dialog

- With exactly one existing master among the selected tickets, the dropdown is enabled and defaults to the existing master. The existing master keeps its "(existing master)" suffix in the list.
- The notice changes. It says the bundle already has a master, and that choosing another ticket makes it the master, moves the bundle's settings to it, and makes the current master a child.
- The closed-master choice (`getBundleMasterClosedContextAction`) already keys off `masterId`. Decide during design what it must ask when the existing master and the chosen master differ in closed state, since tickets are attached to the existing master first and the chosen ticket becomes master after. The rule: the user is asked about the bundle as it will be once the dialog finishes.
- With two or more existing masters the dropdown stays disabled and the existing error stays.

### Child ticket page

The child's bundle notice gets a Make master action. It calls `promoteBundleMasterAction` with the current master as `oldMasterTicketId` and the viewed ticket as `newMasterTicketId`. After success the page refreshes in place and shows this ticket as the master. The action is shown only to users with ticket update permission. The server check stays as the enforcement.

### One confirmation

Promote on the master's page, Make master on the child's page, and the dialog when a non-default master is chosen all confirm before promoting. The confirmation names both tickets by ticket number and says the bundle's settings move to the new master and the current master becomes a child. In the dialog, the changed notice plus the Bundle button may serve as the confirmation if the design finds a second dialog redundant; the two ticket pages use the standard confirmation dialog component.

## Standards

- Use existing UI components (Button, Alert, the standard confirmation dialog). No custom components.
- Show ticket numbers, never ticket ids.
- All new strings go through `t()` with keys under `bulk.bundle.*` and `details.bundle.*`, with English defaults, and are added to the locale files the same way the neighboring keys are.
- Every new interactive element has an id in the existing style (`ticket-bundle-...`).

## Out of scope

- Merging two bundles (two or more existing masters in the selection).
- Promoting from the ticket list.
- Changing what promotion does to statuses, assignees or priorities of bundle members.

## Acceptance

1. Bundle tickets A (master) and B. Select A, B and C in the ticket list and open the bundle dialog. The master dropdown is enabled and shows A. Pick C and confirm. C is the master, A and B are children, and the bundle's mode and reopen-on-reply setting are what they were on A.
2. Same start, leave the dropdown on A: C is added as a child of A, as today.
3. Open child B's page, click Make master, confirm. B's page shows the master banner and A is listed as a child.
4. Promote on the master's page asks for confirmation before it runs.
5. A user without ticket update permission does not see Make master, and the server refuses the action.
6. Selecting two existing masters in the dialog is still blocked with the existing message.
