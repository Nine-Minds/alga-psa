import type { DependencyType, IProjectTaskDependency } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';
import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

type SuccessorTaskIdRow = {
    successor_task_id: string;
};

function tenantScopedTable(
    conn: Knex | Knex.Transaction,
    table: string,
    tenant: string,
): Knex.QueryBuilder {
    return tenantDb(conn, tenant).table(table);
}

const TaskDependencyModel = {
    addDependency: async (
        knexOrTrx: Knex | Knex.Transaction,
        tenant: string,
        predecessorTaskId: string,
        successorTaskId: string,
        dependencyType: DependencyType,
        leadLagDays: number = 0,
        notes?: string
    ): Promise<IProjectTaskDependency> => {
        if (!tenant) throw new Error('Tenant context is required for dependency operations');
        
        if (predecessorTaskId === successorTaskId) {
            throw new Error('A task cannot depend on itself.');
        }

        // Check for existing dependency first
        const existingDependency = await tenantScopedTable(knexOrTrx, 'project_task_dependencies', tenant)
            .where({
                predecessor_task_id: predecessorTaskId,
                successor_task_id: successorTaskId,
                dependency_type: dependencyType
            })
            .first();
            
        if (existingDependency) {
            throw new Error('This dependency already exists.');
        }

        // Check for circular dependencies (only for blocking relationships)
        if (dependencyType === 'blocks' || dependencyType === 'blocked_by') {
            await TaskDependencyModel.validateNoCycles(knexOrTrx, tenant, predecessorTaskId, successorTaskId);
        }
        
        try {
            const [dependency] = await tenantScopedTable(knexOrTrx, 'project_task_dependencies', tenant)
                .insert({
                    dependency_id: uuidv4(),
                    tenant,
                    predecessor_task_id: predecessorTaskId,
                    successor_task_id: successorTaskId,
                    dependency_type: dependencyType,
                    lead_lag_days: leadLagDays,
                    notes,
                    created_at: new Date(),
                    updated_at: new Date()
                })
                .returning('*');
                
            return dependency;
        } catch (error: any) {
            // Handle database constraint errors
            if (error.constraint === 'idx_unique_dependency_per_type') {
                throw new Error('This dependency already exists.');
            }
            throw error;
        }
    },
    
    getTaskDependencies: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, taskId: string): Promise<{
        predecessors: IProjectTaskDependency[], 
        successors: IProjectTaskDependency[]
    }> => {
        if (!tenant) throw new Error('Tenant context is required for dependency operations');
        
        // Task names and display fields come from the caller's authorized masked projection.
        const predecessors = await tenantScopedTable(knexOrTrx, 'project_task_dependencies', tenant)
            .where({ successor_task_id: taskId })
            .select('*') as IProjectTaskDependency[];
        const successors = await tenantScopedTable(knexOrTrx, 'project_task_dependencies', tenant)
            .where({ predecessor_task_id: taskId })
            .select('*') as IProjectTaskDependency[];

        return { predecessors, successors };
    },
    
    updateDependency: async (
        knexOrTrx: Knex | Knex.Transaction,
        tenant: string,
        dependencyId: string, 
        data: Partial<Pick<IProjectTaskDependency, 'lead_lag_days' | 'notes'>>
    ): Promise<IProjectTaskDependency> => {
        if (!tenant) throw new Error('Tenant context is required for dependency operations');
        
        const [dependency] = await tenantScopedTable(knexOrTrx, 'project_task_dependencies', tenant)
            .where({ dependency_id: dependencyId })
            .update({
                ...data,
                updated_at: new Date()
            })
            .returning('*');
            
        return dependency;
    },
    
    removeDependency: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, dependencyId: string): Promise<void> => {
        if (!tenant) throw new Error('Tenant context is required for dependency operations');
        
        await tenantScopedTable(knexOrTrx, 'project_task_dependencies', tenant)
            .where({ dependency_id: dependencyId })
            .delete();
    },
    
    validateNoCycles: async (
        db: Knex | Knex.Transaction,
        tenant: string,
        predecessorTaskId: string,
        successorTaskId: string
    ): Promise<void> => {
        const visited = new Set<string>();
        const path = new Set<string>();
        
        async function hasPath(currentTaskId: string, targetTaskId: string): Promise<boolean> {
            if (currentTaskId === targetTaskId) return true;
            if (path.has(currentTaskId)) return true;
            if (visited.has(currentTaskId)) return false;
            
            visited.add(currentTaskId);
            path.add(currentTaskId);
            
            const dependencies = await tenantScopedTable(db, 'project_task_dependencies', tenant)
                .where({ 
                    predecessor_task_id: currentTaskId, 
                })
                .whereIn('dependency_type', ['blocks', 'blocked_by'])
                .select('successor_task_id') as SuccessorTaskIdRow[];
                
            for (const dep of dependencies) {
                if (await hasPath(dep.successor_task_id, targetTaskId)) {
                    return true;
                }
            }
            
            path.delete(currentTaskId);
            return false;
        }
        
        if (await hasPath(successorTaskId, predecessorTaskId)) {
            throw new Error('Adding this dependency would create a circular reference.');
        }
    },
    
    suggestDependencyType: (
        predecessorType: string,
        _successorType: string
    ): DependencyType => {
        if (predecessorType === 'bug') return 'blocks';
        
        return 'related_to';
    }
};

export default TaskDependencyModel;
