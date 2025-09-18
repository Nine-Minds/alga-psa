'use server'

import { withTransaction } from '@alga-psa/shared/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { ITicketCategory } from 'server/src/interfaces/ticket.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { Knex } from 'knex';

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

  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Get all categories ordered by name
      const categories = await trx<ITicketCategory>('categories')
        .select('*')
        .where('tenant', tenant!)
        .orderBy('category_name');

      // Order them hierarchically
      return orderCategoriesHierarchically(categories);
    } catch (error) {
      console.error('Error fetching ticket categories:', error);
      throw new Error('Failed to fetch ticket categories');
    }
  });
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
    throw new Error('Board ID is required');
  }

  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
    // Check if category with same name exists in the channel
    const existingCategory = await trx('categories')
      .where({
        tenant,
        category_name: categoryName,
        channel_id: channelId
      })
      .first();

    if (existingCategory) {
      throw new Error('A ticket category with this name already exists in this board');
    }

    if (!tenant) {
      throw new Error("user is not logged in");
    }

    const [newCategory] = await trx<ITicketCategory>('categories')
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
  });
}

export async function deleteTicketCategory(categoryId: string) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  if (!categoryId) {
    throw new Error('Category ID is required');
  }

  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
    // Check if category has subcategories
    const hasSubcategories = await trx('categories')
      .where({
        tenant,
        parent_category: categoryId
      })
      .first();

    if (hasSubcategories) {
      throw new Error('Cannot delete category that has subcategories');
    }

    // Check if category is in use by tickets
    const inUseCount = await trx('tickets')
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

    await trx('categories')
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
  });
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

  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
    // Check if new name conflicts with existing category in the same channel
    if (categoryData.category_name) {
      const existingCategory = await trx('categories')
        .where({
          tenant,
          category_name: categoryData.category_name,
          channel_id: categoryData.channel_id || (await trx('categories').where({ category_id: categoryId }).first()).channel_id
        })
        .whereNot('category_id', categoryId)
        .first();

      if (existingCategory) {
        throw new Error('A ticket category with this name already exists in this board');
      }
    }

    if (!tenant) {
      throw new Error("user is not logged in");
    }

    const [updatedCategory] = await trx<ITicketCategory>('categories')
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
  });
}

export interface ChannelCategoryData {
  categories: ITicketCategory[];
  channelConfig: {
    category_type: 'custom' | 'itil';
    priority_type: 'custom' | 'itil';
    display_itil_impact?: boolean;
    display_itil_urgency?: boolean;
  };
}

export async function getTicketCategoriesByChannel(channelId: string): Promise<ChannelCategoryData> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  if (!channelId) {
    throw new Error('Board ID is required');
  }

  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Get channel configuration
      const channel = await trx('channels')
        .where('tenant', tenant!)
        .where('channel_id', channelId)
        .select('category_type', 'priority_type', 'display_itil_impact', 'display_itil_urgency')
        .first();

      if (!channel) {
        throw new Error('Channel not found');
      }

      const channelConfig = {
        category_type: (channel.category_type || 'custom') as 'custom' | 'itil',
        priority_type: (channel.priority_type || 'custom') as 'custom' | 'itil',
        display_itil_impact: channel.display_itil_impact || false,
        display_itil_urgency: channel.display_itil_urgency || false,
      };

      // If channel uses ITIL categories, fetch ITIL categories from standard_categories
      if (channelConfig.category_type === 'itil') {
        const itilCategories = await trx('standard_categories')
          .where('is_itil_standard', true)
          .orderBy('category_name');

        // Map standard_categories fields to match the expected ITicketCategory interface
        const mappedCategories = itilCategories.map(cat => ({
          category_id: cat.id,                          // Map id -> category_id
          category_name: cat.category_name,
          parent_category: cat.parent_category_uuid,    // Map parent_category_uuid -> parent_category
          description: cat.description,
          display_order: cat.display_order,
          created_at: cat.created_at,
          updated_at: cat.updated_at,
          is_itil: true                                 // Add the filtering flag
        }));

        // Apply the same hierarchical ordering as custom categories
        const orderedItilCategories = await orderCategoriesHierarchically(mappedCategories);

        return {
          categories: orderedItilCategories,
          channelConfig
        };
      }

      // Get all custom categories for the channel ordered by name
      const categories = await trx<ITicketCategory>('categories')
        .where('tenant', tenant!)
        .where('channel_id', channelId)
        .orderBy('category_name');

      // Order them hierarchically and mark as custom categories
      const orderedCategories = await orderCategoriesHierarchically(categories);
      const categoriesWithFlag = orderedCategories.map(cat => ({
        ...cat,
        is_itil: false
      }));

      return {
        categories: categoriesWithFlag,
        channelConfig
      };
    } catch (error) {
      console.error('Error fetching ticket categories by board:', error);
      throw new Error('Failed to fetch ticket categories');
    }
  });
}

export async function getAllCategories(): Promise<ITicketCategory[]> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const categories = await trx<ITicketCategory>('categories')
        .where('tenant', tenant!)
        .select('category_id', 'category_name', 'display_order', 'parent_category', 'channel_id')
        .orderBy('display_order', 'asc');

      return categories;
    } catch (error) {
      console.error('Error fetching all categories:', error);
      throw new Error('Failed to fetch categories');
    }
  });
}

export async function createCategory(data: { 
  category_name: string; 
  display_order?: number;
  channel_id: string;
  parent_category?: string;
}): Promise<ITicketCategory> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  if (!data.channel_id) {
    throw new Error('Board ID is required');
  }

  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // If no display_order provided, get the next available order
      let displayOrder = data.display_order;
      if (displayOrder === undefined || displayOrder === 0) {
        if (data.parent_category) {
          // For subcategories, get max order within the parent
          const maxOrder = await trx('categories')
            .where({ tenant, parent_category: data.parent_category })
            .max('display_order as max')
            .first();
          displayOrder = (maxOrder?.max || 0) + 1;
        } else {
          // For parent categories
          const maxOrder = await trx('categories')
            .where({ tenant })
            .whereNull('parent_category')
            .max('display_order as max')
            .first();
          displayOrder = (maxOrder?.max || 0) + 1;
        }
      }

      const [newCategory] = await trx('categories')
        .insert({
          category_name: data.category_name,
          display_order: displayOrder,
          channel_id: data.channel_id,
          parent_category: data.parent_category || null,
          tenant,
          created_by: user.user_id
        })
        .returning(['category_id', 'category_name', 'display_order', 'channel_id', 'parent_category']);
      
      return newCategory;
    } catch (error) {
      console.error('Error creating category:', error);
      throw new Error('Failed to create category');
    }
  });
}

export async function updateCategory(
  categoryId: string, 
  data: { 
    category_name?: string; 
    display_order?: number;
    channel_id?: string;
  }
): Promise<ITicketCategory> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Check if this is a parent category and channel is being changed
      const currentCategory = await trx('categories')
        .where({ category_id: categoryId, tenant })
        .first();
      
      if (!currentCategory) {
        throw new Error('Category not found');
      }

      // Update the category
      const [updatedCategory] = await trx('categories')
        .where({ category_id: categoryId, tenant })
        .update(data)
        .returning(['category_id', 'category_name', 'display_order', 'channel_id', 'parent_category']);
      
      // If this is a parent category and channel_id was changed, update all subcategories
      if (!currentCategory.parent_category && data.channel_id && data.channel_id !== currentCategory.channel_id) {
        await trx('categories')
          .where({ parent_category: categoryId, tenant })
          .update({ channel_id: data.channel_id });
      }
      
      return updatedCategory;
    } catch (error) {
      console.error('Error updating category:', error);
      throw new Error('Failed to update category');
    }
  });
}

export async function deleteCategory(categoryId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Check if category has subcategories
      const hasSubcategories = await trx('categories')
        .where({
          tenant,
          parent_category: categoryId
        })
        .first();

      if (hasSubcategories) {
        throw new Error('Cannot delete category that has subcategories');
      }

      // Check if category is in use by tickets (both as category_id and subcategory_id)
      const ticketsCount = await trx('tickets')
        .where({ tenant })
        .where(function() {
          this.where('category_id', categoryId)
              .orWhere('subcategory_id', categoryId);
        })
        .count('* as count')
        .first();
      
      if (ticketsCount && Number(ticketsCount.count) > 0) {
        const count = Number(ticketsCount.count);
        throw new Error(`Cannot delete category: ${count} ticket${count === 1 ? ' is' : 's are'} using this category`);
      }

      const deletedCount = await trx('categories')
        .where({ category_id: categoryId, tenant })
        .delete();
      
      if (deletedCount === 0) {
        throw new Error('Category not found');
      }
    } catch (error) {
      console.error('Error deleting category:', error);
      throw new Error(error instanceof Error ? error.message : 'Failed to delete category');
    }
  });
}
