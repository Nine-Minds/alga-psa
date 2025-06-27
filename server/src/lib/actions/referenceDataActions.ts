'use server';

import { createTenantKnex } from '../db';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { IStandardPriority, IPriority } from 'server/src/interfaces/ticket.interfaces';
import { IStandardStatus, IStatus } from 'server/src/interfaces/status.interface';
import { IStandardServiceType } from 'server/src/interfaces/billing.interfaces';
import { IInteractionType } from 'server/src/interfaces';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';

export type ReferenceDataType = 'priorities' | 'statuses' | 'service_types' | 'task_types' | 'interaction_types';

interface ReferenceDataConfig {
  sourceTable: string;
  targetTable: string;
  mapFields: (sourceData: any, tenantId: string, userId: string) => any;
  conflictCheck?: (data: any, tenantId: string) => Promise<boolean>;
}

const referenceDataConfigs: Record<ReferenceDataType, ReferenceDataConfig> = {
  priorities: {
    sourceTable: 'standard_priorities',
    targetTable: 'priorities',
    mapFields: (source: IStandardPriority, tenantId: string, userId: string) => ({
      priority_name: source.priority_name,
      order_number: source.order_number,
      color: source.color,
      item_type: source.item_type,
      tenant: tenantId,
      created_by: userId
    }),
    conflictCheck: async (data: any, tenantId: string) => {
      const { knex: db } = await createTenantKnex();
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
    mapFields: (source: IStandardStatus, tenantId: string, userId: string) => ({
      name: source.name,
      item_type: source.item_type,
      display_order: source.display_order,
      is_closed: source.is_closed,
      is_default: source.is_default,
      tenant: tenantId,
      created_by: userId
    }),
    conflictCheck: async (data: any, tenantId: string) => {
      const { knex: db } = await createTenantKnex();
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
    mapFields: (source: IStandardServiceType, tenantId: string, userId: string) => ({
      service_type: source.name,
      default_rate: 0,
      tenant: tenantId,
      created_by: userId
    }),
    conflictCheck: async (data: any, tenantId: string) => {
      const { knex: db } = await createTenantKnex();
      const existing = await db('service_types')
        .where({
          tenant: tenantId,
          service_type: data.service_type
        })
        .first();
      return !!existing;
    }
  },
  task_types: {
    sourceTable: 'standard_task_types',
    targetTable: 'custom_task_types',
    mapFields: (source: any, tenantId: string, userId: string) => ({
      type_key: source.type_key,
      type_name: source.type_name,
      icon: source.icon,
      color: source.color,
      display_order: source.display_order,
      is_active: source.is_active,
      tenant: tenantId,
      created_by: userId
    }),
    conflictCheck: async (data: any, tenantId: string) => {
      const { knex: db } = await createTenantKnex();
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
    mapFields: (source: any, tenantId: string, userId: string) => ({
      type_name: source.type_name,
      is_request: source.is_request || false,
      icon: source.icon,
      color: source.color,
      system_type_id: source.type_id,
      tenant: tenantId,
      created_by: userId
    }),
    conflictCheck: async (data: any, tenantId: string) => {
      const { knex: db } = await createTenantKnex();
      const existing = await db('interaction_types')
        .where({
          tenant: tenantId,
          system_type_id: data.system_type_id
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
    Object.entries(filters).forEach(([key, value]) => {
      query = query.where(key, value as any);
    });
  }
  
  // Add ordering for specific data types
  if (dataType === 'priorities') {
    query = query.orderBy('order_number', 'asc');
  } else if (dataType === 'statuses') {
    query = query.orderBy('display_order', 'asc');
  } else if (dataType === 'task_types') {
    query = query.orderBy('display_order', 'asc');
  }
  
  return await query;
}

export async function importReferenceData(
  dataType: ReferenceDataType, 
  referenceIds?: string[], 
  filters?: any
) {
  const currentUser = await getCurrentUser();
  if (!currentUser?.user_id || !currentUser?.tenant) {
    throw new Error('User not authenticated or tenant not found');
  }

  const config = referenceDataConfigs[dataType];
  const { knex: db } = await createTenantKnex();
  
  let referenceData = await getReferenceData(dataType, filters);
  
  if (referenceIds && referenceIds.length > 0) {
    referenceData = referenceData.filter((item: any) => 
      referenceIds.includes(item.id || item.priority_id || item.status_id || item.type_id)
    );
  }
  
  const importedItems = [];
  const skippedItems = [];
  
  for (const item of referenceData) {
    const mappedData = config.mapFields(item, currentUser.tenant, currentUser.user_id);
    
    if (config.conflictCheck) {
      const hasConflict = await config.conflictCheck(mappedData, currentUser.tenant);
      if (hasConflict) {
        skippedItems.push({
          name: item.name || item.priority_name || item.type_name || item.service_type,
          reason: 'Already exists'
        });
        continue;
      }
    }
    
    const [savedItem] = await db(config.targetTable)
      .insert(mappedData)
      .returning('*');
    importedItems.push(savedItem);
  }
  
  return {
    imported: importedItems,
    skipped: skippedItems,
    totalProcessed: referenceData.length
  };
}

export async function getAvailableReferenceData(dataType: ReferenceDataType, filters?: any) {
  const currentUser = await getCurrentUser();
  if (!currentUser?.tenant) {
    throw new Error('User not authenticated or tenant not found');
  }

  const referenceData = await getReferenceData(dataType, filters);
  const config = referenceDataConfigs[dataType];
  
  const availableItems = [];
  
  for (const item of referenceData) {
    const mappedData = config.mapFields(item, currentUser.tenant, currentUser.user_id);
    
    if (config.conflictCheck) {
      const hasConflict = await config.conflictCheck(mappedData, currentUser.tenant);
      if (!hasConflict) {
        availableItems.push(item);
      }
    } else {
      availableItems.push(item);
    }
  }
  
  return availableItems;
}