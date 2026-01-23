'use server'

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import type { TicketFieldOptions } from '@alga-psa/types';
import { hasPermission } from '@alga-psa/auth/rbac';

export const getTicketFieldOptions = withAuth(async (
  user,
  { tenant }
): Promise<{ options: TicketFieldOptions }> => {
  const { knex } = await createTenantKnex();
  // RBAC: require ticket settings read permission
  const permitted = await hasPermission(user, 'ticket_settings', 'read', knex);
  if (!permitted) {
    throw new Error('Unauthorized');
  }
  
  try {
    // Get all ticket field options in parallel
    const [
      boards,
      statuses,
      priorities,
      categories,
      clients,
      users,
      locations
    ] = await Promise.all([
      // Boards
      knex('boards')
        .where({ tenant })
        .orderBy('display_order', 'asc')
        .select('board_id as id', 'board_name as name', 'is_default')
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
        .select('category_id as id', 'category_name as name', 'parent_category as parent_id', 'board_id')
        .then(rows => rows.map(row => ({ 
          id: row.id, 
          name: row.name,
          parent_id: row.parent_id,
          board_id: row.board_id
        }))),

      // Clients
      knex('clients')
        .where({ tenant })
        .orderBy('client_name', 'asc')
        .select('client_id as id', 'client_name as name')
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

      // Locations (stored in client_locations)
      knex('client_locations')
        .where({ tenant })
        .orderBy('location_name', 'asc')
        .select('location_id as id', 'location_name as name', 'client_id')
        .then(rows => rows.map(row => ({ 
          id: row.id, 
          name: row.name,
          client_id: row.client_id
        })))
    ]);

    console.log('categories', categories);

    return {
      options: {
        boards: boards || [],
        statuses: statuses || [],
        priorities: priorities || [],
        categories: categories || [],
        clients: clients || [],
        users: users || [],
        locations: locations || []
      }
    };
  } catch (error) {
    console.error('Failed to load ticket field options:', error);
    return {
      options: {
        boards: [],
        statuses: [],
        priorities: [],
        categories: [],
        clients: [],
        users: [],
        locations: []
      }
    };
  }
});

export const getAvailableBoards = withAuth(async (
  user,
  { tenant }
): Promise<{ boards: TicketFieldOptions['boards'] }> => {
  const { knex } = await createTenantKnex();
  const permitted = await hasPermission(user, 'ticket_settings', 'read', knex);
  if (!permitted) {
    throw new Error('Unauthorized');
  }
  
  try {
    const boards = await knex('boards')
      .where({ tenant })
      .orderBy('display_order', 'asc')
      .select('board_id as id', 'board_name as name', 'is_default')
      .then(rows => rows.map(row => ({ 
        id: row.id, 
        name: row.name, 
        is_default: Boolean(row.is_default) 
      })));

    return { boards };
  } catch (error) {
    console.error('Failed to load boards:', error);
    return { boards: [] };
  }
});

export const getAvailableStatuses = withAuth(async (
  user,
  { tenant }
): Promise<{ statuses: TicketFieldOptions['statuses'] }> => {
  const { knex } = await createTenantKnex();
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
});

export const getAvailablePriorities = withAuth(async (
  user,
  { tenant }
): Promise<{ priorities: TicketFieldOptions['priorities'] }> => {
  const { knex } = await createTenantKnex();
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
});

export const getAvailableCategories = withAuth(async (
  user,
  { tenant }
): Promise<{ categories: TicketFieldOptions['categories'] }> => {
  const { knex } = await createTenantKnex();
  const permitted = await hasPermission(user, 'ticket_settings', 'read', knex);
  if (!permitted) {
    throw new Error('Unauthorized');
  }
  
  try {
    const categories = await knex('categories')
      .where({ tenant })
      .orderBy('display_order', 'asc')
      .orderBy('category_name', 'asc')
      .select('category_id as id', 'category_name as name', 'parent_category as parent_id', 'board_id')
      .then(rows => rows.map(row => ({ 
        id: row.id,
        name: row.name,
        parent_id: row.parent_id,
        board_id: row.board_id
      })));

    return { categories };
  } catch (error) {
    console.error('Failed to load categories:', error);
    return { categories: [] };
  }
});

// Server-side filtered categories by board
export const getCategoriesByBoard = withAuth(async (
  user,
  { tenant },
  boardId: string | null
): Promise<{ categories: TicketFieldOptions['categories'] }> => {
  const { knex } = await createTenantKnex();
  const permitted = await hasPermission(user, 'ticket_settings', 'read', knex);
  if (!permitted) {
    throw new Error('Unauthorized');
  }

  try {
    console.log('[TicketFieldOptions] getCategoriesByBoard: start', {
      tenant,
      boardId
    });

    if (!boardId) {
      console.log('[TicketFieldOptions] getCategoriesByBoard: no boardId provided, returning empty list');
      return { categories: [] };
    }

    console.time('[TicketFieldOptions] getCategoriesByBoard:query');
    const rows = await knex('categories')
      .where({ tenant, board_id: boardId })
      .orderBy('display_order', 'asc')
      .orderBy('category_name', 'asc')
      .select('category_id as id', 'category_name as name', 'parent_category as parent_id', 'board_id')
    console.timeEnd('[TicketFieldOptions] getCategoriesByBoard:query');

    const categories = rows.map(row => ({
      id: row.id,
      name: row.name,
      parent_id: row.parent_id,
      board_id: row.board_id
    }));

    const total = categories.length;
    const topLevel = categories.filter(c => !c.parent_id).length;
    const withParents = total - topLevel;
    const sample = categories.slice(0, Math.min(5, total));

    console.log('[TicketFieldOptions] getCategoriesByBoard: results', {
      tenant,
      boardId,
      total,
      topLevel,
      withParents,
      sample
    });

    return { categories };
  } catch (error) {
    console.error('[TicketFieldOptions] getCategoriesByBoard: error', {
      tenant,
      boardId,
      error
    });
    return { categories: [] };
  }
});

export const getAvailableClients = withAuth(async (
  user,
  { tenant }
): Promise<{ clients: TicketFieldOptions['clients'] }> => {
  const { knex } = await createTenantKnex();
  const permitted = await hasPermission(user, 'ticket_settings', 'read', knex);
  if (!permitted) {
    throw new Error('Unauthorized');
  }
  
  try {
    const clients = await knex('clients')
      .where({ tenant })
      .orderBy('client_name', 'asc')
      .select('client_id as id', 'client_name as name')
      .then(rows => rows.map(row => ({ 
        id: row.id, 
        name: row.name
      })));

    return { clients };
  } catch (error) {
    console.error('Failed to load clients:', error);
    return { clients: [] };
  }
});

export const getAvailableUsers = withAuth(async (
  user,
  { tenant }
): Promise<{ users: TicketFieldOptions['users'] }> => {
  const { knex } = await createTenantKnex();
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
});
