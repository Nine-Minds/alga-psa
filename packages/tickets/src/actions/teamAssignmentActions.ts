'use server';

import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { revalidatePath } from 'next/cache';
import { Knex } from 'knex';

export const assignTeamToTicket = withAuth(async (
  user,
  { tenant },
  ticketId: string,
  teamId: string
): Promise<void> => {
  const { knex: db } = await createTenantKnex();
  const assignedTo = await withTransaction(db, async (trx: Knex.Transaction) => {
    if (!await hasPermission(user, 'ticket', 'update', trx)) {
      throw new Error('Permission denied: Cannot assign team to ticket');
    }

    const ticket = await trx('tickets')
      .where({ ticket_id: ticketId, tenant })
      .first();

    if (!ticket) {
      throw new Error('Ticket not found');
    }

    const team = await trx('teams')
      .where({ team_id: teamId, tenant })
      .first();

    if (!team) {
      throw new Error('Team not found');
    }

    if (!team.manager_id) {
      throw new Error('Team lead not found');
    }

    const teamMembers = await trx('team_members')
      .join('users', function() {
        this.on('team_members.user_id', 'users.user_id')
          .andOn('team_members.tenant', 'users.tenant');
      })
      .where({ 'team_members.team_id': teamId, 'team_members.tenant': tenant })
      .andWhere('users.is_inactive', false)
      .select('team_members.user_id');

    // assigned_to is guaranteed non-null: either the ticket already has one,
    // or we fall back to team.manager_id (validated above).
    const resolvedAssignedTo: string = (ticket.assigned_to as string | null) || team.manager_id;

    await trx('tickets')
      .where({ ticket_id: ticketId, tenant })
      .update({
        assigned_team_id: teamId,
        assigned_to: resolvedAssignedTo,
        updated_by: user.user_id,
        updated_at: new Date()
      });

    const memberIds = teamMembers
      .map((member: { user_id: string }) => member.user_id)
      .filter((userId: string) => userId && userId !== resolvedAssignedTo);

    if (memberIds.length > 0) {
      const existingResources = await trx('ticket_resources')
        .where({ ticket_id: ticketId, tenant })
        .whereIn('additional_user_id', memberIds)
        .select('additional_user_id');

      const existingIds = new Set(existingResources.map((row: { additional_user_id: string }) => row.additional_user_id));
      const toInsert = memberIds.filter((userId) => !existingIds.has(userId));

      if (toInsert.length > 0) {
        await trx('ticket_resources').insert(
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
  });

  // Emit event after transaction commits so subscribers can see the data
  await publishEvent({
    eventType: 'TICKET_ASSIGNED',
    payload: {
      tenantId: tenant,
      ticketId,
      userId: assignedTo,
      assignedByUserId: user.user_id,
      changes: { assigned_team_id: teamId }
    }
  });

  // Invalidate ticket list cache so team badge appears on navigation back
  revalidatePath('/msp/tickets');
});

export type RemoveTeamFromTicketMode = 'remove_all' | 'keep_all' | 'selective';

export interface RemoveTeamFromTicketOptions {
  mode: RemoveTeamFromTicketMode;
  keepUserIds?: string[];
}

export const removeTeamFromTicket = withAuth(async (
  user,
  { tenant },
  ticketId: string,
  options: RemoveTeamFromTicketOptions
): Promise<void> => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    if (!await hasPermission(user, 'ticket', 'update', trx)) {
      throw new Error('Permission denied: Cannot remove team from ticket');
    }

    const ticket = await trx('tickets')
      .where({ ticket_id: ticketId, tenant })
      .first();

    if (!ticket) {
      throw new Error('Ticket not found');
    }

    const mode = options.mode;
    if (mode === 'remove_all') {
      await trx('ticket_resources')
        .where({ ticket_id: ticketId, tenant, role: 'team_member' })
        .delete();
    }

    if (mode === 'selective') {
      const keepIds = new Set(options.keepUserIds ?? []);
      await trx('ticket_resources')
        .where({ ticket_id: ticketId, tenant, role: 'team_member' })
        .whereNotIn('additional_user_id', Array.from(keepIds))
        .delete();
    }

    await trx('tickets')
      .where({ ticket_id: ticketId, tenant })
      .update({
        assigned_team_id: null,
        updated_by: user.user_id,
        updated_at: new Date()
      });
  });

  // Invalidate ticket list cache so team badge removal is reflected
  revalidatePath('/msp/tickets');
});
