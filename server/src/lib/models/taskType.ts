import { getCurrentTenantId } from 'server/src/lib/db';
import { IStandardTaskType, ICustomTaskType, ITaskType } from 'server/src/interfaces/project.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { Knex } from 'knex';

const TaskTypeModel = {
    getAllTaskTypes: async (knexOrTrx: Knex | Knex.Transaction): Promise<ITaskType[]> => {
        const tenant = await getCurrentTenantId();
        if (!tenant) {
            throw new Error('Tenant context is required for task type operations');
        }
        
        const standardTypes = await knexOrTrx('standard_task_types')
            .where({ is_active: true })
            .orderBy('display_order');
            
        const customTypes = await knexOrTrx('custom_task_types')
            .where({ tenant, is_active: true })
            .orderBy('display_order');
            
        const typeMap = new Map<string, ITaskType>();
        
        standardTypes.forEach(type => typeMap.set(type.type_key, type));
        customTypes.forEach(type => typeMap.set(type.type_key, type));
        
        return Array.from(typeMap.values()).sort((a, b) => a.display_order - b.display_order);
    },
    
    getTaskTypeByKey: async (knexOrTrx: Knex | Knex.Transaction, typeKey: string): Promise<ITaskType | null> => {
        const tenant = await getCurrentTenantId();
        if (!tenant) {
            throw new Error('Tenant context is required for task type operations');
        }
        
        const customType = await knexOrTrx('custom_task_types')
            .where({ tenant, type_key: typeKey, is_active: true })
            .first();
            
        if (customType) return customType;
        
        return await knexOrTrx('standard_task_types')
            .where({ type_key: typeKey, is_active: true })
            .first();
    },
    
    createCustomTaskType: async (knexOrTrx: Knex | Knex.Transaction, data: Omit<ICustomTaskType, 'type_id' | 'tenant' | 'created_at' | 'updated_at'>): Promise<ICustomTaskType> => {
        const tenant = await getCurrentTenantId();
        if (!tenant) {
            throw new Error('Tenant context is required for task type operations');
        }
        
        const [taskType] = await knexOrTrx('custom_task_types')
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
    
    updateCustomTaskType: async (knexOrTrx: Knex | Knex.Transaction, typeId: string, data: Partial<Omit<ICustomTaskType, 'type_id' | 'tenant' | 'created_at' | 'updated_at'>>): Promise<ICustomTaskType> => {
        const tenant = await getCurrentTenantId();
        if (!tenant) {
            throw new Error('Tenant context is required for task type operations');
        }
        
        const [taskType] = await knexOrTrx('custom_task_types')
            .where({ type_id: typeId, tenant })
            .update({
                ...data,
                updated_at: new Date()
            })
            .returning('*');
            
        return taskType;
    },
    
    deleteCustomTaskType: async (knexOrTrx: Knex | Knex.Transaction, typeId: string): Promise<void> => {
        const tenant = await getCurrentTenantId();
        if (!tenant) {
            throw new Error('Tenant context is required for task type operations');
        }
        
        await knexOrTrx('custom_task_types')
            .where({ type_id: typeId, tenant })
            .update({ is_active: false, updated_at: new Date() });
    }
};

export default TaskTypeModel;