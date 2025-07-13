'use server'

import { createTenantKnex } from '../../db';
import { getCurrentUser } from '../user-actions/userActions';
import type { TicketFieldOptions } from '../../../types/email.types';

export async function getTicketFieldOptions(): Promise<{ options: TicketFieldOptions }> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  
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

      // Statuses  
      knex('statuses')
        .where({ tenant })
        .orderBy('name', 'asc')
        .select('status_id as id', 'name', 'is_default')
        .then(rows => rows.map(row => ({ 
          id: row.id, 
          name: row.name,
          is_default: Boolean(row.is_default)
        }))),

      // Priorities
      knex('priorities')
        .where({ tenant })
        .orderBy('priority_name', 'asc')
        .select('priority_id as id', 'priority_name as name', 'is_default')
        .then(rows => rows.map(row => ({ 
          id: row.id, 
          name: row.name,
          is_default: Boolean(row.is_default)
        }))),

      // Categories (including subcategories)
      knex('categories')
        .where({ tenant })
        .orderBy('category_name', 'asc')
        .select('category_id as id', 'category_name as name', 'parent_category_uuid as parent_id')
        .then(rows => rows.map(row => ({ 
          id: row.id, 
          name: row.name,
          parent_id: row.parent_id
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
        .orderBy(['first_name', 'last_name'], 'asc')
        .select('user_id as id', 'username')
        .select(knex.raw("CONCAT(first_name, ' ', last_name) as name"))
        .then(rows => rows.map(row => ({ 
          id: row.id, 
          name: row.name || row.username,
          username: row.username
        }))),

      // Locations
      knex('locations')
        .where({ tenant })
        .orderBy('location_name', 'asc')
        .select('location_id as id', 'location_name as name', 'company_id')
        .then(rows => rows.map(row => ({ 
          id: row.id, 
          name: row.name,
          company_id: row.company_id
        })))
    ]);

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
  
  try {
    const statuses = await knex('statuses')
      .where({ tenant })
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
  
  try {
    const priorities = await knex('priorities')
      .where({ tenant })
      .orderBy('priority_name', 'asc')
      .select('priority_id as id', 'priority_name as name', 'is_default')
      .then(rows => rows.map(row => ({ 
        id: row.id, 
        name: row.name,
        is_default: Boolean(row.is_default)
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
  
  try {
    const categories = await knex('categories')
      .where({ tenant })
      .orderBy('category_name', 'asc')
      .select('category_id as id', 'category_name as name', 'parent_category_uuid as parent_id')
      .then(rows => rows.map(row => ({ 
        id: row.id, 
        name: row.name,
        parent_id: row.parent_id
      })));

    return { categories };
  } catch (error) {
    console.error('Failed to load categories:', error);
    return { categories: [] };
  }
}

export async function getAvailableCompanies(): Promise<{ companies: TicketFieldOptions['companies'] }> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  
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
  
  try {
    const users = await knex('users')
      .where({ tenant })
      .orderBy(['first_name', 'last_name'], 'asc')
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