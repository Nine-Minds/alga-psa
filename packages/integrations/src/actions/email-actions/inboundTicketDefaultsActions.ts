'use server'

import { createTenantKnex } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/users/actions';
import type { InboundTicketDefaults } from '@alga-psa/types';

export async function getInboundTicketDefaults(): Promise<{ defaults: InboundTicketDefaults[] }> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  
  try {
    const defaults = await knex('inbound_ticket_defaults')
      .where({ tenant })
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
    return { defaults: [] };
  }
}

export async function createInboundTicketDefaults(data: {
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
}): Promise<{ defaults: InboundTicketDefaults }> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  
  try {
    // Normalize category/subcategory values to avoid sentinel strings
    const normalizeUuid = (v?: string | null) => (v && v !== 'no-category' ? v : null);

    // Validate required defaults fields
    if (!data.board_id || !data.status_id || !data.priority_id) {
      throw new Error('Board, status, and priority are required');
    }

    const [defaults] = await knex('inbound_ticket_defaults')
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
    console.error('Failed to create inbound ticket defaults:', error);
    if (error instanceof Error && error.message.includes('unique')) {
      throw new Error('A configuration with this short name already exists');
    }
    throw new Error('Failed to create inbound ticket defaults');
  }
}

export async function updateInboundTicketDefaults(
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
): Promise<{ defaults: InboundTicketDefaults }> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  
  try {
    const normalizeUuid = (v?: string | null) => (v && v !== 'no-category' ? v : null);
    // If updating defaults, validate required fields
    if (data.board_id !== undefined || data.status_id !== undefined || data.priority_id !== undefined) {
      // Get current values to check if all required fields will be present after update
      const current = await knex('inbound_ticket_defaults')
        .where({ id, tenant })
        .select('board_id', 'status_id', 'priority_id')
        .first();
      
      const finalBoardId = data.board_id !== undefined ? data.board_id : current?.board_id;
      const finalStatusId = data.status_id !== undefined ? data.status_id : current?.status_id;
      const finalPriorityId = data.priority_id !== undefined ? data.priority_id : current?.priority_id;
      
      if (!finalBoardId || !finalStatusId || !finalPriorityId) {
        throw new Error('Board, status, and priority are required');
      }
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

    const [defaults] = await knex('inbound_ticket_defaults')
      .where({ id, tenant })
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
      throw new Error('Defaults configuration not found');
    }

    return { defaults };
  } catch (error) {
    console.error('Failed to update inbound ticket defaults:', error);
    if (error instanceof Error && error.message.includes('unique')) {
      throw new Error('A configuration with this short name already exists');
    }
    throw new Error('Failed to update inbound ticket defaults');
  }
}

export async function deleteInboundTicketDefaults(id: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  
  try {
    // Prevent delete if any email providers reference this defaults configuration
    const providersUsing = await knex('email_providers')
      .where({ tenant, inbound_ticket_defaults_id: id })
      .count('* as count')
      .first();

    if (providersUsing && Number(providersUsing.count) > 0) {
      throw new Error('Cannot delete defaults configuration that is being used by email providers');
    }

    const result = await knex('inbound_ticket_defaults')
      .where({ id, tenant })
      .delete();

    if (result === 0) {
      throw new Error('Defaults configuration not found');
    }
  } catch (error) {
    console.error('Failed to delete inbound ticket defaults:', error);
    throw new Error(error instanceof Error ? error.message : 'Failed to delete inbound ticket defaults');
  }
}

export async function getInboundTicketDefaultsById(id: string): Promise<{ defaults: InboundTicketDefaults | null }> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  
  try {
    const defaults = await knex('inbound_ticket_defaults')
      .where({ id, tenant })
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
    return { defaults: null };
  }
}
