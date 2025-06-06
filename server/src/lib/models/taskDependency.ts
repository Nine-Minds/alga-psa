import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@shared/db';
import { IProjectTaskDependency, DependencyType } from 'server/src/interfaces/project.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { Knex } from 'knex';

const TaskDependencyModel = {
    addDependency: async (
        predecessorTaskId: string,
        successorTaskId: string,
        dependencyType: DependencyType,
        leadLagDays: number = 0,
        notes?: string
    ): Promise<IProjectTaskDependency> => {
        const { knex: db, tenant } = await createTenantKnex();
        
        if (predecessorTaskId === successorTaskId) {
            throw new Error('A task cannot depend on itself.');
        }

        return await withTransaction(db, async (trx) => {
            const schedulingTypes: DependencyType[] = ['finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish', 'blocks'];
            if (schedulingTypes.includes(dependencyType)) {
                await TaskDependencyModel.validateNoCycles(trx, tenant!, predecessorTaskId, successorTaskId);
            }
            
            const [dependency] = await trx('project_task_dependencies')
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
        });
    },
    
    getTaskDependencies: async (taskId: string): Promise<{
        predecessors: IProjectTaskDependency[], 
        successors: IProjectTaskDependency[]
    }> => {
        const { knex: db, tenant } = await createTenantKnex();
        
        return await withTransaction(db, async (trx) => {
            const predecessors = await trx('project_task_dependencies as ptd')
                .where({ 'ptd.successor_task_id': taskId, 'ptd.tenant': tenant })
                .leftJoin('project_tasks as pt_pred', function() {
                    this.on('ptd.predecessor_task_id', '=', 'pt_pred.task_id')
                        .andOn('ptd.tenant', '=', 'pt_pred.tenant');
                })
                .select('ptd.*', 
                        'pt_pred.task_name as predecessor_task_name', 
                        'pt_pred.wbs_code as predecessor_task_wbs_code',
                        'pt_pred.task_type_key as predecessor_task_type_key');
                
            const successors = await trx('project_task_dependencies as ptd')
                .where({ 'ptd.predecessor_task_id': taskId, 'ptd.tenant': tenant })
                .leftJoin('project_tasks as pt_succ', function() {
                    this.on('ptd.successor_task_id', '=', 'pt_succ.task_id')
                        .andOn('ptd.tenant', '=', 'pt_succ.tenant');
                })
                .select('ptd.*', 
                        'pt_succ.task_name as successor_task_name', 
                        'pt_succ.wbs_code as successor_task_wbs_code',
                        'pt_succ.task_type_key as successor_task_type_key');
            
            return { 
                predecessors: predecessors.map(d => ({
                    ...d, 
                    predecessor_task: { 
                        task_id: d.predecessor_task_id, 
                        task_name: d.predecessor_task_name, 
                        wbs_code: d.predecessor_task_wbs_code,
                        task_type_key: d.predecessor_task_type_key
                    }
                })), 
                successors: successors.map(d => ({
                    ...d, 
                    successor_task: { 
                        task_id: d.successor_task_id, 
                        task_name: d.successor_task_name, 
                        wbs_code: d.successor_task_wbs_code,
                        task_type_key: d.successor_task_type_key
                    }
                }))
            };
        });
    },
    
    updateDependency: async (
        dependencyId: string, 
        data: Partial<Pick<IProjectTaskDependency, 'lead_lag_days' | 'notes'>>
    ): Promise<IProjectTaskDependency> => {
        const { knex: db, tenant } = await createTenantKnex();
        
        return await withTransaction(db, async (trx) => {
            const [dependency] = await trx('project_task_dependencies')
                .where({ dependency_id: dependencyId, tenant })
                .update({
                    ...data,
                    updated_at: new Date()
                })
                .returning('*');
                
            return dependency;
        });
    },
    
    removeDependency: async (dependencyId: string): Promise<void> => {
        const { knex: db, tenant } = await createTenantKnex();
        
        await withTransaction(db, async (trx) => {
            await trx('project_task_dependencies')
                .where({ dependency_id: dependencyId, tenant })
                .delete();
        });
    },
    
    validateNoCycles: async (
        db: Knex,
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
            
            const dependencies = await db('project_task_dependencies')
                .where({ 
                    predecessor_task_id: currentTaskId, 
                    tenant,
                })
                .whereIn('dependency_type', ['finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish', 'blocks'])
                .select('successor_task_id');
                
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
        successorType: string
    ): DependencyType => {
        if (predecessorType === 'bug') return 'blocks';
        
        if (predecessorType === 'epic' && ['story', 'task'].includes(successorType)) {
            return 'finish_to_start';
        }
        
        if (predecessorType === 'feature' && successorType === 'feature') {
            return 'start_to_start';
        }
        
        if (predecessorType === 'task' && successorType === 'bug') {
            return 'finish_to_start';
        }
        
        return 'finish_to_start';
    }
};

export default TaskDependencyModel;