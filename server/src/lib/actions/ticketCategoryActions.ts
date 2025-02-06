'use server'

import { createTenantKnex } from '@/lib/db';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { ITicketCategory } from '@/interfaces/ticket.interfaces';

async function orderCategoriesHierarchically(categories: ITicketCategory[]): Promise<ITicketCategory[]> {
  // First separate parent categories and subcategories
  const parentCategories = categories.filter(cat => !cat.parent_category);
  const subcategories = categories.filter(cat => cat.parent_category);

  // Create a map of parent IDs to their subcategories
  const subcategoriesByParent = subcategories.reduce((acc, sub) => {
    if (!acc[sub.parent_category!]) {
      acc[sub.parent_category!] = [];
    }
    acc[sub.parent_category!].push(sub);
    return acc;
  }, {} as Record<string, ITicketCategory[]>);

  // Combine parents with their children in order
  const orderedCategories: ITicketCategory[] = [];
  parentCategories.forEach(parent => {
    orderedCategories.push(parent);
    if (subcategoriesByParent[parent.category_id]) {
      orderedCategories.push(...subcategoriesByParent[parent.category_id]);
    }
  });

  // Add any orphaned subcategories at the end
  const orphanedSubcategories = subcategories.filter(
    sub => !subcategoriesByParent[sub.parent_category!]?.includes(sub)
  );
  orderedCategories.push(...orphanedSubcategories);

  return orderedCategories;
}

export async function getTicketCategories() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  const {knex: db, tenant} = await createTenantKnex();
  try {
    // Get all categories ordered by name
    const categories = await db<ITicketCategory>('categories')
      .select('*')
      .where('tenant', tenant!)
      .orderBy('category_name');

    // Order them hierarchically
    return orderCategoriesHierarchically(categories);
  } catch (error) {
    console.error('Error fetching ticket categories:', error);
    throw new Error('Failed to fetch ticket categories');
  }
}

export async function createTicketCategory(categoryName: string, channelId: string, parentCategory?: string) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  if (!categoryName || categoryName.trim() === '') {
    throw new Error('Category name is required');
  }

  if (!channelId) {
    throw new Error('Channel ID is required');
  }

  const {knex: db, tenant} = await createTenantKnex();
  try {
    // Check if category with same name exists in the channel
    const existingCategory = await db('categories')
      .where({
        tenant,
        category_name: categoryName,
        channel_id: channelId
      })
      .first();

    if (existingCategory) {
      throw new Error('A ticket category with this name already exists in this channel');
    }

    if (!tenant) {
      throw new Error("user is not logged in");
    }

    const [newCategory] = await db<ITicketCategory>('categories')
      .insert({
        tenant,
        category_name: categoryName.trim(),
        channel_id: channelId,
        parent_category: parentCategory,
        created_by: user.user_id
      })
      .returning('*');

    return newCategory;
  } catch (error) {
    console.error('Error creating ticket category:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to create ticket category');
  }
}

export async function deleteTicketCategory(categoryId: string) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  if (!categoryId) {
    throw new Error('Category ID is required');
  }

  const {knex: db, tenant} = await createTenantKnex();
  try {
    // Check if category has subcategories
    const hasSubcategories = await db('categories')
      .where({
        tenant,
        parent_category: categoryId
      })
      .first();

    if (hasSubcategories) {
      throw new Error('Cannot delete category that has subcategories');
    }

    // Check if category is in use by tickets
    const inUseCount = await db('tickets')
      .where({
        tenant,
        category_id: categoryId
      })
      .orWhere({
        tenant,
        subcategory_id: categoryId
      })
      .count('ticket_id as count')
      .first();

    if (inUseCount && Number(inUseCount.count) > 0) {
      throw new Error('Cannot delete category that is in use by tickets');
    }

    await db('categories')
      .where({
        tenant,
        category_id: categoryId
      })
      .del();
    return true;
  } catch (error) {
    console.error('Error deleting ticket category:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to delete ticket category');
  }
}

export async function updateTicketCategory(categoryId: string, categoryData: Partial<ITicketCategory>) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  if (!categoryId) {
    throw new Error('Category ID is required');
  }

  if (categoryData.category_name && categoryData.category_name.trim() === '') {
    throw new Error('Category name cannot be empty');
  }

  const {knex: db, tenant} = await createTenantKnex();
  try {
    // Check if new name conflicts with existing category in the same channel
    if (categoryData.category_name) {
      const existingCategory = await db('categories')
        .where({
          tenant,
          category_name: categoryData.category_name,
          channel_id: categoryData.channel_id || (await db('categories').where({ category_id: categoryId }).first()).channel_id
        })
        .whereNot('category_id', categoryId)
        .first();

      if (existingCategory) {
        throw new Error('A ticket category with this name already exists in this channel');
      }
    }

    if (!tenant) {
      throw new Error("user is not logged in");
    }

    const [updatedCategory] = await db<ITicketCategory>('categories')
      .where({
        tenant,
        category_id: categoryId
      })
      .update(categoryData)
      .returning('*');

    if (!updatedCategory) {
      throw new Error('Ticket category not found');
    }

    return updatedCategory;
  } catch (error) {
    console.error('Error updating ticket category:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to update ticket category');
  }
}

export async function getTicketCategoriesByChannel(channelId: string) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  if (!channelId) {
    throw new Error('Channel ID is required');
  }

  const {knex: db, tenant} = await createTenantKnex();
  try {
    // Get all categories for the channel ordered by name
    const categories = await db<ITicketCategory>('categories')
      .where('tenant', tenant!)
      .where('channel_id', channelId)
      .orderBy('category_name');

    // Order them hierarchically
    return orderCategoriesHierarchically(categories);
  } catch (error) {
    console.error('Error fetching ticket categories by channel:', error);
    throw new Error('Failed to fetch ticket categories');
  }
}
