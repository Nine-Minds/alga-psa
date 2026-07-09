'use server'
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { IServiceCategory } from '@alga-psa/types';
import { ITicketCategory } from '@alga-psa/types';
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  tenant: string,
  table: string
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

export type ServiceCategoryActionError =
  | { readonly actionError: string }
  | { readonly permissionError: string };

function actionError(message: string): ServiceCategoryActionError {
  return { actionError: message };
}

function permissionError(message: string): ServiceCategoryActionError {
  return { permissionError: message };
}

function serviceCategoryActionErrorFrom(error: unknown): ServiceCategoryActionError | null {
  const candidate = error as { actionError?: unknown; permissionError?: unknown };
  if (typeof candidate?.actionError === 'string') {
    return actionError(candidate.actionError);
  }
  if (typeof candidate?.permissionError === 'string') {
    return permissionError(candidate.permissionError);
  }

  if (error instanceof Error) {
    const message = error.message;
    if (
      message.includes('Permission denied:') ||
      message.includes('user is not logged in') ||
      message.includes('User not authenticated')
    ) {
      return permissionError(message);
    }
    if (message.includes('duplicate key value') || message.includes('already exists')) {
      return actionError('A service category with this name already exists');
    }
    if (message.includes('not found')) {
      return actionError('Service category not found');
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('The selected service category is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '23502') {
    return actionError(`Missing required service category field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('Cannot delete category because it is still in use.');
  }
  if (dbError?.code === '23505') {
    return actionError('A service category with this name already exists');
  }

  return null;
}

export const getServiceCategories = withAuth(async (user, { tenant }): Promise<IServiceCategory[] | ServiceCategoryActionError> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    return permissionError('Permission denied: billing read required');
  }
  try {
    const {knex: db} = await createTenantKnex();

    const categories = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantScopedTable(trx, tenant, 'service_categories')
        .select('category_id', 'category_name', 'description', 'display_order')
        .orderBy('display_order', 'asc');
    });

    return categories;
  } catch (error) {
    console.error('Error fetching service categories:', error);
    const expected = serviceCategoryActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const createServiceCategory = withAuth(async (user, { tenant }, data: {
  category_name: string;
  description?: string;
  display_order?: number;
}): Promise<IServiceCategory | ServiceCategoryActionError> => {
  if (!await hasPermission(user, 'billing', 'create')) {
    return permissionError('Permission denied: billing create required');
  }

  if (!data.category_name?.trim()) {
    return actionError('Category name is required');
  }

  try {
    const {knex: db} = await createTenantKnex();

    const category = await withTransaction(db, async (trx: Knex.Transaction) => {
      const existingCategory = await tenantScopedTable(trx, tenant, 'service_categories')
        .where({ category_name: data.category_name.trim() })
        .first();

      if (existingCategory) {
        return actionError('A service category with this name already exists');
      }

      // If no display_order provided, get the next available order
      let displayOrder = data.display_order;
      if (displayOrder === undefined || displayOrder === 0) {
        const maxOrder = await tenantScopedTable(trx, tenant, 'service_categories')
          .max('display_order as max')
          .first();
        displayOrder = (maxOrder?.max || 0) + 1;
      }

      const [newCategory] = await tenantScopedTable(trx, tenant, 'service_categories')
        .insert({
          category_name: data.category_name.trim(),
          description: data.description || null,
          display_order: displayOrder,
          tenant
        })
        .returning(['category_id', 'category_name', 'description', 'display_order']);

      return newCategory;
    });

    return category;
  } catch (error) {
    console.error('Error creating service category:', error);
    const expected = serviceCategoryActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const updateServiceCategory = withAuth(async (
  user,
  { tenant },
  categoryId: string,
  data: {
    category_name?: string;
    description?: string;
    display_order?: number;
  }
): Promise<IServiceCategory | ServiceCategoryActionError> => {
  if (!await hasPermission(user, 'billing', 'update')) {
    return permissionError('Permission denied: billing update required');
  }

  if (!categoryId) {
    return actionError('Category ID is required');
  }

  if (data.category_name !== undefined && data.category_name.trim() === '') {
    return actionError('Category name cannot be empty');
  }

  try {
    const {knex: db} = await createTenantKnex();

    const category = await withTransaction(db, async (trx: Knex.Transaction) => {
      if (data.category_name) {
        const existingCategory = await tenantScopedTable(trx, tenant, 'service_categories')
          .where({ category_name: data.category_name.trim() })
          .whereNot('category_id', categoryId)
          .first();

        if (existingCategory) {
          return actionError('A service category with this name already exists');
        }
      }

      const [updatedCategory] = await tenantScopedTable(trx, tenant, 'service_categories')
        .where({ category_id: categoryId })
        .update({
          ...data,
          ...(data.category_name ? { category_name: data.category_name.trim() } : {}),
          updated_at: trx.fn.now()
        })
        .returning(['category_id', 'category_name', 'description', 'display_order']);

      if (!updatedCategory) {
        return actionError('Service category not found');
      }

      return updatedCategory;
    });

    return category;
  } catch (error) {
    console.error('Error updating service category:', error);
    const expected = serviceCategoryActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const deleteServiceCategory = withAuth(async (user, { tenant }, categoryId: string): Promise<void | ServiceCategoryActionError> => {
  if (!await hasPermission(user, 'billing', 'delete')) {
    return permissionError('Permission denied: billing delete required');
  }

  if (!categoryId) {
    return actionError('Category ID is required');
  }

  try {
    const {knex: db} = await createTenantKnex();

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // Check if category is in use
      const servicesCount = await tenantScopedTable(trx, tenant, 'service_catalog')
        .where({ category_id: categoryId })
        .count('* as count')
        .first();

      if (servicesCount && Number(servicesCount.count) > 0) {
        return actionError('Cannot delete category: services are using this category');
      }

      const deletedCount = await tenantScopedTable(trx, tenant, 'service_categories')
        .where({ category_id: categoryId })
        .delete();

      if (deletedCount === 0) {
        return actionError('Service category not found');
      }
    });
  } catch (error) {
    console.error('Error deleting service category:', error);
    const expected = serviceCategoryActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

// Removed getTicketCategoriesByBoard - this function has been moved to ticketCategoryActions.ts
// and updated to return both categories and board configuration
