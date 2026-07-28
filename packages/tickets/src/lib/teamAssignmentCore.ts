import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export type RemoveTeamFromTicketMode = 'remove_all' | 'keep_all' | 'selective';

export interface RemoveTeamFromTicketOptions {
  mode: RemoveTeamFromTicketMode;
  keepUserIds?: string[];
}

export type TeamAssignmentErrorKind = 'ticket_not_found' | 'team_not_found' | 'team_lead_missing';

// The messages are load-bearing: `ticketActionErrorFrom` maps them by prefix for
// the server-action path. `kind` is what the REST layer should switch on.
const TEAM_ASSIGNMENT_MESSAGES: Record<TeamAssignmentErrorKind, string> = {
  ticket_not_found: 'Ticket not found',
  team_not_found: 'Team not found',
  team_lead_missing: 'Team lead not found',
};

export class TeamAssignmentError extends Error {
  constructor(readonly kind: TeamAssignmentErrorKind) {
    super(TEAM_ASSIGNMENT_MESSAGES[kind]);
    this.name = 'TeamAssignmentError';
  }
}

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

/**
 * Assigns a team to a ticket: sets assigned_team_id, resolves the primary
 * assignee (existing one, else the team lead), and records the team's active
 * members as `team_member` additional agents. Returns the resolved primary
 * assignee so the caller can publish TICKET_ASSIGNED after the commit.
 */
export async function assignTeamToTicketCore(
  trx: Knex.Transaction,
  tenant: string,
  actorUserId: string,
  ticketId: string,
  teamId: string
): Promise<string> {
  const ticket = await tenantScopedTable(trx, 'tickets', tenant)
    .where({ ticket_id: ticketId })
    .first();

  if (!ticket) {
    throw new TeamAssignmentError('ticket_not_found');
  }

  const team = await tenantScopedTable(trx, 'teams', tenant)
    .where({ team_id: teamId })
    .first();

  if (!team) {
    throw new TeamAssignmentError('team_not_found');
  }

  if (!team.manager_id) {
    throw new TeamAssignmentError('team_lead_missing');
  }

  const teamMembers = await tenantDb(trx, tenant)
    .tenantJoin(
      tenantScopedTable(trx, 'team_members', tenant),
      'users',
      'team_members.user_id',
      'users.user_id'
    )
    .where({ 'team_members.team_id': teamId })
    .andWhere('users.is_inactive', false)
    .select('team_members.user_id') as Array<{ user_id: string }>;

  // assigned_to is guaranteed non-null: either the ticket already has one,
  // or we fall back to team.manager_id (validated above).
  const resolvedAssignedTo: string = (ticket.assigned_to as string | null) || team.manager_id;

  await tenantScopedTable(trx, 'tickets', tenant)
    .where({ ticket_id: ticketId })
    .update({
      assigned_team_id: teamId,
      assigned_to: resolvedAssignedTo,
      updated_by: actorUserId,
      updated_at: new Date()
    });

  const memberIds = teamMembers
    .map((member: { user_id: string }) => member.user_id)
    .filter((userId: string) => userId && userId !== resolvedAssignedTo);

  if (memberIds.length > 0) {
    const existingResources = await tenantScopedTable(trx, 'ticket_resources', tenant)
      .where({ ticket_id: ticketId })
      .whereIn('additional_user_id', memberIds)
      .select('additional_user_id');

    const existingIds = new Set(existingResources.map((row: { additional_user_id: string }) => row.additional_user_id));
    const toInsert = memberIds.filter((userId) => !existingIds.has(userId));

    if (toInsert.length > 0) {
      await tenantScopedTable(trx, 'ticket_resources', tenant).insert(
        toInsert.map((userId) => ({
          ticket_id: ticketId,
          assigned_to: resolvedAssignedTo,
          additional_user_id: userId,
          role: 'team_member',
          tenant,
          assigned_at: new Date()
        }))
      );
    }
  }

  return resolvedAssignedTo;
}

/**
 * Clears a ticket's team assignment, optionally pruning the `team_member`
 * additional agents the team assignment created.
 */
export async function removeTeamFromTicketCore(
  trx: Knex.Transaction,
  tenant: string,
  actorUserId: string,
  ticketId: string,
  options: RemoveTeamFromTicketOptions
): Promise<void> {
  const ticket = await tenantScopedTable(trx, 'tickets', tenant)
    .where({ ticket_id: ticketId })
    .first();

  if (!ticket) {
    throw new TeamAssignmentError('ticket_not_found');
  }

  const mode = options.mode;
  if (mode === 'remove_all') {
    await tenantScopedTable(trx, 'ticket_resources', tenant)
      .where({ ticket_id: ticketId, role: 'team_member' })
      .delete();
  }

  if (mode === 'selective') {
    const keepIds = new Set(options.keepUserIds ?? []);
    await tenantScopedTable(trx, 'ticket_resources', tenant)
      .where({ ticket_id: ticketId, role: 'team_member' })
      .whereNotIn('additional_user_id', Array.from(keepIds))
      .delete();
  }

  await tenantScopedTable(trx, 'tickets', tenant)
    .where({ ticket_id: ticketId })
    .update({
      assigned_team_id: null,
      updated_by: actorUserId,
      updated_at: new Date()
    });
}
