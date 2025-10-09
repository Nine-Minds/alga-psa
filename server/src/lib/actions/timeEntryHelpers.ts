'use server'

import { Knex } from 'knex'; // Import Knex type

/**
 * Helper function to get client_id from a work_item (ticket or project_task).
 * @param trx Knex transaction object.
 * @param tenant The tenant identifier.
 * @param workItemId The ID of the work item.
 * @param workItemType The type of the work item ('ticket' or 'project_task').
 * @returns The client_id associated with the work item, or null if not found or not applicable.
 */
export async function getClientIdForWorkItem(trx: Knex.Transaction, tenant: string, workItemId: string, workItemType: string): Promise<string | null> {
    if (workItemType === 'ticket') {
        const ticket = await trx('tickets')
            .where({ ticket_id: workItemId, tenant })
            .first('client_id');
        return ticket?.client_id || null;
    } else if (workItemType === 'project_task') {
        const task = await trx('project_tasks')
            .join('project_phases', function() {
                this.on('project_tasks.phase_id', '=', 'project_phases.phase_id')
                    .andOn('project_tasks.tenant', '=', 'project_phases.tenant');
            })
            .join('projects', function() {
                this.on('project_phases.project_id', '=', 'projects.project_id')
                    .andOn('project_phases.tenant', '=', 'projects.tenant');
            })
            .where({ 'project_tasks.task_id': workItemId, 'project_tasks.tenant': tenant })
            .first('projects.client_id');
        return task?.client_id || null;
    } else if (workItemType === 'interaction') {
        const interaction = await trx('interactions')
            .where({ interaction_id: workItemId, tenant })
            .first('client_id');
        return interaction?.client_id || null;
    }
    // Add other work item types if they can be associated with clients and buckets (e.g., ad_hoc if linked to a client)
    // For now, tickets, project tasks, and interactions are assumed to link to clients for contract lines.
    return null;
}