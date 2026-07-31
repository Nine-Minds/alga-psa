import { tenantDb } from '@alga-psa/db';

/**
 * Get ITIL categories from standard_categories table.
 * This function should be used in server components to fetch ITIL categories.
 * For client components, ITIL categories should be passed from server actions.
 * @param db Knex database connection
 * @returns Promise<Array> of ITIL category records from standard_categories table
 */
export async function getItilCategoriesFromDB(db: any): Promise<any[]> {
  return await tenantDb(db, '__itil_standard_category_reference__').table('standard_categories')
    .where('is_itil_standard', true)
    .orderBy('category_name', 'asc');
}

/**
 * Get ITIL priorities from standard_priorities table.
 * @param db Knex database connection
 * @returns Promise<Array> of ITIL priority records from standard_priorities table
 */
export async function getItilPrioritiesFromDB(db: any): Promise<any[]> {
  return await tenantDb(db, '__itil_standard_priority_reference__').table('standard_priorities')
    .where('is_itil_standard', true)
    .orderBy('itil_priority_level', 'asc');
}

/**
 * Get ITIL priority record by calculated priority level.
 * @param db Knex database connection
 * @param priorityLevel ITIL priority level (1-5)
 * @returns Promise<Object> ITIL priority record
 */
export async function getItilPriorityByLevel(db: any, priorityLevel: number): Promise<any> {
  return await tenantDb(db, '__itil_standard_priority_reference__').table('standard_priorities')
    .where('is_itil_standard', true)
    .where('itil_priority_level', priorityLevel)
    .first();
}
