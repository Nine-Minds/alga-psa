'use server'

import { createTenantKnex } from '../../db';
import { getCurrentUser } from '../user-actions/userActions';
import type { InboundTicketDefaults } from '../../../types/email.types';

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
        'defaults',
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
  defaults: InboundTicketDefaults['defaults'];
  is_active?: boolean;
}): Promise<{ defaults: InboundTicketDefaults }> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  
  try {
    // Validate required defaults fields
    if (!data.defaults.channel_id || !data.defaults.status_id || !data.defaults.priority_id) {
      throw new Error('Channel, status, and priority are required in defaults');
    }

    const [defaults] = await knex('inbound_ticket_defaults')
      .insert({
        id: knex.raw('gen_random_uuid()'),
        tenant,
        short_name: data.short_name,
        display_name: data.display_name,
        description: data.description,
        defaults: JSON.stringify(data.defaults),
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
        'defaults',
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
    defaults?: InboundTicketDefaults['defaults'];
    is_active?: boolean;
  }
): Promise<{ defaults: InboundTicketDefaults }> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  
  try {
    // If updating defaults, validate required fields
    if (data.defaults) {
      if (!data.defaults.channel_id || !data.defaults.status_id || !data.defaults.priority_id) {
        throw new Error('Channel, status, and priority are required in defaults');
      }
    }

    const updateData: any = {
      updated_at: knex.fn.now()
    };

    if (data.short_name !== undefined) updateData.short_name = data.short_name;
    if (data.display_name !== undefined) updateData.display_name = data.display_name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.defaults !== undefined) updateData.defaults = JSON.stringify(data.defaults);
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
        'defaults',
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
    // Check if any email providers are using this defaults configuration
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