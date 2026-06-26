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

export const getServiceCategories = withAuth(async (user, { tenant }): Promise<IServiceCategory[]> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    throw new Error('Permission denied: billing read required');
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
    throw new Error('Failed to fetch service categories');
  }
});

export const createServiceCategory = withAuth(async (user, { tenant }, data: {
  category_name: string;
  description?: string;
  display_order?: number;
}): Promise<IServiceCategory> => {
  if (!await hasPermission(user, 'billing', 'create')) {
    throw new Error('Permission denied: billing create required');
  }
  try {
    const {knex: db} = await createTenantKnex();

    const category = await withTransaction(db, async (trx: Knex.Transaction) => {
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
          category_name: data.category_name,
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
    throw new Error('Failed to create service category');
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
): Promise<IServiceCategory> => {
  if (!await hasPermission(user, 'billing', 'update')) {
    throw new Error('Permission denied: billing update required');
  }
  try {
    const {knex: db} = await createTenantKnex();

    const category = await withTransaction(db, async (trx: Knex.Transaction) => {
      const [updatedCategory] = await tenantScopedTable(trx, tenant, 'service_categories')
        .where({ category_id: categoryId })
        .update({
          ...data,
          updated_at: trx.fn.now()
        })
        .returning(['category_id', 'category_name', 'description', 'display_order']);

      if (!updatedCategory) {
        throw new Error('Service category not found');
      }

      return updatedCategory;
    });

    return category;
  } catch (error) {
    console.error('Error updating service category:', error);
    throw new Error('Failed to update service category');
  }
});

export const deleteServiceCategory = withAuth(async (user, { tenant }, categoryId: string): Promise<void> => {
  if (!await hasPermission(user, 'billing', 'delete')) {
    throw new Error('Permission denied: billing delete required');
  }
  try {
    const {knex: db} = await createTenantKnex();

    await withTransaction(db, async (trx: Knex.Transaction) => {
      // Check if category is in use
      const servicesCount = await tenantScopedTable(trx, tenant, 'service_catalog')
        .where({ category_id: categoryId })
        .count('* as count')
        .first();

      if (servicesCount && Number(servicesCount.count) > 0) {
        throw new Error('Cannot delete category: services are using this category');
      }

      const deletedCount = await tenantScopedTable(trx, tenant, 'service_categories')
        .where({ category_id: categoryId })
        .delete();

      if (deletedCount === 0) {
        throw new Error('Service category not found');
      }
    });
  } catch (error) {
    console.error('Error deleting service category:', error);
    throw new Error(error instanceof Error ? error.message : 'Failed to delete service category');
  }
});

// Removed getTicketCategoriesByBoard - this function has been moved to ticketCategoryActions.ts
// and updated to return both categories and board configuration
