import { generateKeyBetween } from 'fractional-indexing';
import { createTenantKnex } from 'server/src/lib/db';

export class OrderingService {
    static generateInitialKeys(count: number): string[] {
        const keys: string[] = [];
        let lastKey: string | null = null;
        
        for (let i = 0; i < count; i++) {
            const newKey = generateKeyBetween(lastKey, null);
            keys.push(newKey);
            lastKey = newKey;
        }
        
        return keys;
    }
    
    static generateKeyForPosition(
        beforeKey: string | null, 
        afterKey: string | null
    ): string {
        return generateKeyBetween(beforeKey, afterKey);
    }
    
    static async reorderProjectTask(
        taskId: string,
        targetStatusId: string,
        beforeKey: string | null,
        afterKey: string | null
    ): Promise<string> {
        const newKey = generateKeyBetween(beforeKey, afterKey);
        
        const {knex: db, tenant} = await createTenantKnex();
        await db('project_tasks')
            .where({ task_id: taskId, tenant })
            .update({
                project_status_mapping_id: targetStatusId,
                order_key: newKey,
                updated_at: db.fn.now()
            });
            
        return newKey;
    }
    
    static async reorderProjectPhase(
        phaseId: string,
        beforeKey: string | null,
        afterKey: string | null
    ): Promise<string> {
        const newKey = generateKeyBetween(beforeKey, afterKey);
        
        const {knex: db, tenant} = await createTenantKnex();
        await db('project_phases')
            .where({ phase_id: phaseId, tenant })
            .update({
                order_key: newKey,
                updated_at: db.fn.now()
            });
            
        return newKey;
    }
}