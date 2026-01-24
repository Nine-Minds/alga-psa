import { createTenantKnex } from 'server/src/lib/db';
import { IStandardTaskType, ICustomTaskType, ITaskType } from 'server/src/interfaces/project.interfaces';
import { withTransaction } from '@alga-psa/db';

export class TaskTypeService {
    static async getAllTaskTypes(): Promise<ITaskType[]> {
        const { knex: db, tenant } = await createTenantKnex();
        
        return await withTransaction(db, async (trx) => {
            const standardTypes = await trx('standard_task_types')
                .where({ is_active: true })
                .orderBy('display_order');
                
            const customTypes = await trx('custom_task_types')
                .where({ tenant, is_active: true })
                .orderBy('display_order');
                
            const typeMap = new Map<string, ITaskType>();
            
            standardTypes.forEach(type => typeMap.set(type.type_key, type));
            customTypes.forEach(type => typeMap.set(type.type_key, type));
            
            return Array.from(typeMap.values()).sort((a, b) => a.display_order - b.display_order);
        });
    }
    
    static async getTaskTypeByKey(typeKey: string): Promise<ITaskType | null> {
        const { knex: db, tenant } = await createTenantKnex();
        
        return await withTransaction(db, async (trx) => {
            const customType = await trx('custom_task_types')
                .where({ tenant, type_key: typeKey, is_active: true })
                .first();
                
            if (customType) return customType;
            
            return await trx('standard_task_types')
                .where({ type_key: typeKey, is_active: true })
                .first();
        });
    }
    
    static async createCustomTaskType(data: Omit<ICustomTaskType, 'type_id' | 'tenant' | 'created_at' | 'updated_at'>): Promise<ICustomTaskType> {
        const { knex: db, tenant } = await createTenantKnex();
        
        return await withTransaction(db, async (trx) => {
            const [taskType] = await trx('custom_task_types')
                .insert({
                    tenant,
                    ...data
                })
                .returning('*');
                
            return taskType;
        });
    }
}