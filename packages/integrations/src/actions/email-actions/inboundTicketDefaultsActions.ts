'use server'

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import type { InboundTicketDefaults } from '@alga-psa/types';
import {
  actionError,
  type ActionMessageError,
} from '@alga-psa/ui/lib/errorHandling';

type InboundTicketDefaultsActionError = ActionMessageError;

class ExpectedInboundTicketDefaultsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpectedInboundTicketDefaultsError';
  }
}

function expectedInboundTicketDefaultsError(message: string): never {
  throw new ExpectedInboundTicketDefaultsError(message);
}

const assertTicketStatusBelongsToBoard = async (
  knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'],
  tenant: string,
  boardId: string,
  statusId: string
): Promise<void> => {
  const matchingStatus = await tenantDb(knex, tenant).table('statuses')
    .where({
      board_id: boardId,
      status_id: statusId,
      status_type: 'ticket',
    })
    .first('status_id');

  if (!matchingStatus) {
    expectedInboundTicketDefaultsError('Selected status is not valid for the selected board');
  }
};

export const getInboundTicketDefaults = withAuth(async (
  _user,
  { tenant }
): Promise<{ defaults: InboundTicketDefaults[]; error?: string }> => {
  const { knex } = await createTenantKnex();
  
  try {
    const defaults = await tenantDb(knex, tenant).table('inbound_ticket_defaults')
      .orderBy('created_at', 'desc')
      .select(
        'id',
        'tenant',
        'short_name',
        'display_name',
        'description',
        'board_id',
        'status_id',
        'priority_id',
        'client_id',
        'entered_by',
        'category_id',
        'subcategory_id',
        'location_id',
        'is_active',
        'created_at',
        'updated_at'
      );

    return { defaults };
  } catch (error) {
    console.error('Failed to load inbound ticket defaults:', error);
    return {
      defaults: [],
      error: 'Failed to load inbound ticket defaults. Please try again.'
    };
  }
});

export const createInboundTicketDefaults = withAuth(async (
  _user,
  { tenant },
  data: {
    short_name: string;
    display_name: string;
    description?: string;
    board_id?: string;
    status_id?: string;
    priority_id?: string;
    client_id?: string;
    entered_by?: string | null;
    category_id?: string;
    subcategory_id?: string;
    location_id?: string;
    is_active?: boolean;
  }
): Promise<{ defaults: InboundTicketDefaults } | InboundTicketDefaultsActionError> => {
  const { knex } = await createTenantKnex();
  
  try {
    // Normalize category/subcategory values to avoid sentinel strings
    const normalizeUuid = (v?: string | null) => (v && v !== 'no-category' ? v : null);

    // Validate required defaults fields
    if (!data.board_id || !data.status_id || !data.priority_id) {
      expectedInboundTicketDefaultsError('Board, status, and priority are required');
    }

    await assertTicketStatusBelongsToBoard(knex, tenant, data.board_id, data.status_id);

    const [defaults] = await tenantDb(knex, tenant).table('inbound_ticket_defaults')
      .insert({
        id: knex.raw('gen_random_uuid()'),
        tenant,
        short_name: data.short_name,
        display_name: data.display_name,
        description: data.description,
        board_id: data.board_id,
        status_id: data.status_id,
        priority_id: data.priority_id,
        client_id: data.client_id,
        entered_by: data.entered_by,
        category_id: normalizeUuid(data.category_id),
        subcategory_id: normalizeUuid(data.subcategory_id),
        location_id: data.location_id,
        is_active: data.is_active ?? true,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      })
      .returning([
        'id',
        'tenant',
        'short_name',
        'display_name',
        'description',
        'board_id',
        'status_id',
        'priority_id',
        'client_id',
        'entered_by',
        'category_id',
        'subcategory_id',
        'location_id',
        'is_active',
        'created_at',
        'updated_at'
      ]);

    return { defaults };
  } catch (error) {
    if (error instanceof ExpectedInboundTicketDefaultsError) {
      return actionError(error.message);
    }
    if (error instanceof Error && error.message.includes('unique')) {
      return actionError('A configuration with this short name already exists');
    }
    console.error('Unexpected failure while creating inbound ticket defaults:', error);
    return actionError('Failed to create inbound ticket defaults. Please try again.');
  }
});

export const updateInboundTicketDefaults = withAuth(async (
  _user,
  { tenant },
  id: string,
  data: {
    short_name?: string;
    display_name?: string;
    description?: string;
    board_id?: string;
    status_id?: string;
    priority_id?: string;
    client_id?: string;
    entered_by?: string | null;
    category_id?: string;
    subcategory_id?: string;
    location_id?: string;
    is_active?: boolean;
  }
): Promise<{ defaults: InboundTicketDefaults } | InboundTicketDefaultsActionError> => {
  const { knex } = await createTenantKnex();
  
  try {
    const normalizeUuid = (v?: string | null) => (v && v !== 'no-category' ? v : null);
    // If updating defaults, validate required fields
    if (data.board_id !== undefined || data.status_id !== undefined || data.priority_id !== undefined) {
      // Get current values to check if all required fields will be present after update
      const current = await tenantDb(knex, tenant).table('inbound_ticket_defaults')
        .where({ id })
        .select('board_id', 'status_id', 'priority_id')
        .first();

      if (!current) {
        return actionError('Defaults configuration not found');
      }
      
      const finalBoardId = data.board_id !== undefined ? data.board_id : current?.board_id;
      const finalStatusId = data.status_id !== undefined ? data.status_id : current?.status_id;
      const finalPriorityId = data.priority_id !== undefined ? data.priority_id : current?.priority_id;
      
      if (!finalBoardId || !finalStatusId || !finalPriorityId) {
        expectedInboundTicketDefaultsError('Board, status, and priority are required');
      }

      await assertTicketStatusBelongsToBoard(knex, tenant, finalBoardId, finalStatusId);
    }

    const updateData: any = {
      updated_at: knex.fn.now()
    };

    if (data.short_name !== undefined) updateData.short_name = data.short_name;
    if (data.display_name !== undefined) updateData.display_name = data.display_name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.board_id !== undefined) updateData.board_id = data.board_id;
    if (data.status_id !== undefined) updateData.status_id = data.status_id;
    if (data.priority_id !== undefined) updateData.priority_id = data.priority_id;
    if (data.client_id !== undefined) updateData.client_id = data.client_id;
    if (data.entered_by !== undefined) updateData.entered_by = data.entered_by;
    if (data.category_id !== undefined) updateData.category_id = normalizeUuid(data.category_id);
    if (data.subcategory_id !== undefined) updateData.subcategory_id = normalizeUuid(data.subcategory_id);
    if (data.location_id !== undefined) updateData.location_id = data.location_id;
    if (data.is_active !== undefined) updateData.is_active = data.is_active;

    const [defaults] = await tenantDb(knex, tenant).table('inbound_ticket_defaults')
      .where({ id })
      .update(updateData)
      .returning([
        'id',
        'tenant',
        'short_name',
        'display_name',
        'description',
        'board_id',
        'status_id',
        'priority_id',
        'client_id',
        'entered_by',
        'category_id',
        'subcategory_id',
        'location_id',
        'is_active',
        'created_at',
        'updated_at'
      ]);

    if (!defaults) {
      return actionError('Defaults configuration not found');
    }

    return { defaults };
  } catch (error) {
    if (error instanceof ExpectedInboundTicketDefaultsError) {
      return actionError(error.message);
    }
    if (error instanceof Error && error.message.includes('unique')) {
      return actionError('A configuration with this short name already exists');
    }
    console.error('Unexpected failure while updating inbound ticket defaults:', error);
    return actionError('Failed to update inbound ticket defaults. Please try again.');
  }
});

export const deleteInboundTicketDefaults = withAuth(async (
  _user,
  { tenant },
  id: string
): Promise<{ success: true } | InboundTicketDefaultsActionError> => {
  const { knex } = await createTenantKnex();
  
  const deletedCount = await knex.transaction<number>(async (trx) => {
    // Clear all known references before deleting the defaults row.
    // This keeps delete behavior consistent with nullable destination references.
    await tenantDb(trx, tenant).table('email_providers')
      .where({ inbound_ticket_defaults_id: id })
      .update({
        inbound_ticket_defaults_id: null,
        updated_at: trx.fn.now(),
      });

    await tenantDb(trx, tenant).table('clients')
      .where({ inbound_ticket_defaults_id: id })
      .update({
        inbound_ticket_defaults_id: null,
        updated_at: trx.fn.now(),
      });

    await tenantDb(trx, tenant).table('contacts')
      .where({ inbound_ticket_defaults_id: id })
      .update({
        inbound_ticket_defaults_id: null,
        updated_at: trx.fn.now(),
      });

    const rowsDeleted = await tenantDb(trx, tenant).table('inbound_ticket_defaults')
      .where({ id })
      .delete();

    return Number(rowsDeleted);
  });

  if (deletedCount === 0) {
    return actionError('Defaults configuration not found');
  }

  return { success: true };
});

export const getInboundTicketDefaultsById = withAuth(async (
  _user,
  { tenant },
  id: string
): Promise<{ defaults: InboundTicketDefaults | null; error?: string }> => {
  const { knex } = await createTenantKnex();
  
  try {
    const defaults = await tenantDb(knex, tenant).table('inbound_ticket_defaults')
      .where({ id })
      .select(
        'id',
        'tenant',
        'short_name',
        'display_name',
        'description',
        'defaults',
        'is_active',
        'created_at',
        'updated_at'
      )
      .first();

    return { defaults: defaults || null };
  } catch (error) {
    console.error('Failed to load inbound ticket defaults:', error);
    return {
      defaults: null,
      error: 'Failed to load inbound ticket defaults. Please try again.'
    };
  }
});
