'use server'
import { createTenantKnex } from '@alga-psa/db';
import { IServiceCategory } from '@alga-psa/types';
import { ITicketCategory } from '@alga-psa/types';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';

export async function getServiceCategories(): Promise<IServiceCategory[]> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const categories = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('service_categories')
        .where({ tenant })
        .select('category_id', 'category_name', 'description', 'display_order')
        .orderBy('display_order', 'asc');
    });

    return categories;
  } catch (error) {
    console.error('Error fetching service categories:', error);
    throw new Error('Failed to fetch service categories');
  }
}

export async function createServiceCategory(data: { 
  category_name: string; 
  description?: string;
  display_order?: number;
}): Promise<IServiceCategory> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const category = await withTransaction(db, async (trx: Knex.Transaction) => {
      // If no display_order provided, get the next available order
      let displayOrder = data.display_order;
      if (displayOrder === undefined || displayOrder === 0) {
        const maxOrder = await trx('service_categories')
          .where({ tenant })
          .max('display_order as max')
          .first();
        displayOrder = (maxOrder?.max || 0) + 1;
      }

      const [newCategory] = await trx('service_categories')
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
}

export async function updateServiceCategory(
  categoryId: string, 
  data: { 
    category_name?: string; 
    description?: string;
    display_order?: number;
  }
): Promise<IServiceCategory> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const category = await withTransaction(db, async (trx: Knex.Transaction) => {
      const [updatedCategory] = await trx('service_categories')
        .where({ category_id: categoryId, tenant })
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
}

export async function deleteServiceCategory(categoryId: string): Promise<void> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    await withTransaction(db, async (trx: Knex.Transaction) => {
      // Check if category is in use
      const servicesCount = await trx('service_catalog')
        .where({ category_id: categoryId, tenant })
        .count('* as count')
        .first();
      
      if (servicesCount && Number(servicesCount.count) > 0) {
        throw new Error('Cannot delete category: services are using this category');
      }

      const deletedCount = await trx('service_categories')
        .where({ category_id: categoryId, tenant })
        .delete();
      
      if (deletedCount === 0) {
        throw new Error('Service category not found');
      }
    });
  } catch (error) {
    console.error('Error deleting service category:', error);
    throw new Error(error instanceof Error ? error.message : 'Failed to delete service category');
  }
}

// Removed getTicketCategoriesByBoard - this function has been moved to ticketCategoryActions.ts
// and updated to return both categories and board configuration
