'use server'

import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { Knex } from 'knex';
import {
  TICKET_ACTIVITY_ACTOR,
  TICKET_ACTIVITY_ENTITY,
  TICKET_ACTIVITY_EVENT,
  TICKET_ACTIVITY_SOURCE,
  writeTicketActivity,
} from '@alga-psa/shared/lib/ticketActivity';
import { checklistActionErrorFrom, type ChecklistActionError } from './checklistActionErrors';

/**
 * Live checklist items on a ticket. Checking an item permanently records who
 * checked it and when (completed_by / completed_at); unchecking clears both
 * but preserves the prior signoff in the audit log.
 * See docs/plans/2026-06-10-ticket-close-rules/PRD.md §5.2.
 */

export interface ITicketChecklistItem {
  checklist_item_id: string;
  ticket_id: string;
  item_name: string;
  description: string | null;
  order_number: number;
  assigned_to: string | null;
  is_required: boolean;
  completed: boolean;
  completed_by: string | null;
  completed_at: string | null;
  source: 'manual' | 'template' | 'workflow';
  template_id: string | null;
  completed_by_name?: string | null;
}

export interface ChecklistItemInput {
  item_name: string;
  description?: string | null;
  assigned_to?: string | null;
  is_required?: boolean;
}

function displayName(user: { first_name?: string | null; last_name?: string | null; username?: string }): string {
  return [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.username || '';
}

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

async function requireTicket(trx: Knex.Transaction | Knex, tenant: string, ticketId: string) {
  const ticket = await tenantScopedTable(trx, 'tickets', tenant).where({ ticket_id: ticketId }).first();
  if (!ticket) {
    throw new Error('Ticket not found');
  }
  return ticket;
}

export const getTicketChecklistItems = withAuth(
  async (_user, { tenant }, ticketId: string): Promise<ITicketChecklistItem[]> => {
    const { knex: db } = await createTenantKnex();
    return tenantDb(db, tenant)
      .tenantJoin(
        tenantScopedTable(db, 'ticket_checklist_items as tci', tenant),
        'users as u',
        'u.user_id',
        'tci.completed_by',
        { type: 'left' }
      )
      .where({ 'tci.ticket_id': ticketId })
      .orderBy('tci.order_number', 'asc')
      .select(
        'tci.checklist_item_id',
        'tci.ticket_id',
        'tci.item_name',
        'tci.description',
        'tci.order_number',
        'tci.assigned_to',
        'tci.is_required',
        'tci.completed',
        'tci.completed_by',
        'tci.completed_at',
        'tci.source',
        'tci.template_id',
        db.raw("NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') as completed_by_name")
      );
  }
);

export const addChecklistItem = withAuth(
  async (user, { tenant }, ticketId: string, input: ChecklistItemInput): Promise<ITicketChecklistItem | ChecklistActionError> => {
    try {
      if (!(await hasPermission(user, 'ticket', 'update'))) {
        throw new Error('Permission denied: Cannot update ticket checklist');
      }
      if (!input.item_name || !input.item_name.trim()) {
        throw new Error('Checklist item name is required');
      }

      const { knex: db } = await createTenantKnex();
      return await withTransaction(db, async (trx: Knex.Transaction) => {
        await requireTicket(trx, tenant, ticketId);

        const maxOrder = await tenantScopedTable(trx, 'ticket_checklist_items', tenant)
          .where({ ticket_id: ticketId })
          .max('order_number as max')
          .first();

        const [row] = await tenantScopedTable(trx, 'ticket_checklist_items', tenant)
          .insert({
            tenant,
            ticket_id: ticketId,
            item_name: input.item_name.trim(),
            description: input.description ?? null,
            assigned_to: input.assigned_to || null,
            is_required: input.is_required ?? true,
            order_number: (maxOrder?.max ?? -1) + 1,
            source: 'manual',
            created_by: user.user_id,
          })
          .returning('*');
        return row;
      });
    } catch (error) {
      const expected = checklistActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
    }
  }
);

export const updateChecklistItem = withAuth(
  async (user, { tenant }, itemId: string, input: Partial<ChecklistItemInput>): Promise<ITicketChecklistItem | ChecklistActionError> => {
    try {
      if (!(await hasPermission(user, 'ticket', 'update'))) {
        throw new Error('Permission denied: Cannot update ticket checklist');
      }

      const { knex: db } = await createTenantKnex();
      return await withTransaction(db, async (trx: Knex.Transaction) => {
        const existing = await tenantScopedTable(trx, 'ticket_checklist_items', tenant)
          .where({ checklist_item_id: itemId })
          .first();
        if (!existing) {
          throw new Error('Checklist item not found');
        }

        const updates: Record<string, unknown> = { updated_at: trx.fn.now() };
        if (input.item_name !== undefined) {
          if (!input.item_name.trim()) throw new Error('Checklist item name is required');
          updates.item_name = input.item_name.trim();
        }
        if (input.description !== undefined) updates.description = input.description;
        if (input.assigned_to !== undefined) updates.assigned_to = input.assigned_to || null;
        if (input.is_required !== undefined) updates.is_required = input.is_required;

        const [row] = await tenantScopedTable(trx, 'ticket_checklist_items', tenant)
          .where({ checklist_item_id: itemId })
          .update(updates)
          .returning('*');
        return row;
      });
    } catch (error) {
      const expected = checklistActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
    }
  }
);

export const deleteChecklistItem = withAuth(
  async (user, { tenant }, itemId: string): Promise<void | ChecklistActionError> => {
    try {
      if (!(await hasPermission(user, 'ticket', 'update'))) {
        throw new Error('Permission denied: Cannot update ticket checklist');
      }

      const { knex: db } = await createTenantKnex();
      const deleted = await tenantScopedTable(db, 'ticket_checklist_items', tenant).where({ checklist_item_id: itemId }).del();
      if (!deleted) {
        throw new Error('Checklist item not found');
      }
    } catch (error) {
      const expected = checklistActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
    }
  }
);

export const reorderChecklistItems = withAuth(
  async (user, { tenant }, ticketId: string, orderedItemIds: string[]): Promise<void | ChecklistActionError> => {
    try {
      if (!(await hasPermission(user, 'ticket', 'update'))) {
        throw new Error('Permission denied: Cannot update ticket checklist');
      }

      const { knex: db } = await createTenantKnex();
      await withTransaction(db, async (trx: Knex.Transaction) => {
        await requireTicket(trx, tenant, ticketId);
        for (let i = 0; i < orderedItemIds.length; i++) {
          const updated = await tenantScopedTable(trx, 'ticket_checklist_items', tenant)
            .where({ ticket_id: ticketId, checklist_item_id: orderedItemIds[i] })
            .update({ order_number: i, updated_at: trx.fn.now() });
          if (!updated) {
            throw new Error('Checklist item not found');
          }
        }
      });
    } catch (error) {
      const expected = checklistActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
    }
  }
);

export const setChecklistItemCompleted = withAuth(
  async (user, { tenant }, itemId: string, completed: boolean): Promise<ITicketChecklistItem | ChecklistActionError> => {
    try {
      if (!(await hasPermission(user, 'ticket', 'update'))) {
        throw new Error('Permission denied: Cannot update ticket checklist');
      }

      const { knex: db } = await createTenantKnex();
      return await withTransaction(db, async (trx: Knex.Transaction) => {
        const existing = await tenantScopedTable(trx, 'ticket_checklist_items', tenant)
          .where({ checklist_item_id: itemId })
          .first();
        if (!existing) {
          throw new Error('Checklist item not found');
        }
        if (existing.completed === completed) {
          return existing;
        }

        const now = new Date().toISOString();
        const [row] = await tenantScopedTable(trx, 'ticket_checklist_items', tenant)
          .where({ checklist_item_id: itemId })
          .update({
            completed,
            completed_by: completed ? user.user_id : null,
            completed_at: completed ? now : null,
            updated_at: trx.fn.now(),
          })
          .returning('*');

        await writeTicketActivity(trx, {
          tenant,
          ticketId: existing.ticket_id,
          eventType: completed
            ? TICKET_ACTIVITY_EVENT.CHECKLIST_ITEM_COMPLETED
            : TICKET_ACTIVITY_EVENT.CHECKLIST_ITEM_UNCOMPLETED,
          entityType: TICKET_ACTIVITY_ENTITY.CHECKLIST_ITEM,
          entityId: itemId,
          actor: {
            actorType: TICKET_ACTIVITY_ACTOR.USER,
            userId: user.user_id,
            displayName: displayName(user),
          },
          source: TICKET_ACTIVITY_SOURCE.UI,
          occurredAt: now,
          details: {
            item_name: existing.item_name,
            is_required: existing.is_required,
            // On uncheck, preserve whose signoff was removed.
            ...(completed
              ? {}
              : {
                  previous_completed_by: existing.completed_by,
                  previous_completed_at: existing.completed_at,
                }),
          },
        });

        return row;
      });
    } catch (error) {
      const expected = checklistActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
    }
  }
);
