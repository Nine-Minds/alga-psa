'use server'

import { Knex } from 'knex'; // Import Knex type
import { tenantDb } from '@alga-psa/db';

/**
 * Helper function to get client_id from a work_item (ticket or project_task).
 * @param trx Knex transaction object.
 * @param tenant The tenant identifier.
 * @param workItemId The ID of the work item.
 * @param workItemType The type of the work item ('ticket' or 'project_task').
 * @returns The client_id associated with the work item, or null if not found or not applicable.
 */
export async function getClientIdForWorkItem(trx: Knex.Transaction, tenant: string, workItemId: string, workItemType: string): Promise<string | null> {
    const scopedDb = tenantDb(trx, tenant) as any;
    if (workItemType === 'ticket') {
        const ticket = await scopedDb.table('tickets')
            .where({ ticket_id: workItemId })
            .first('client_id');
        return ticket?.client_id || null;
    } else if (workItemType === 'project_task') {
        const taskQuery = scopedDb.table('project_tasks')
            .where({ 'project_tasks.task_id': workItemId })
            .first('projects.client_id');
        scopedDb.tenantJoin(taskQuery, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
        scopedDb.tenantJoin(taskQuery, 'projects', 'project_phases.project_id', 'projects.project_id');
        const task = await taskQuery;
        return task?.client_id || null;
    } else if (workItemType === 'interaction') {
        const interaction = await scopedDb.table('interactions')
            .where({ interaction_id: workItemId })
            .first('client_id');
        return interaction?.client_id || null;
    }
    // Add other work item types if they can be associated with clients and buckets (e.g., ad_hoc if linked to a client)
    // For now, tickets, project tasks, and interactions are assumed to link to clients for contract lines.
    return null;
}
