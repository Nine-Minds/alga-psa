'use server'

import { withTransaction } from '@alga-psa/db';
import { IServiceCategory } from '@alga-psa/types';
import { TextNoneIcon } from '@radix-ui/react-icons';
import { createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';
import { getSession } from '@alga-psa/auth';

export async function getServiceCategories() {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const categories = await trx<IServiceCategory>('service_categories')
        .where('tenant', tenant || '')
        .select('*');
      return categories;
    } catch (error) {
      console.error('Error fetching service categories:', error);
      throw new Error('Failed to fetch service categories');
    }
  });
}

export async function createServiceCategory(categoryName: string, description?: string) {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  if (!categoryName || categoryName.trim() === '') {
    throw new Error('Category name is required');
  }

  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
    // Check if category with same name already exists
    const existingCategory = await trx('service_categories')
      .where({
        tenant,
        category_name: categoryName
      })
      .first();

    if (existingCategory) {
      throw new Error('A service category with this name already exists');
    }

    if (!tenant) {
      throw new Error("user is not logged in");
    }

    const [newCategory] = await trx<IServiceCategory>('service_categories')
      .insert({
        tenant,
        category_name: categoryName.trim(),
        description: description?.trim()
      })
      .returning('*');

      return newCategory;
    } catch (error) {
      console.error('Error creating service category:', error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to create service category');
    }
  });
}

export async function deleteServiceCategory(categoryId: string) {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  if (!categoryId) {
    throw new Error('Category ID is required');
  }

  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
    // Check if category is in use
    const inUseCount = await trx('tickets')
      .where({
        tenant,
        category_id: categoryId
      })
      .count('ticket_id as count')
      .first();

    if (inUseCount && Number(inUseCount.count) > 0) {
      throw new Error('Cannot delete category that is in use by tickets');
    }

    await trx('service_categories')
      .where({
        tenant,
        category_id: categoryId
      })
      .del();
      return true;
    } catch (error) {
      console.error('Error deleting service category:', error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to delete service category');
    }
  });
}

export async function updateServiceCategory(categoryId: string, categoryData: Partial<IServiceCategory>) {
  const session = await getSession();
  if (!session?.user?.id) {
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
    // Check if new name conflicts with existing category
    if (categoryData.category_name) {
      const existingCategory = await trx('service_categories')
        .where({
          tenant,
          category_name: categoryData.category_name
        })
        .whereNot('category_id', categoryId)
        .first();

      if (existingCategory) {
        throw new Error('A service category with this name already exists');
      }
    }

    if (!tenant) {
      throw new Error("user is not logged in");
    }    

    const [updatedCategory] = await trx<IServiceCategory>('service_categories')
      .where({
        tenant,
        category_id: categoryId
      })
      .update(categoryData)
      .returning('*');

    if (!updatedCategory) {
      throw new Error('Service category not found');
    }

      return updatedCategory;
    } catch (error) {
      console.error('Error updating service category:', error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to update service category');
    }
  });
}
