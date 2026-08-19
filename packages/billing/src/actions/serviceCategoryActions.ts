'use server'

import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { IServiceCategory } from '@alga-psa/types';

import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  actionError,
  isActionMessageError,
  isActionPermissionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

type ServiceCategoryActionError = ActionMessageError | ActionPermissionError;

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  tenant: string,
  table: string
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

function serviceCategoryActionErrorFrom(error: unknown): ServiceCategoryActionError | null {
  if (isActionMessageError(error) || isActionPermissionError(error)) {
    return error as ServiceCategoryActionError;
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
      return actionError('A service category with this name already exists', 'msp/service-catalog:errors.category.duplicateName');
    }
    if (message.includes('in use')) {
      return actionError(message);
    }
    if (message.includes('not found')) {
      return actionError('Service category not found', 'msp/service-catalog:errors.category.notFound');
    }
    if (message.includes('Category name is required')) {
      return actionError('Category name is required', 'msp/service-catalog:errors.category.nameRequired');
    }
    if (message.includes('Category name cannot be empty')) {
      return actionError('Category name cannot be empty', 'msp/service-catalog:errors.category.nameEmpty');
    }
    if (message.includes('Category ID is required')) {
      return actionError('Category ID is required', 'msp/service-catalog:errors.category.idRequired');
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('The selected service category is invalid. Please refresh and try again.', 'msp/service-catalog:errors.category.invalid');
  }
  if (dbError?.code === '23502') {
    return dbError.column
      ? actionError(
          `Missing required service category field: ${dbError.column}.`,
          'msp/service-catalog:errors.category.missingFieldNamed',
          { field: dbError.column },
        )
      : actionError('Missing required service category field.', 'msp/service-catalog:errors.category.missingField');
  }
  if (dbError?.code === '23503') {
    return actionError('Cannot delete category because it is still in use.', 'msp/service-catalog:errors.category.inUse');
  }
  if (dbError?.code === '23505') {
    return actionError('A service category with this name already exists', 'msp/service-catalog:errors.category.duplicateName');
  }

  return null;
}

export const getServiceCategories = withAuth(async (user, { tenant }): Promise<IServiceCategory[] | ServiceCategoryActionError> => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const categories = await tenantScopedTable(trx, tenant, 'service_categories')
        .select('*');
      return categories;
    } catch (error) {
      console.error('Error fetching service categories:', error);
      const expected = serviceCategoryActionErrorFrom(error);
      if (expected) return expected;
      throw error;
    }
  });
});

export const createServiceCategory = withAuth(async (
  user,
  { tenant },
  categoryName: string,
  description?: string
): Promise<IServiceCategory | ServiceCategoryActionError> => {
  if (!await hasPermission(user, 'billing', 'create')) {
    return permissionError('Permission denied: billing create required', 'msp/billing:errors.permissions.billingCreate');
  }
  if (!categoryName || categoryName.trim() === '') {
    return actionError('Category name is required', 'msp/service-catalog:errors.category.nameRequired');
  }

  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
    // Check if category with same name already exists
    const existingCategory = await tenantScopedTable(trx, tenant, 'service_categories')
      .where({
        category_name: categoryName
      })
      .first();

    if (existingCategory) {
      return actionError('A service category with this name already exists', 'msp/service-catalog:errors.category.duplicateName');
    }

    if (!tenant) {
      return permissionError('user is not logged in', 'msp/billing:errors.context.notLoggedIn');
    }

    const [newCategory] = await tenantScopedTable(trx, tenant, 'service_categories')
      .insert({
        tenant,
        category_name: categoryName.trim(),
        description: description?.trim()
      })
      .returning('*');

      return newCategory;
    } catch (error) {
      console.error('Error creating service category:', error);
      const expected = serviceCategoryActionErrorFrom(error);
      if (expected) return expected;
      throw error;
    }
  });
});

export const deleteServiceCategory = withAuth(async (
  user,
  { tenant },
  categoryId: string
): Promise<boolean | ServiceCategoryActionError> => {
  if (!await hasPermission(user, 'billing', 'delete')) {
    return permissionError('Permission denied: billing delete required', 'msp/billing:errors.permissions.billingDelete');
  }
  if (!categoryId) {
    return actionError('Category ID is required', 'msp/service-catalog:errors.category.idRequired');
  }

  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
    // Check if category is in use
    const inUseCount = await tenantScopedTable(trx, tenant, 'tickets')
      .where({
        category_id: categoryId
      })
      .count('ticket_id as count')
      .first();

    if (inUseCount && Number(inUseCount.count) > 0) {
      return actionError('Cannot delete category that is in use by tickets', 'msp/service-catalog:errors.category.inUseByTickets');
    }

    // Clear category_id from service_request_definitions (replaces ON DELETE SET NULL)
    await tenantScopedTable(trx, tenant, 'service_request_definitions')
      .where({ category_id: categoryId })
      .update({ category_id: null, category_name_snapshot: null });

    const deletedCount = await tenantScopedTable(trx, tenant, 'service_categories')
      .where({
        category_id: categoryId
      })
      .del();

    if (deletedCount === 0) {
      return actionError('Service category not found', 'msp/service-catalog:errors.category.notFound');
    }

      return true;
    } catch (error) {
      console.error('Error deleting service category:', error);
      const expected = serviceCategoryActionErrorFrom(error);
      if (expected) return expected;
      throw error;
    }
  });
});

export const updateServiceCategory = withAuth(async (
  user,
  { tenant },
  categoryId: string,
  categoryData: Partial<IServiceCategory>
): Promise<IServiceCategory | ServiceCategoryActionError> => {
  if (!await hasPermission(user, 'billing', 'update')) {
    return permissionError('Permission denied: billing update required', 'msp/billing:errors.permissions.billingUpdate');
  }
  if (!categoryId) {
    return actionError('Category ID is required', 'msp/service-catalog:errors.category.idRequired');
  }

  if (categoryData.category_name && categoryData.category_name.trim() === '') {
    return actionError('Category name cannot be empty', 'msp/service-catalog:errors.category.nameEmpty');
  }

  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
    // Check if new name conflicts with existing category
    if (categoryData.category_name) {
      const existingCategory = await tenantScopedTable(trx, tenant, 'service_categories')
        .where({
          category_name: categoryData.category_name
        })
        .whereNot('category_id', categoryId)
        .first();

      if (existingCategory) {
        return actionError('A service category with this name already exists', 'msp/service-catalog:errors.category.duplicateName');
      }
    }

    if (!tenant) {
      return permissionError('user is not logged in', 'msp/billing:errors.context.notLoggedIn');
    }

    const [updatedCategory] = await tenantScopedTable(trx, tenant, 'service_categories')
      .where({
        category_id: categoryId
      })
      .update(categoryData)
      .returning('*');

    if (!updatedCategory) {
      return actionError('Service category not found', 'msp/service-catalog:errors.category.notFound');
    }

      return updatedCategory;
    } catch (error) {
      console.error('Error updating service category:', error);
      const expected = serviceCategoryActionErrorFrom(error);
      if (expected) return expected;
      throw error;
    }
  });
});
