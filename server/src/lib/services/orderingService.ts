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
        beforeKey: string | null | undefined, 
        afterKey: string | null | undefined
    ): string {
        // Convert undefined to null for consistency
        const normalizedBeforeKey = beforeKey === undefined ? null : beforeKey;
        const normalizedAfterKey = afterKey === undefined ? null : afterKey;
        
        // Validate inputs to prevent fractional-indexing errors
        if (normalizedBeforeKey && normalizedAfterKey) {
            // Ensure beforeKey < afterKey
            if (normalizedBeforeKey >= normalizedAfterKey) {
                console.error('Invalid key order: beforeKey must be less than afterKey', {
                    beforeKey: normalizedBeforeKey,
                    afterKey: normalizedAfterKey
                });
                throw new Error(`Invalid key order: beforeKey (${normalizedBeforeKey}) must be less than afterKey (${normalizedAfterKey})`);
            }
        }
        
        // Handle edge case where both keys are the same (should not happen with proper logic)
        if (normalizedBeforeKey && normalizedAfterKey && normalizedBeforeKey === normalizedAfterKey) {
            console.error('Identical keys provided', { beforeKey: normalizedBeforeKey, afterKey: normalizedAfterKey });
            throw new Error('Cannot generate key between identical keys');
        }
        
        try {
            const newKey = generateKeyBetween(normalizedBeforeKey, normalizedAfterKey);
            console.log('Generated new key:', newKey, 'for position between', normalizedBeforeKey, 'and', normalizedAfterKey);
            return newKey;
        } catch (error) {
            console.error('Error generating key between:', { beforeKey: normalizedBeforeKey, afterKey: normalizedAfterKey, error });
            throw error;
        }
    }
    
    static async reorderProjectTask(
        taskId: string,
        targetStatusId: string,
        beforeKey: string | null,
        afterKey: string | null
    ): Promise<string> {
        const newKey = this.generateKeyForPosition(beforeKey, afterKey);
        
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
        const newKey = this.generateKeyForPosition(beforeKey, afterKey);
        
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