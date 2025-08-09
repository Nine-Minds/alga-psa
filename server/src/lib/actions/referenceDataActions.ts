'use server';

import { createTenantKnex } from '../db';
import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';
import { IStandardPriority, IPriority } from 'server/src/interfaces/ticket.interfaces';
import { IStandardStatus, IStatus } from 'server/src/interfaces/status.interface';
import { IStandardServiceType } from 'server/src/interfaces/billing.interfaces';
import { IInteractionType } from 'server/src/interfaces';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';

export type ReferenceDataType = 'priorities' | 'statuses' | 'service_types' | 'task_types' | 'interaction_types' | 'service_categories' | 'categories' | 'channels';

interface ReferenceDataConfig {
  sourceTable: string;
  targetTable: string;
  mapFields: (sourceData: any, tenantId: string, userId: string, options?: any) => any;
  conflictCheck?: (data: any, tenantId: string, trx?: Knex.Transaction) => Promise<boolean>;
}

const referenceDataConfigs: Record<ReferenceDataType, ReferenceDataConfig> = {
  priorities: {
    sourceTable: 'standard_priorities',
    targetTable: 'priorities',
    mapFields: (source: IStandardPriority, tenantId: string, userId: string, options?: any) => ({
      priority_name: source.priority_name,
      order_number: source.order_number,
      color: source.color,
      item_type: source.item_type,
      tenant: tenantId,
      created_by: userId
    }),
    conflictCheck: async (data: any, tenantId: string, trx?: Knex.Transaction) => {
      const db = trx || (await createTenantKnex()).knex;
      const existing = await db('priorities')
        .where({
          tenant: tenantId,
          priority_name: data.priority_name,
          item_type: data.item_type
        })
        .first();
      return !!existing;
    }
  },
  statuses: {
    sourceTable: 'standard_statuses',
    targetTable: 'statuses',
    mapFields: (source: IStandardStatus, tenantId: string, userId: string, options?: any) => ({
      name: source.name,
      status_type: source.item_type,
      item_type: source.item_type,
      order_number: source.display_order,
      is_closed: source.is_closed,
      is_default: source.is_default,
      tenant: tenantId,
      created_by: userId
    }),
    conflictCheck: async (data: any, tenantId: string, trx?: Knex.Transaction) => {
      const db = trx || (await createTenantKnex()).knex;
      const existing = await db('statuses')
        .where({
          tenant: tenantId,
          name: data.name,
          item_type: data.item_type
        })
        .first();
      return !!existing;
    }
  },
  service_types: {
    sourceTable: 'standard_service_types',
    targetTable: 'service_types',
    mapFields: (source: IStandardServiceType, tenantId: string, userId: string, options?: any) => ({
      name: source.name,
      billing_method: source.billing_method,
      tenant: tenantId,
      is_active: true,
      description: null,
      standard_service_type_id: source.id,
      order_number: source.display_order || 0
    }),
    conflictCheck: async (data: any, tenantId: string, trx?: Knex.Transaction) => {
      const db = trx || (await createTenantKnex()).knex;
      const existing = await db('service_types')
        .where({
          tenant: tenantId,
          name: data.name
        })
        .first();
      return !!existing;
    }
  },
  task_types: {
    sourceTable: 'standard_task_types',
    targetTable: 'custom_task_types',
    mapFields: (source: any, tenantId: string, userId: string, options?: any) => ({
      type_key: source.type_key,
      type_name: source.type_name,
      icon: source.icon,
      color: source.color,
      display_order: source.display_order,
      is_active: source.is_active,
      tenant: tenantId,
      created_by: userId
    }),
    conflictCheck: async (data: any, tenantId: string, trx?: Knex.Transaction) => {
      const db = trx || (await createTenantKnex()).knex;
      const existing = await db('custom_task_types')
        .where({
          tenant: tenantId,
          type_key: data.type_key
        })
        .first();
      return !!existing;
    }
  },
  interaction_types: {
    sourceTable: 'system_interaction_types',
    targetTable: 'interaction_types',
    mapFields: (source: any, tenantId: string, userId: string, options?: any) => ({
      type_name: source.type_name,
      is_request: source.is_request || false,
      icon: source.icon,
      color: source.color,
      system_type_id: source.type_id,
      display_order: source.display_order || 0,
      tenant: tenantId,
      created_by: userId
    }),
    conflictCheck: async (data: any, tenantId: string, trx?: Knex.Transaction) => {
      const db = trx || (await createTenantKnex()).knex;
      const existing = await db('interaction_types')
        .where({
          tenant: tenantId,
          type_name: data.type_name
        })
        .first();
      return !!existing;
    }
  },
  service_categories: {
    sourceTable: 'standard_service_categories',
    targetTable: 'service_categories',
    mapFields: (source: any, tenantId: string, userId: string, options?: any) => ({
      category_name: source.category_name,
      description: source.description,
      display_order: source.display_order,
      tenant: tenantId
    }),
    conflictCheck: async (data: any, tenantId: string, trx?: Knex.Transaction) => {
      const db = trx || (await createTenantKnex()).knex;
      const existing = await db('service_categories')
        .where({
          tenant: tenantId,
          category_name: data.category_name
        })
        .first();
      return !!existing;
    }
  },
  categories: {
    sourceTable: 'standard_categories',
    targetTable: 'categories',
    mapFields: (source: any, tenantId: string, userId: string, options?: any) => ({
      category_name: source.category_name,
      display_order: source.display_order,
      tenant: tenantId,
      channel_id: options?.channel_id,
      created_by: userId
    }),
    conflictCheck: async (data: any, tenantId: string, trx?: Knex.Transaction) => {
      const db = trx || (await createTenantKnex()).knex;
      const existing = await db('categories')
        .where({
          tenant: tenantId,
          category_name: data.category_name
        })
        .first();
      return !!existing;
    }
  },
  channels: {
    sourceTable: 'standard_channels',
    targetTable: 'channels',
    mapFields: (source: any, tenantId: string, userId: string, options?: any) => ({
      channel_name: source.channel_name,
      description: source.description,
      display_order: source.display_order,
      is_inactive: source.is_inactive || false,
      is_default: source.is_default || false,
      tenant: tenantId
    }),
    conflictCheck: async (data: any, tenantId: string, trx?: Knex.Transaction) => {
      const db = trx || (await createTenantKnex()).knex;
      const existing = await db('channels')
        .where({
          tenant: tenantId,
          channel_name: data.channel_name
        })
        .first();
      return !!existing;
    }
  }
};

export async function getReferenceData(dataType: ReferenceDataType, filters?: any) {
  const config = referenceDataConfigs[dataType];
  const { knex: db } = await createTenantKnex();
  
  let query = db(config.sourceTable);
  
  if (filters) {
    // For categories, channel_id is only relevant for tenant data, not standard data
    const filteredFilters = { ...filters };
    if (dataType === 'categories' && 'channel_id' in filteredFilters) {
      delete filteredFilters.channel_id;
    }
    
    Object.entries(filteredFilters).forEach(([key, value]) => {
      query = query.where(key, value as any);
    });
  }
  
  // Add ordering for specific data types
  if (dataType === 'priorities') {
    query = query.orderBy('order_number', 'asc');
  } else if (dataType === 'statuses' || dataType === 'task_types' || dataType === 'service_types' || 
             dataType === 'service_categories' || dataType === 'channels') {
    query = query.orderBy('display_order', 'asc');
  } else if (dataType === 'categories') {
    // For categories, order by parent_category_uuid first (nulls first) then by display_order
    // This ensures parent categories are imported before their children
    query = query.orderByRaw('parent_category_uuid NULLS FIRST').orderBy('display_order', 'asc');
  }
  
  return await query;
}

export interface ImportConflict {
  referenceItem: any;
  conflictType: 'name' | 'order';
  existingItem?: any;
  suggestedOrder?: number;
}

export async function checkImportConflicts(
  dataType: ReferenceDataType,
  referenceIds: string[],
  filters?: any
): Promise<ImportConflict[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser?.user_id || !currentUser?.tenant) {
    throw new Error('User not authenticated or tenant not found');
  }

  const config = referenceDataConfigs[dataType];
  const { knex: db } = await createTenantKnex();
  
  // Wrap in transaction
  return await withTransaction(db, async (trx) => {
    let referenceData = await getReferenceData(dataType, filters);
    
    if (referenceIds && referenceIds.length > 0) {
      referenceData = referenceData.filter((item: any) => 
        referenceIds.includes(item.id || item.priority_id || item.standard_status_id || item.status_id || item.type_id)
      );
    }
    
    const conflicts: ImportConflict[] = [];
    
    for (const item of referenceData) {
      const mappedData = config.mapFields(item, currentUser.tenant, currentUser.user_id, filters);
      
      let hasNameConflict = false;
      let hasOrderConflict = false;
      
      // Check name conflict
      if (config.conflictCheck) {
        hasNameConflict = await config.conflictCheck(mappedData, currentUser.tenant, trx);
        if (hasNameConflict) {
          conflicts.push({
            referenceItem: item,
            conflictType: 'name',
            existingItem: hasNameConflict
          });
        }
      }
    
    // Check order conflict for data types that have order (even if there's a name conflict)
    if (dataType === 'priorities' || dataType === 'statuses' || dataType === 'service_types' || 
        dataType === 'interaction_types' || dataType === 'service_categories' || 
        dataType === 'categories' || dataType === 'channels') {
      const orderField = (dataType === 'priorities' || dataType === 'service_types' || dataType === 'statuses') ? 'order_number' : 'display_order';
      const orderValue = mappedData[orderField];
      
      if (orderValue && !hasNameConflict) { // Only check order if no name conflict
        const whereClause: any = {
          tenant: currentUser.tenant,
          [orderField]: orderValue
        };
        
        // For statuses, use status_type; for priorities, use item_type
        if (dataType === 'statuses' && mappedData.status_type) {
          whereClause.status_type = mappedData.status_type;
        } else if (dataType === 'priorities' && mappedData.item_type) {
          whereClause.item_type = mappedData.item_type;
        }
        
        const existingWithOrder = await trx(config.targetTable)
          .where(whereClause)
          .first();
          
        if (existingWithOrder) {
          // Find next available order number
          const maxOrderWhereClause: any = {
            tenant: currentUser.tenant
          };
          
          // For statuses, use status_type; for priorities, use item_type
          if (dataType === 'statuses' && mappedData.status_type) {
            maxOrderWhereClause.status_type = mappedData.status_type;
          } else if (dataType === 'priorities' && mappedData.item_type) {
            maxOrderWhereClause.item_type = mappedData.item_type;
          }
          
          const maxOrder = await trx(config.targetTable)
            .where(maxOrderWhereClause)
            .max(orderField + ' as max')
            .first();
            
          conflicts.push({
            referenceItem: item,
            conflictType: 'order',
            existingItem: existingWithOrder,
            suggestedOrder: (maxOrder?.max || 0) + 1
          });
          hasOrderConflict = true;
        }
      }
    }
  }
  
    return conflicts;
  });
}

export async function importReferenceData(
  dataType: ReferenceDataType, 
  referenceIds?: string[], 
  filters?: any,
  conflictResolutions?: Record<string, { action: 'skip' | 'rename' | 'reorder', newName?: string, newOrder?: number }>
) {
  const currentUser = await getCurrentUser();
  if (!currentUser?.user_id || !currentUser?.tenant) {
    throw new Error('User not authenticated or tenant not found');
  }
  
  // Validate required filters for specific data types
  if (dataType === 'categories' && !filters?.channel_id) {
    throw new Error('Board ID is required when importing categories');
  }

  const config = referenceDataConfigs[dataType];
  const { knex: db } = await createTenantKnex();
  
  // Wrap everything in a transaction
  return await withTransaction(db, async (trx) => {
    let referenceData = await getReferenceData(dataType, filters);
    
    if (referenceIds && referenceIds.length > 0) {
      referenceData = referenceData.filter((item: any) => 
        referenceIds.includes(item.id || item.priority_id || item.standard_status_id || item.status_id || item.type_id)
      );
    }
    
    const importedItems = [];
    const skippedItems = [];
    
    for (const item of referenceData) {
    const itemId = item.id || item.priority_id || item.standard_status_id || item.status_id || item.type_id;
    const resolution = conflictResolutions?.[itemId];
    
    if (resolution?.action === 'skip') {
      const itemName = item.name || item.priority_name || item.type_name || item.service_type || item.category_name || item.channel_name;
      skippedItems.push({
        name: itemName,
        reason: 'Skipped by user'
      });
      continue;
    }
    
    let mappedData = config.mapFields(item, currentUser.tenant, currentUser.user_id, filters);
    
    // Apply conflict resolutions
    if (resolution?.action === 'rename' && resolution.newName) {
      let nameField = 'name';
      if (item.priority_name !== undefined) nameField = 'priority_name';
      else if (item.type_name !== undefined) nameField = 'type_name';
      mappedData[nameField] = resolution.newName;
    }
    
    if (resolution?.action === 'reorder' && resolution.newOrder !== undefined) {
      const orderField = (dataType === 'priorities' || dataType === 'service_types' || dataType === 'statuses') ? 'order_number' : 'display_order';
      mappedData[orderField] = resolution.newOrder;
    }
    
    // Check for name conflict one more time after resolution
    if (config.conflictCheck && !resolution) {
      const hasConflict = await config.conflictCheck(mappedData, currentUser.tenant, trx);
      if (hasConflict) {
        const itemName = item.name || item.priority_name || item.type_name || item.service_type || item.category_name || item.channel_name;
        skippedItems.push({
          name: itemName,
          reason: 'Already exists'
        });
        continue;
      }
    }
    
    // Check for order conflicts proactively for data types with orders
    const orderField = (dataType === 'priorities' || dataType === 'service_types' || dataType === 'statuses') ? 'order_number' : 'display_order';
    const hasOrderField = dataType === 'priorities' || dataType === 'statuses' || 
                          dataType === 'service_types' || dataType === 'interaction_types' || 
                          dataType === 'service_categories' || dataType === 'categories' || 
                          dataType === 'channels';
    
    if (hasOrderField && mappedData[orderField] !== undefined) {
      const orderCheckClause: any = {
        tenant: currentUser.tenant,
        [orderField]: mappedData[orderField]
      };
      
      // Add type-specific constraints for order checking
      if (dataType === 'statuses' && mappedData.status_type) {
        orderCheckClause.status_type = mappedData.status_type;
      } else if (dataType === 'priorities' && mappedData.item_type) {
        orderCheckClause.item_type = mappedData.item_type;
      }
      
      const existingWithOrder = await trx(config.targetTable)
        .where(orderCheckClause)
        .first();
      
      if (existingWithOrder) {
        // Find next available order
        const maxOrderWhereClause: any = { tenant: currentUser.tenant };
        
        if (dataType === 'statuses' && mappedData.status_type) {
          maxOrderWhereClause.status_type = mappedData.status_type;
        } else if (dataType === 'priorities' && mappedData.item_type) {
          maxOrderWhereClause.item_type = mappedData.item_type;
        }
        
        const maxOrderResult = await trx(config.targetTable)
          .where(maxOrderWhereClause)
          .max(orderField + ' as max')
          .first();
        
        const nextOrder = (maxOrderResult?.max || 0) + 1;
        mappedData[orderField] = nextOrder;
      }
    }
    
    try {
      // Special handling for categories with parent relationships
      if (dataType === 'categories' && item.parent_category_uuid) {
        // We need to map the standard parent UUID to the tenant's parent category
        // First, find the standard parent category
        const standardParentCategory = await trx('standard_categories')
          .where('id', item.parent_category_uuid)
          .first();
          
        if (standardParentCategory) {
          // Now find the corresponding category in the tenant
          const parentCategory = await trx('categories')
            .where({
              tenant: currentUser.tenant,
              category_name: standardParentCategory.category_name,
              channel_id: filters?.channel_id
            })
            .first();
            
          if (parentCategory) {
            mappedData.parent_category = parentCategory.category_id;
          } else {
            // Skip if parent not found
            skippedItems.push({
              name: item.category_name,
              reason: `Parent category "${standardParentCategory.category_name}" not found. Import parent categories first.`
            });
            continue;
          }
        }
      }
      
      const [savedItem] = await trx(config.targetTable)
        .insert(mappedData)
        .returning('*');
      importedItems.push(savedItem);
    } catch (insertError: any) {
      console.error('Error inserting item:', insertError);
      
      if (insertError.code === '23505') {
        // Unique constraint violation
        const itemName = item.name || item.priority_name || item.type_name || item.service_type || item.category_name || item.channel_name;
        skippedItems.push({
          name: itemName,
          reason: 'Already exists'
        });
      } else {
        const itemName = item.name || item.priority_name || item.type_name || item.service_type || item.category_name || item.channel_name;
        skippedItems.push({
          name: itemName,
          reason: insertError.message || 'Unknown error'
        });
      }
    }
  }
  
    return {
      imported: importedItems,
      skipped: skippedItems,
      totalProcessed: referenceData.length
    };
  });
}

export async function getAvailableReferenceData(dataType: ReferenceDataType, filters?: any) {
  const currentUser = await getCurrentUser();
  if (!currentUser?.tenant) {
    throw new Error('User not authenticated or tenant not found');
  }

  const { knex: db } = await createTenantKnex();
  
  // Wrap in transaction to avoid multiple connections
  return await withTransaction(db, async (trx) => {
    const referenceData = await getReferenceData(dataType, filters);
    const config = referenceDataConfigs[dataType];
    
    const availableItems = [];
    
    for (const item of referenceData) {
      const mappedData = config.mapFields(item, currentUser.tenant, currentUser.user_id, filters);
      
      if (config.conflictCheck) {
        const hasConflict = await config.conflictCheck(mappedData, currentUser.tenant, trx);
        if (!hasConflict) {
          availableItems.push(item);
        }
      } else {
        availableItems.push(item);
      }
    }
    
    return availableItems;
  });
}

export async function deleteReferenceDataItem(
  dataType: ReferenceDataType,
  itemId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.user_id || !currentUser?.tenant) {
      throw new Error('User not authenticated or tenant not found');
    }

    const config = referenceDataConfigs[dataType];
    const { knex: db } = await createTenantKnex();

    // Define the ID field name for each data type
    const idFieldMap: Record<ReferenceDataType, string> = {
      priorities: 'priority_id',
      statuses: 'status_id',
      service_types: 'id',
      task_types: 'id',
      interaction_types: 'id',
      service_categories: 'id',
      categories: 'category_id',
      channels: 'channel_id'
    };

    const idField = idFieldMap[dataType];
    if (!idField) {
      throw new Error(`Unknown ID field for data type: ${dataType}`);
    }

    await withTransaction(db, async (trx) => {
      // Check if the item exists and belongs to the tenant
      const existing = await trx(config.targetTable)
        .where({
          [idField]: itemId,
          tenant: currentUser.tenant
        })
        .first();

      if (!existing) {
        throw new Error('Item not found or access denied');
      }

      // Special handling for channels - check if it has categories
      if (dataType === 'channels') {
        const categoryCount = await trx('categories')
          .where({
            channel_id: itemId,
            tenant: currentUser.tenant
          })
          .count('* as count')
          .first();

        if (categoryCount && parseInt(categoryCount.count as string) > 0) {
          throw new Error('Cannot delete board with existing categories. Please delete all categories first.');
        }
      }

      // Special handling for categories - check if it has subcategories
      if (dataType === 'categories') {
        const subcategoryCount = await trx('categories')
          .where({
            parent_category: itemId,
            tenant: currentUser.tenant
          })
          .count('* as count')
          .first();

        if (subcategoryCount && parseInt(subcategoryCount.count as string) > 0) {
          throw new Error('Cannot delete category with existing subcategories. Please delete all subcategories first.');
        }
      }

      // Special handling for service_types - check if it has service catalog entries
      if (dataType === 'service_types') {
        const serviceCount = await trx('service_catalog')
          .where({
            custom_service_type_id: itemId,
            tenant: currentUser.tenant
          })
          .count('* as count')
          .first();

        if (serviceCount && parseInt(serviceCount.count as string) > 0) {
          throw new Error('Cannot delete service type that is being used by services. Please update or delete the services first.');
        }
      }

      // Delete the item
      await trx(config.targetTable)
        .where({
          [idField]: itemId,
          tenant: currentUser.tenant
        })
        .delete();
    });

    return { success: true };
  } catch (error) {
    console.error('Error deleting reference data item:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}