# Board default routing in the shared ticket-creation path

Ticket: `alga-2026-0002687` (YourColo, item 3) — generalised fix.
Status: design (Design Session step). Date: 2026-11-01.

## Problem

`POST /api/v1/tickets` creates tickets that ignore the board's default routing.
TIC1041 and TIC1045 were created on board *General Support* and arrived with
`assigned_team_id` null; the same board applied its Service Desk team to tickets
created by email or in the UI.

Board-default routing today is re-implemented per entry point, and the REST API
has no copy at all:

| Entry point | default user | default team |
| --- | --- | --- |
| REST `POST /api/v1/tickets` | none | none |
| Inbound email (`shared/workflow/actions/emailWorkflowActions.ts:1318`) | applied inline | picked up elsewhere (routing rules) |
| UI quick add (`packages/tickets/src/components/QuickAddTicket.tsx:735-775`) | applied **client-side** | applied **client-side** |
| `internalNotificationSubscriber` | notification fallback only | notification fallback only |

Adding a fourth copy to `TicketService.createTicket` would make the API behave
and leave three other copies to drift. The API is only the surface where the
missing copy became visible.

## Decision

Apply board defaults **once, server-side, at the single insert seam**: inside
`TicketModel.createTicket` (`shared/models/ticketModel.ts:923`), next to the
existing board-default watcher seed. Every caller that ends in a ticket row —
REST service, email workflow, UI server action, templates, RMM/Huntress
creators — inherits it, with no per-call-site flags.

### Explicit null vs absent

The API schema already distinguishes the two, and the distinction is
load-bearing:

- **absent (`undefined`)** — the caller expressed no preference → apply the
  board default.
- **explicit `null`** — the caller asked for "unassigned" → keep null; never
  overwrite caller intent. This also opts out of a board team default, since a
  team lead would otherwise become the primary assignee.

This is documented in the helper's JSDoc and asserted by tests. It is also why
the rule cannot live in a `zod` default (a default erases the distinction) or
in a "if falsy" branch (null and undefined would collapse).

### Precedence

1. a supplied caller value, including explicit null, wins;
2. board `default_assigned_to` / `default_assigned_team_id` only for omitted
   fields;
3. unset.

For the team, `assignTeamToTicketCore` resolves the primary assignee as
`ticket.assigned_to || team.manager_id`, so a caller's or board's default user
is preserved and the team only supplies a lead when nobody is assigned. Team
assignment also records the team's active members as `team_member` additional
agents — the same behaviour as assigning the team by hand, which is the point.

## Implementation

1. **New helper** `shared/lib/tickets/boardDefaultRouting.ts`, mirroring the
   existing `boardDefaultWatchers` module:

   ```ts
   export interface ResolvedBoardDefaults {
     assignedTo?: string;
     defaultTeamId?: string;
   }

   export async function resolveBoardDefaultRouting(
     trx: Knex.Transaction,
     tenant: string,
     input: Pick<CreateTicketInput, 'board_id' | 'assigned_to' | 'assigned_team_id'>,
   ): Promise<ResolvedBoardDefaults>
   ```

   - reads the board row once (`default_assigned_to`, `default_assigned_team_id`);
   - returns `assignedTo` only when `input.assigned_to === undefined` and the
     board value is non-null;
   - returns `defaultTeamId` only when both assignment fields are omitted. An
     explicit null team is preserved, and any explicit user choice (including
     null) opts out of the team default so its lead cannot replace caller intent;
   - **soft-fails**: an inactive/deleted default user, a missing team, or a
     `team_not_found` / `team_lead_missing` from the core is logged and skipped.
     A default must never make ticket creation fail — a ticket with no routing
     is a routing bug; a dropped ticket is a data-loss bug.

2. **Hook it into `TicketModel.createTicket`:**
   - after `applyBoardDefaultWatchers` and before `buildTicketCreateRow`, apply
     the resolved `assignedTo` to `cleanedInput.assigned_to` so the existing
     `assertHumanWorkAssignee` guard validates the value that will be written;
   - after `tenantDb(trx, tenant).table('tickets').insert(dbData)`, when
     `defaultTeamId` was resolved, call
     `assignTeamToTicketCore(trx, tenant, userId ?? null, ticketId, defaultTeamId)`
     inside the same transaction. Guard it with the same soft-fail policy, before
     `TICKET_CREATED` is published so subscribers see the routed ticket.

3. **Delete the copies this makes redundant:**
   - `shared/workflow/actions/emailWorkflowActions.ts:1315-1320` — the inline
     `default_assigned_to` lookup (its comment claims a fallback the shared seam
     now owns). Keep the email-specific *explicit* assignment path untouched.
   - `packages/tickets/src/components/QuickAddTicket.tsx:735-775` — the
     client-side default-filling for user and team. The server action reaches
     `TicketModel.createTicket`; leaving the client copy in place would apply the
     default twice and hide a broken seam. This is a UI-visible behaviour change
     only in that it now happens one round-trip later; the resulting ticket is
     identical.

4. **Leave alone:** `internalNotificationSubscriber`'s notification-only
   fallbacks (they are about who is told, not who is assigned) and
   `TicketService.assignTeam` (an explicit assignment of an existing ticket).

## Tests

- Integration: `POST /api/v1/tickets` on a board with default user + default
  team → response and row carry both; `assigned_to` = board default user;
  `assigned_team_id` = board default team; the team's active members appear as
  `team_member` resources.
- Explicit wins: request with `assigned_to` and `assigned_team_id` set → both
  preserved, no default applied.
- Explicit null: request with `"assigned_team_id": null` → stays null (the
  board default must not be substituted); same for `assigned_to`.
- Soft fail: board default user inactive → ticket still created, unassigned,
  warning logged. Board default team deleted → ticket still created, no team.
- Regression: inbound-email creation and the UI quick-add still produce the same
  routing they did before (now from the shared seam).

## Risks

- **Silent behaviour change for API clients** that relied on unassigned
  creation. Mitigated by the explicit-null rule and by the customer's stated
  expectation that API matches email/UI. Worth a release note.
- **Board default pointing at a non-human/inactive user.** The
  `assertHumanWorkAssignee` guard already rejects such a primary assignee; the
  soft-fail path must run *before* the guard so a stale default cannot block
  creation.
- **Double application** if any remaining client-side copy survives; the
  QuickAddTicket removal in step 3 is part of the change, not a follow-up.

## PSA

This card is linked to the existing YourColo ticket `alga-2026-0002687`
(explicit reference, `state.psaTicketId`). No internal PSA ticket is required;
Link Spec to PSA Ticket should record the link to that ticket, not create one.
