import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { HumanWorkAssigneeInvalidError, assertHumanWorkAssignee } from '../humanWork/assertHumanWorkAssignee';
import type { CreateTicketInput } from '../../models/ticketModel';
import { assignTeamToTicketCore, TeamAssignmentError } from '../../services/tickets/teamAssignmentCore';

export interface ResolvedBoardDefaults {
  assignedTo?: string;
  defaultTeamId?: string;
}

/**
 * Resolve only omitted routing fields from board defaults. Explicit null means
 * the caller requested an unassigned ticket and is preserved for both fields.
 * Team defaults are applied only when neither routing field was supplied, so a
 * team lead cannot silently replace an explicit user (including explicit null).
 */
export async function resolveBoardDefaultRouting(
  trx: Knex.Transaction,
  tenant: string,
  input: Pick<CreateTicketInput, 'board_id' | 'assigned_to' | 'assigned_team_id'>,
): Promise<ResolvedBoardDefaults> {
  if (!input.board_id) return {};

  const board = await tenantDb(trx, tenant)
    .table('boards')
    .where({ board_id: input.board_id })
    .first('default_assigned_to', 'default_assigned_team_id');
  if (!board) return {};

  const defaults: ResolvedBoardDefaults = {};
  if (input.assigned_to === undefined && board.default_assigned_to) {
    try {
      await assertHumanWorkAssignee(trx, tenant, [board.default_assigned_to]);
      defaults.assignedTo = board.default_assigned_to;
    } catch (error) {
      if (!(error instanceof HumanWorkAssigneeInvalidError)) throw error;
      console.warn('Ignoring stale board default assignee during ticket creation', {
        tenant, boardId: input.board_id, assignedTo: board.default_assigned_to,
      });
    }
  }

  // Explicit null is an instruction to keep the ticket unassigned. An explicit
  // user likewise opts out of the board's team, which would otherwise install
  // a team lead as the primary assignee.
  if (input.assigned_to === undefined && input.assigned_team_id === undefined && board.default_assigned_team_id) {
    defaults.defaultTeamId = board.default_assigned_team_id;
  }

  return defaults;
}

/** Apply a board's team default using the normal team assignment semantics. */
export async function applyBoardDefaultTeam(
  trx: Knex.Transaction,
  tenant: string,
  actorUserId: string | null,
  ticketId: string,
  teamId: string,
  boardId: string,
): Promise<void> {
  try {
    await assignTeamToTicketCore(trx, tenant, actorUserId, ticketId, teamId);
  } catch (error) {
    const isStaleDefault =
      (error instanceof TeamAssignmentError && ['team_not_found', 'team_lead_missing'].includes(error.kind)) ||
      error instanceof HumanWorkAssigneeInvalidError;
    if (!isStaleDefault) throw error;
    console.warn('Ignoring stale board default team during ticket creation', {
      tenant, boardId, ticketId, teamId,
      reason: error instanceof TeamAssignmentError ? error.kind : 'invalid_team_assignee',
    });
  }
}
