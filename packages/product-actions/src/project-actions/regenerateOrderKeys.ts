import { createTenantKnex } from '@server/lib/db';
import { OrderingService } from '@server/lib/services/orderingService';
import { IProjectTask, IProjectPhase } from 'server/src/interfaces/project.interfaces';
import { Knex } from 'knex';
import { getCurrentUser } from '@product/actions/user-actions/userActions';
import { hasPermission } from '@server/lib/auth/rbac';

/**
 * Regenerates order keys for all tasks in a phase/status to ensure they follow proper fractional indexing
 */
export async function regenerateOrderKeysForStatus(
    phaseId: string,
    statusId: string
): Promise<void> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }

    const { knex: db, tenant } = await createTenantKnex();
    
    await db.transaction(async (trx: Knex.Transaction) => {
        if (!await hasPermission(currentUser, 'project', 'update', trx)) {
            throw new Error('Permission denied: Cannot update project');
        }
        // Get all tasks in this status, ordered by current order_key
        const tasks = await trx<IProjectTask>('project_tasks')
            .where('phase_id', phaseId)
            .where('project_status_mapping_id', statusId)
            .where('tenant', tenant!)
            .orderBy('order_key', 'asc');
        
        if (tasks.length === 0) return;
        
        // Generate new order keys
        const newKeys = OrderingService.generateInitialKeys(tasks.length);
        
        // Update each task with its new order key
        for (let i = 0; i < tasks.length; i++) {
            await trx('project_tasks')
                .where('task_id', tasks[i].task_id)
                .where('tenant', tenant!)
                .update({
                    order_key: newKeys[i],
                    updated_at: trx.fn.now()
                });
        }
        
        console.log(`Regenerated order keys for ${tasks.length} tasks in status ${statusId}`);
    });
}

/**
 * Checks if order keys in a status are valid and regenerates them if needed
 */
export async function validateAndFixOrderKeys(
    phaseId: string,
    statusId: string
): Promise<boolean> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }

    const { knex: db, tenant } = await createTenantKnex();
    
    if (!await hasPermission(currentUser, 'project', 'update', db)) {
        throw new Error('Permission denied: Cannot update project');
    }
    
    const tasks = await db<IProjectTask>('project_tasks')
        .where('phase_id', phaseId)
        .where('project_status_mapping_id', statusId)
        .where('tenant', tenant!)
        .orderBy('order_key', 'asc')
        .select('task_id', 'order_key', 'task_name');
    
    // Check for issues
    let needsRegeneration = false;
    
    for (let i = 0; i < tasks.length - 1; i++) {
        const currentKey = tasks[i].order_key;
        const nextKey = tasks[i + 1].order_key;
        
        if (!currentKey || !nextKey) {
            console.log('Missing order key detected');
            needsRegeneration = true;
            break;
        }
        
        if (currentKey >= nextKey) {
            console.log(`Order key issue: ${currentKey} >= ${nextKey}`);
            needsRegeneration = true;
            break;
        }
        
        // Check for unusual patterns (like "Zz" which shouldn't appear in normal fractional indexing)
        if (!/^[a-zA-Z0-9]*$/.test(currentKey) || currentKey.includes('Zz')) {
            console.log(`Unusual order key pattern: ${currentKey}`);
            needsRegeneration = true;
            break;
        }
    }
    
    if (needsRegeneration) {
        console.log('Order keys need regeneration for status', statusId);
        await regenerateOrderKeysForStatus(phaseId, statusId);
        return true;
    }
    
    return false;
}

/**
 * Regenerates order keys for all phases in a project to ensure they follow proper fractional indexing
 */
export async function regenerateOrderKeysForPhases(
    projectId: string
): Promise<void> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }

    const { knex: db, tenant } = await createTenantKnex();
    
    await db.transaction(async (trx: Knex.Transaction) => {
        if (!await hasPermission(currentUser, 'project', 'update', trx)) {
            throw new Error('Permission denied: Cannot update project');
        }
        // Get all phases in this project, ordered by current order_key (or fallback to end_date)
        const phases = await trx<IProjectPhase>('project_phases')
            .where('project_id', projectId)
            .where('tenant', tenant!)
            .orderByRaw(`
                CASE 
                    WHEN order_key IS NULL THEN 1 
                    ELSE 0 
                END,
                order_key ASC,
                end_date ASC
            `);
        
        if (phases.length === 0) return;
        
        // Generate new order keys
        const newKeys = OrderingService.generateInitialKeys(phases.length);
        
        // Update each phase with its new order key
        for (let i = 0; i < phases.length; i++) {
            await trx('project_phases')
                .where('phase_id', phases[i].phase_id)
                .where('tenant', tenant!)
                .update({
                    order_key: newKeys[i],
                    updated_at: trx.fn.now()
                });
        }
        
        console.log(`Regenerated order keys for ${phases.length} phases in project ${projectId}`);
    });
}

/**
 * Validates and fixes order keys for phases if needed
 */
export async function validateAndFixPhaseOrderKeys(
    projectId: string
): Promise<boolean> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }

    const { knex: db, tenant } = await createTenantKnex();
    
    if (!await hasPermission(currentUser, 'project', 'update', db)) {
        throw new Error('Permission denied: Cannot update project');
    }
    
    const phases = await db<IProjectPhase>('project_phases')
        .where('project_id', projectId)
        .where('tenant', tenant!)
        .orderBy('order_key', 'asc')
        .select('phase_id', 'order_key', 'phase_name');
    
    // Check for issues
    let needsRegeneration = false;
    
    for (let i = 0; i < phases.length - 1; i++) {
        const currentKey = phases[i].order_key;
        const nextKey = phases[i + 1].order_key;
        
        if (!currentKey || !nextKey) {
            console.log('Missing phase order key detected');
            needsRegeneration = true;
            break;
        }
        
        if (currentKey >= nextKey) {
            console.log(`Phase order key issue: ${currentKey} >= ${nextKey}`);
            needsRegeneration = true;
            break;
        }
        
        // Check for unusual patterns
        if (!/^[a-zA-Z0-9]*$/.test(currentKey) || currentKey.includes('Zz')) {
            console.log(`Unusual phase order key pattern: ${currentKey}`);
            needsRegeneration = true;
            break;
        }
    }
    
    if (needsRegeneration) {
        console.log('Phase order keys need regeneration for project', projectId);
        await regenerateOrderKeysForPhases(projectId);
        return true;
    }
    
    return false;
}