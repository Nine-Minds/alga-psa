import type { ICustomTaskType, ITaskType } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';
import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

function tenantScopedTable<Row extends object = Record<string, any>>(
    conn: Knex | Knex.Transaction,
    table: string,
    tenant: string,
): Knex.QueryBuilder<Row, Row[]> {
    return tenantDb(conn, tenant).table<Row>(table);
}

const TaskTypeModel = {
    getAllTaskTypes: async (knexOrTrx: Knex | Knex.Transaction, tenant: string): Promise<ITaskType[]> => {
        if (!tenant) throw new Error('Tenant context is required for task type operations');
        
        const standardTypes = await tenantScopedTable<ITaskType>(knexOrTrx, 'standard_task_types', tenant)
            .where({ is_active: true })
            .orderBy('display_order');
            
        const customTypes = await tenantScopedTable<ITaskType>(knexOrTrx, 'custom_task_types', tenant)
            .where({ is_active: true })
            .orderBy('display_order');
            
        const typeMap = new Map<string, ITaskType>();
        
        standardTypes.forEach(type => typeMap.set(type.type_key, type));
        customTypes.forEach(type => typeMap.set(type.type_key, type));
        
        return Array.from(typeMap.values()).sort((a, b) => a.display_order - b.display_order);
    },
    
    getTaskTypeByKey: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, typeKey: string): Promise<ITaskType | null> => {
        if (!tenant) throw new Error('Tenant context is required for task type operations');
        
        const customType = await tenantScopedTable<ITaskType>(knexOrTrx, 'custom_task_types', tenant)
            .where({ type_key: typeKey, is_active: true })
            .first();
            
        if (customType) return customType;
        
        return (await tenantScopedTable<ITaskType>(knexOrTrx, 'standard_task_types', tenant)
            .where({ type_key: typeKey, is_active: true })
            .first()) ?? null;
    },
    
    createCustomTaskType: async (
        knexOrTrx: Knex | Knex.Transaction,
        tenant: string,
        data: Omit<ICustomTaskType, 'type_id' | 'tenant' | 'created_at' | 'updated_at'>
    ): Promise<ICustomTaskType> => {
        if (!tenant) throw new Error('Tenant context is required for task type operations');
        
        const [taskType] = await tenantScopedTable<ICustomTaskType>(knexOrTrx, 'custom_task_types', tenant)
            .insert({
                type_id: uuidv4(),
                tenant,
                ...data,
                created_at: new Date(),
                updated_at: new Date()
            })
            .returning('*');
            
        return taskType;
    },
    
    updateCustomTaskType: async (
        knexOrTrx: Knex | Knex.Transaction,
        tenant: string,
        typeId: string,
        data: Partial<Omit<ICustomTaskType, 'type_id' | 'tenant' | 'created_at' | 'updated_at'>>
    ): Promise<ICustomTaskType> => {
        if (!tenant) throw new Error('Tenant context is required for task type operations');
        
        const [taskType] = await tenantScopedTable<ICustomTaskType>(knexOrTrx, 'custom_task_types', tenant)
            .where({ type_id: typeId })
            .update({
                ...data,
                updated_at: new Date()
            })
            .returning('*');
            
        return taskType;
    },
    
    deleteCustomTaskType: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, typeId: string): Promise<void> => {
        if (!tenant) throw new Error('Tenant context is required for task type operations');
        
        await tenantScopedTable(knexOrTrx, 'custom_task_types', tenant)
            .where({ type_id: typeId })
            .update({ is_active: false, updated_at: new Date() });
    }
};

export default TaskTypeModel;
