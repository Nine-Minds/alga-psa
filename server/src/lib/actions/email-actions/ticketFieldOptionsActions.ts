'use server'

import { createTenantKnex } from '../../db';
import { getCurrentUser } from '../user-actions/userActions';
import type { TicketFieldOptions } from '../../../types/email.types';
import { hasPermission } from '../../auth/rbac';

export async function getTicketFieldOptions(): Promise<{ options: TicketFieldOptions }> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  // RBAC: require ticket settings read permission
  const permitted = await hasPermission(user, 'ticket_settings', 'read', knex);
  if (!permitted) {
    throw new Error('Unauthorized');
  }
  
  try {
    // Get all ticket field options in parallel
    const [
      channels,
      statuses,
      priorities,
      categories,
      companies,
      users,
      locations
    ] = await Promise.all([
      // Channels
      knex('channels')
        .where({ tenant })
        .orderBy('display_order', 'asc')
        .select('channel_id as id', 'channel_name as name', 'is_default')
        .then(rows => rows.map(row => ({ 
          id: row.id, 
          name: row.name, 
          is_default: Boolean(row.is_default) 
        }))),

      // Statuses (ticket-only)
      knex('statuses')
        .where({ tenant, status_type: 'ticket' })
        .orderBy('order_number', 'asc')
        .orderBy('name', 'asc')
        .select('status_id as id', 'name', 'is_default')
        .then(rows => rows.map(row => ({ 
          id: row.id, 
          name: row.name,
          is_default: Boolean(row.is_default)
        }))),

      // Priorities (ticket-only; no is_default column)
      knex('priorities')
        .where({ tenant, item_type: 'ticket' })
        .orderBy('order_number', 'asc')
        .orderBy('priority_name', 'asc')
        .select('priority_id as id', 'priority_name as name')
        .then(rows => rows.map(row => ({ 
          id: row.id, 
          name: row.name
        }))),

      // Categories (including subcategories) - parent_category is the correct column
      knex('categories')
        .where({ tenant })
        .orderBy('display_order', 'asc')
        .orderBy('category_name', 'asc')
        .select('category_id as id', 'category_name as name', 'parent_category as parent_id', 'channel_id')
        .then(rows => rows.map(row => ({ 
          id: row.id, 
          name: row.name,
          parent_id: row.parent_id,
          channel_id: row.channel_id
        }))),

      // Companies
      knex('companies')
        .where({ tenant })
        .orderBy('company_name', 'asc')
        .select('company_id as id', 'company_name as name')
        .then(rows => rows.map(row => ({ 
          id: row.id, 
          name: row.name
        }))),

      // Users
      knex('users')
        .where({ tenant })
        .orderBy('first_name', 'asc')
        .orderBy('last_name', 'asc')
        .select('user_id as id', 'username')
        .select(knex.raw("CONCAT(first_name, ' ', last_name) as name"))
        .then(rows => rows.map(row => ({ 
          id: row.id, 
          name: row.name || row.username,
          username: row.username
        }))),

      // Locations (stored in company_locations)
      knex('company_locations')
        .where({ tenant })
        .orderBy('location_name', 'asc')
        .select('location_id as id', 'location_name as name', 'company_id')
        .then(rows => rows.map(row => ({ 
          id: row.id, 
          name: row.name,
          company_id: row.company_id
        })))
    ]);

    console.log('categories', categories);

    return {
      options: {
        channels: channels || [],
        statuses: statuses || [],
        priorities: priorities || [],
        categories: categories || [],
        companies: companies || [],
        users: users || [],
        locations: locations || []
      }
    };
  } catch (error) {
    console.error('Failed to load ticket field options:', error);
    return {
      options: {
        channels: [],
        statuses: [],
        priorities: [],
        categories: [],
        companies: [],
        users: [],
        locations: []
      }
    };
  }
}

export async function getAvailableChannels(): Promise<{ channels: TicketFieldOptions['channels'] }> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  const permitted = await hasPermission(user, 'ticket_settings', 'read', knex);
  if (!permitted) {
    throw new Error('Unauthorized');
  }
  
  try {
    const channels = await knex('channels')
      .where({ tenant })
      .orderBy('display_order', 'asc')
      .select('channel_id as id', 'channel_name as name', 'is_default')
      .then(rows => rows.map(row => ({ 
        id: row.id, 
        name: row.name, 
        is_default: Boolean(row.is_default) 
      })));

    return { channels };
  } catch (error) {
    console.error('Failed to load channels:', error);
    return { channels: [] };
  }
}

export async function getAvailableStatuses(): Promise<{ statuses: TicketFieldOptions['statuses'] }> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  const permitted = await hasPermission(user, 'ticket_settings', 'read', knex);
  if (!permitted) {
    throw new Error('Unauthorized');
  }
  
  try {
    const statuses = await knex('statuses')
      .where({ tenant, status_type: 'ticket' })
      .orderBy('order_number', 'asc')
      .orderBy('name', 'asc')
      .select('status_id as id', 'name', 'is_default')
      .then(rows => rows.map(row => ({ 
        id: row.id, 
        name: row.name,
        is_default: Boolean(row.is_default)
      })));

    return { statuses };
  } catch (error) {
    console.error('Failed to load statuses:', error);
    return { statuses: [] };
  }
}

export async function getAvailablePriorities(): Promise<{ priorities: TicketFieldOptions['priorities'] }> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  const permitted = await hasPermission(user, 'ticket_settings', 'read', knex);
  if (!permitted) {
    throw new Error('Unauthorized');
  }
  
  try {
    const priorities = await knex('priorities')
      .where({ tenant, item_type: 'ticket' })
      .orderBy('order_number', 'asc')
      .orderBy('priority_name', 'asc')
      .select('priority_id as id', 'priority_name as name')
      .then(rows => rows.map(row => ({ 
        id: row.id, 
        name: row.name
      })));

    return { priorities };
  } catch (error) {
    console.error('Failed to load priorities:', error);
    return { priorities: [] };
  }
}

export async function getAvailableCategories(): Promise<{ categories: TicketFieldOptions['categories'] }> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  const permitted = await hasPermission(user, 'ticket_settings', 'read', knex);
  if (!permitted) {
    throw new Error('Unauthorized');
  }
  
  try {
    const categories = await knex('categories')
      .where({ tenant })
      .orderBy('display_order', 'asc')
      .orderBy('category_name', 'asc')
      .select('category_id as id', 'category_name as name', 'parent_category as parent_id', 'channel_id')
      .then(rows => rows.map(row => ({ 
        id: row.id,
        name: row.name,
        parent_id: row.parent_id,
        channel_id: row.channel_id
      })));

    return { categories };
  } catch (error) {
    console.error('Failed to load categories:', error);
    return { categories: [] };
  }
}

// Server-side filtered categories by channel
export async function getCategoriesByChannel(channelId: string | null): Promise<{ categories: TicketFieldOptions['categories'] }> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  const permitted = await hasPermission(user, 'ticket_settings', 'read', knex);
  if (!permitted) {
    throw new Error('Unauthorized');
  }

  try {
    console.log('[TicketFieldOptions] getCategoriesByChannel: start', {
      tenant,
      channelId
    });

    if (!channelId) {
      console.log('[TicketFieldOptions] getCategoriesByChannel: no channelId provided, returning empty list');
      return { categories: [] };
    }

    console.time('[TicketFieldOptions] getCategoriesByChannel:query');
    const rows = await knex('categories')
      .where({ tenant, channel_id: channelId })
      .orderBy('display_order', 'asc')
      .orderBy('category_name', 'asc')
      .select('category_id as id', 'category_name as name', 'parent_category as parent_id', 'channel_id')
    console.timeEnd('[TicketFieldOptions] getCategoriesByChannel:query');

    const categories = rows.map(row => ({
      id: row.id,
      name: row.name,
      parent_id: row.parent_id,
      channel_id: row.channel_id
    }));

    const total = categories.length;
    const topLevel = categories.filter(c => !c.parent_id).length;
    const withParents = total - topLevel;
    const sample = categories.slice(0, Math.min(5, total));

    console.log('[TicketFieldOptions] getCategoriesByChannel: results', {
      tenant,
      channelId,
      total,
      topLevel,
      withParents,
      sample
    });

    return { categories };
  } catch (error) {
    console.error('[TicketFieldOptions] getCategoriesByChannel: error', {
      tenant,
      channelId,
      error
    });
    return { categories: [] };
  }
}

export async function getAvailableCompanies(): Promise<{ companies: TicketFieldOptions['companies'] }> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  const permitted = await hasPermission(user, 'ticket_settings', 'read', knex);
  if (!permitted) {
    throw new Error('Unauthorized');
  }
  
  try {
    const companies = await knex('companies')
      .where({ tenant })
      .orderBy('company_name', 'asc')
      .select('company_id as id', 'company_name as name')
      .then(rows => rows.map(row => ({ 
        id: row.id, 
        name: row.name
      })));

    return { companies };
  } catch (error) {
    console.error('Failed to load companies:', error);
    return { companies: [] };
  }
}

export async function getAvailableUsers(): Promise<{ users: TicketFieldOptions['users'] }> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  const permitted = await hasPermission(user, 'ticket_settings', 'read', knex);
  if (!permitted) {
    throw new Error('Unauthorized');
  }
  
  try {
    const users = await knex('users')
      .where({ tenant })
      .orderBy('first_name', 'asc')
      .orderBy('last_name', 'asc')
      .select('user_id as id', 'username')
      .select(knex.raw("CONCAT(first_name, ' ', last_name) as name"))
      .then(rows => rows.map(row => ({ 
        id: row.id, 
        name: row.name || row.username,
        username: row.username
      })));

    return { users };
  } catch (error) {
    console.error('Failed to load users:', error);
    return { users: [] };
  }
}
