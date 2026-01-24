'use server'

import { withTransaction } from '@alga-psa/db';
import { ITicketCategory } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';

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

export const getTicketCategories = withAuth(async (user, { tenant }) => {
  const { knex: db } = await createTenantKnex();
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
});

export const createTicketCategory = withAuth(async (user, { tenant }, categoryName: string, boardId: string, parentCategory?: string) => {
  if (!categoryName || categoryName.trim() === '') {
    throw new Error('Category name is required');
  }

  if (!boardId) {
    throw new Error('Board ID is required');
  }

  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
    // Check if category with same name exists in the board
    const existingCategory = await trx('categories')
      .where({
        tenant,
        category_name: categoryName,
        board_id: boardId
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
        board_id: boardId,
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
});

/**
 * Legacy delete function - throws errors for backward compatibility.
 * Use deleteCategory() for new code (returns result object).
 */
export async function deleteTicketCategory(categoryId: string): Promise<boolean> {
  if (!categoryId) {
    throw new Error('Category ID is required');
  }

  const result = await deleteCategory(categoryId, false);

  if (!result.success) {
    throw new Error(result.message || 'Failed to delete category');
  }

  return true;
}

export const updateTicketCategory = withAuth(async (user, { tenant }, categoryId: string, categoryData: Partial<ITicketCategory>) => {
  if (!categoryId) {
    throw new Error('Category ID is required');
  }

  if (categoryData.category_name && categoryData.category_name.trim() === '') {
    throw new Error('Category name cannot be empty');
  }

  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
    // Check if new name conflicts with existing category in the same board
    if (categoryData.category_name) {
      const existingCategory = await trx('categories')
        .where({
          tenant,
          category_name: categoryData.category_name,
          board_id: categoryData.board_id || (await trx('categories').where({ category_id: categoryId }).first()).board_id
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
});

export interface BoardCategoryData {
  categories: ITicketCategory[];
  boardConfig: {
    category_type: 'custom' | 'itil';
    priority_type: 'custom' | 'itil';
    display_itil_impact?: boolean;
    display_itil_urgency?: boolean;
  };
}

export const getTicketCategoriesByBoard = withAuth(async (_user, { tenant }, boardId: string): Promise<BoardCategoryData> => {
  if (!boardId) {
    throw new Error('Board ID is required');
  }

  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Get board configuration
      const board = await trx('boards')
        .where('tenant', tenant!)
        .where('board_id', boardId)
        .select('category_type', 'priority_type', 'display_itil_impact', 'display_itil_urgency')
        .first();

      if (!board) {
        throw new Error('Board not found');
      }

      const boardConfig = {
        category_type: (board.category_type || 'custom') as 'custom' | 'itil',
        priority_type: (board.priority_type || 'custom') as 'custom' | 'itil',
        display_itil_impact: board.display_itil_impact || false,
        display_itil_urgency: board.display_itil_urgency || false,
      };

      // Fetch categories for this board from tenant's categories table
      // (ITIL categories are copied to tenant table when board is configured for ITIL)
      let categories;

      if (boardConfig.category_type === 'itil') {
        // For ITIL boards, get all ITIL categories regardless of which board they were created for
        categories = await trx('categories')
          .where('tenant', tenant!)
          .where('is_from_itil_standard', true)
          .orderBy('category_name');
      } else {
        // For custom boards, get categories specific to this board
        categories = await trx('categories')
          .where('tenant', tenant!)
          .where('board_id', boardId)
          .orderBy('category_name');
      }

      // Apply hierarchical ordering
      const orderedCategories = await orderCategoriesHierarchically(categories);

      return {
        categories: orderedCategories,
        boardConfig
      };
    } catch (error) {
      console.error('Error fetching ticket categories by board:', error);
      throw new Error('Failed to fetch ticket categories');
    }
  });
});

export const getAllCategories = withAuth(async (_user, { tenant }): Promise<ITicketCategory[]> => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const categories = await trx<ITicketCategory>('categories')
        .where('tenant', tenant!)
        .select('category_id', 'category_name', 'display_order', 'parent_category', 'board_id')
        .orderBy('display_order', 'asc');

      return categories;
    } catch (error) {
      console.error('Error fetching all categories:', error);
      throw new Error('Failed to fetch categories');
    }
  });
});

export const createCategory = withAuth(async (user, { tenant }, data: {
  category_name: string;
  display_order?: number;
  board_id: string;
  parent_category?: string;
}): Promise<ITicketCategory> => {
  if (!data.board_id) {
    throw new Error('Board ID is required');
  }

  const { knex: db } = await createTenantKnex();
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
          board_id: data.board_id,
          parent_category: data.parent_category || null,
          tenant,
          created_by: user.user_id
        })
        .returning(['category_id', 'category_name', 'display_order', 'board_id', 'parent_category']);

      return newCategory;
    } catch (error) {
      console.error('Error creating category:', error);
      throw new Error('Failed to create category');
    }
  });
});

export const updateCategory = withAuth(async (
  _user,
  { tenant },
  categoryId: string,
  data: {
    category_name?: string;
    display_order?: number;
    board_id?: string;
  }
): Promise<ITicketCategory> => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Check if this is a parent category and board is being changed
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
        .returning(['category_id', 'category_name', 'display_order', 'board_id', 'parent_category']);

      // If this is a parent category and board_id was changed, update all subcategories
      if (!currentCategory.parent_category && data.board_id && data.board_id !== currentCategory.board_id) {
        await trx('categories')
          .where({ parent_category: categoryId, tenant })
          .update({ board_id: data.board_id });
      }

      return updatedCategory;
    } catch (error) {
      console.error('Error updating category:', error);
      throw new Error('Failed to update category');
    }
  });
});

/**
 * Helper to recursively collect all subcategory IDs.
 * Returns IDs in deletion order (deepest children first).
 */
async function collectAllSubcategoryIds(
  trx: Knex.Transaction,
  parentId: string,
  tenant: string
): Promise<string[]> {
  const directChildren = await trx('categories')
    .where({ tenant, parent_category: parentId })
    .select('category_id');

  const childIds = directChildren.map((c: { category_id: string }) => c.category_id);

  // Recursively collect grandchildren
  const allDescendantIds: string[] = [];
  for (const childId of childIds) {
    const descendants = await collectAllSubcategoryIds(trx, childId, tenant);
    allDescendantIds.push(...descendants);
  }

  // Return deepest first, then direct children
  return [...allDescendantIds, ...childIds];
}

/**
 * Delete a category with hasDependencies pattern (like deleteClient).
 *
 * - If tickets exist in category or any subcategory → BLOCK
 * - If subcategories exist and force=false → return info, prompt user
 * - If subcategories exist and force=true → delete them too
 *
 * @param categoryId - The category to delete
 * @param force - If true, delete subcategories too (still blocks on tickets)
 */
interface DeleteCategoryResult {
  success: boolean;
  code?: string;
  message?: string;
  dependencies?: string[];
  counts?: Record<string, number>;
}

export const deleteCategory = withAuth(async (
  _user,
  { tenant },
  categoryId: string,
  force = false
): Promise<DeleteCategoryResult> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction): Promise<DeleteCategoryResult> => {
    // 1. Get the category
    const category = await trx('categories')
      .where({ tenant, category_id: categoryId })
      .first();

    if (!category) {
      return { success: false, code: 'NOT_FOUND', message: 'Category not found' };
    }

    // 2. Check if ITIL standard category - protected while ITIL boards exist
    if (category.is_from_itil_standard) {
      const itilBoardsResult = await trx('boards')
        .where({ tenant })
        .where('category_type', 'itil')
        .count('* as count')
        .first();

      const itilBoardCount = Number(itilBoardsResult?.count || 0);

      if (itilBoardCount > 0) {
        return {
          success: false,
          code: 'ITIL_CATEGORY_PROTECTED',
          message: `Cannot delete ITIL category while ${itilBoardCount} ITIL board${itilBoardCount === 1 ? ' exists' : 's exist'}. Delete the ITIL board${itilBoardCount === 1 ? '' : 's'} first.`
        };
      }
    }

    // 3. Collect all subcategory IDs
    const allSubcategoryIds = await collectAllSubcategoryIds(trx, categoryId, tenant);
    const allCategoryIds = [categoryId, ...allSubcategoryIds];

    // 4. Check for tickets using ANY of these categories (BLOCKER)
    const ticketCount = await trx('tickets')
      .where({ tenant })
      .where(function() {
        this.whereIn('category_id', allCategoryIds)
          .orWhereIn('subcategory_id', allCategoryIds);
      })
      .count('ticket_id as count')
      .first();

    const ticketNum = Number(ticketCount?.count || 0);

    if (ticketNum > 0) {
      return {
        success: false,
        code: 'CATEGORY_HAS_TICKETS',
        message: `Cannot delete category: ${ticketNum} ticket${ticketNum === 1 ? ' is' : 's are'} using this category${allSubcategoryIds.length > 0 ? ' or its subcategories' : ''}`,
        dependencies: ['tickets'],
        counts: { tickets: ticketNum }
      };
    }

    // 5. If subcategories exist and force=false, prompt for confirmation
    if (allSubcategoryIds.length > 0 && !force) {
      return {
        success: false,
        code: 'CATEGORY_HAS_SUBCATEGORIES',
        message: `Category has ${allSubcategoryIds.length} subcategor${allSubcategoryIds.length === 1 ? 'y' : 'ies'}. Delete them too?`,
        dependencies: ['subcategories'],
        counts: { subcategories: allSubcategoryIds.length }
      };
    }

    // 6. Delete subcategories first (if any)
    if (allSubcategoryIds.length > 0) {
      await trx('categories')
        .where({ tenant })
        .whereIn('category_id', allSubcategoryIds)
        .delete();
    }

    // 7. Delete the category
    await trx('categories')
      .where({ tenant, category_id: categoryId })
      .delete();

    return {
      success: true,
      message: allSubcategoryIds.length > 0
        ? `Category and ${allSubcategoryIds.length} subcategor${allSubcategoryIds.length === 1 ? 'y' : 'ies'} deleted`
        : 'Category deleted'
    };
  });
});
