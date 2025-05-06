import { Knex } from 'knex';
import { 
  IWorkflowEventAttachment, 
  ICreateWorkflowEventAttachment, 
  IUpdateWorkflowEventAttachment 
} from '@shared/workflow/types/eventCatalog';

/**
 * Model for workflow event attachments
 */
export class WorkflowEventAttachmentModel {
  /**
   * Create a new workflow event attachment
   * 
   * @param knex Knex instance
   * @param data Workflow event attachment data
   * @returns The created workflow event attachment
   */
  static async create(
    knex: Knex,
    // Assuming ICreateWorkflowEventAttachment now has event_type instead of event_id
    data: ICreateWorkflowEventAttachment
  ): Promise<IWorkflowEventAttachment> {
    const [attachment] = await knex('workflow_event_attachments')
      .insert(data)
      .returning('*');
    
    return attachment;
  }

  /**
   * Get a workflow event attachment by ID
   * 
   * @param knex Knex instance
   * @param attachmentId Attachment ID
   * @param tenantId Tenant ID
   * @returns The workflow event attachment or null if not found
   */
  static async getById(
    knex: Knex,
    attachmentId: string,
    tenantId: string // Keep tenantId for potential RLS or future use, though not used for system query
  ): Promise<(IWorkflowEventAttachment & { isSystemManaged: boolean }) | null> { // Add flag to return type
    // Try tenant table first
    const tenantAttachment = await knex('workflow_event_attachments')
      .select('*', knex.raw('false as "isSystemManaged"'))
      .where({
        attachment_id: attachmentId,
        tenant_id: tenantId // Filter by tenant
      })
      .first();

    if (tenantAttachment) {
      // Add the isSystemManaged property explicitly if needed by the type, though raw select handles it
      // return { ...tenantAttachment, isSystemManaged: false };
      return tenantAttachment;
    }

    // // If not found, try system table (Commented out as system table modification is out of scope)
    // const systemAttachment = await knex('system_workflow_event_attachments')
    //   .select('*', knex.raw('true as "isSystemManaged"'))
    //   .where({
    //     attachment_id: attachmentId
    //     // No tenant filter for system table
    //   })
    //   .first();
    //
    // // Add the isSystemManaged property explicitly if needed by the type
    // // return systemAttachment ? { ...systemAttachment, isSystemManaged: true } : null;
    // return systemAttachment || null;
    return null; // Return null if not found in tenant table
  }

  /**
   * Get a workflow event attachment by workflow ID and event ID
   * 
   * @param knex Knex instance
   * @param workflowId Workflow ID
   * @param eventType Event Type
   * @param tenantId Tenant ID
   * @returns The workflow event attachment or null if not found
   */
  static async getByWorkflowAndEventType( // Renamed method
    knex: Knex,
    workflowId: string,
    eventType: string, // Changed parameter name
    tenantId: string
  ): Promise<(IWorkflowEventAttachment & { isSystemManaged: boolean }) | null> { // Add flag to return type
    // Try tenant table first
    const tenantAttachment = await knex('workflow_event_attachments')
      .select('*', knex.raw('false as "isSystemManaged"'))
      .where({
        workflow_id: workflowId,
        event_type: eventType, // Changed column name
        tenant_id: tenantId // Filter by tenant
      })
      .first();

    if (tenantAttachment) {
      // Assuming IWorkflowEventAttachment now has event_type
      return tenantAttachment;
    }

    // // If not found, try system table (Commented out as system table modification is out of scope)
    // const systemAttachment = await knex('system_workflow_event_attachments')
    //   .select('*', knex.raw('true as "isSystemManaged"'))
    //   .where({
    //     workflow_id: workflowId,
    //     event_type: eventType // Assuming system table also uses event_type
    //     // No tenant filter for system table
    //   })
    //   .first();
    //
    // return systemAttachment || null;
    return null; // Return null if not found in tenant table
  }

  /**
   * Get all workflow event attachments for a workflow
   * 
   * @param knex Knex instance
   * @param workflowId Workflow ID
   * @param tenantId Tenant ID
   * @param options Query options
   * @returns Array of workflow event attachments
   */
  static async getAllForWorkflow(
    knex: Knex,
    workflowId: string,
    tenantId: string,
    options: {
      isActive?: boolean;
    } = {}
  ): Promise<(IWorkflowEventAttachment & { isSystemManaged: boolean })[]> { // Add flag to return type
    const { isActive } = options;

    // Tenant-specific attachments
    const tenantQuery = knex('workflow_event_attachments')
      .select('*', knex.raw('false as "isSystemManaged"'))
      .where({
        workflow_id: workflowId,
        tenant_id: tenantId
      });

    if (isActive !== undefined) {
      tenantQuery.where('is_active', isActive);
    }

    // // System attachments (Commented out as system table modification is out of scope)
    // const systemQuery = knex('system_workflow_event_attachments')
    //   .select('*', knex.raw('true as "isSystemManaged"'))
    //   .where({
    //     workflow_id: workflowId // Match the same workflowId
    //   });
    //
    //  if (isActive !== undefined) {
    //   systemQuery.where('is_active', isActive);
    // }
    //
    // // Combine results - only one of the queries should return results for a given workflowId
    // // unless a system workflow somehow has the same ID as a tenant one (unlikely with UUIDs)
    // const attachments = await knex
    //   .unionAll([tenantQuery, systemQuery], true) // Wrap union for ordering
    //   .orderBy('created_at', 'asc');

    // Return only tenant attachments for now
    const attachments = await tenantQuery.orderBy('created_at', 'asc');

    // Assuming IWorkflowEventAttachment now has event_type
    return attachments;
  }

  /**
   * Get all workflow event attachments for an event
   * 
   * @param knex Knex instance
   * @param eventType Event Type
   * @param tenantId Tenant ID
   * @param options Query options
   * @returns Array of workflow event attachments
   */
  static async getAllForEventType( // Renamed method
    knex: Knex,
    eventType: string, // Changed parameter name
    tenantId: string,
    options: {
      isActive?: boolean;
    } = {}
  ): Promise<(IWorkflowEventAttachment & { isSystemManaged: boolean })[]> { // Add isSystemManaged to return type
    const { isActive } = options;

    // Tenant-specific attachments
    const tenantQuery = knex('workflow_event_attachments')
      .select('*', knex.raw('false as "isSystemManaged"')) // Add isSystemManaged flag
      .where({
        event_type: eventType, // Changed column name
        tenant_id: tenantId
      });

    if (isActive !== undefined) {
      tenantQuery.where('is_active', isActive);
    }

    // // System attachments (Commented out as system table modification is out of scope)
    // const systemQuery = knex('system_workflow_event_attachments')
    //   .select('*', knex.raw('true as "isSystemManaged"')) // Add isSystemManaged flag
    //   .where({
    //     event_type: eventType // Assuming system table also uses event_type
    //   });
    //
    // if (isActive !== undefined) {
    //   systemQuery.where('is_active', isActive);
    // }
    //
    // // Combine results
    // const attachments = await knex
    //   .unionAll([tenantQuery, systemQuery], true) // Wrap union in subquery for ordering
    //   .orderBy('created_at', 'asc');

    // Return only tenant attachments for now
    const attachments = await tenantQuery.orderBy('created_at', 'asc');

    // Assuming IWorkflowEventAttachment now has event_type
    return attachments;
  }

  /**
   * Update a workflow event attachment
   * 
   * @param knex Knex instance
   * @param attachmentId Attachment ID
   * @param tenantId Tenant ID
   * @param data Update data
   * @returns The updated workflow event attachment
   */
  static async update(
    knex: Knex,
    attachmentId: string,
    tenantId: string,
    data: IUpdateWorkflowEventAttachment
  ): Promise<IWorkflowEventAttachment | null> {
    const [attachment] = await knex('workflow_event_attachments')
      .where({
        attachment_id: attachmentId,
        tenant_id: tenantId
      })
      .update({
        ...data,
        updated_at: new Date().toISOString()
      })
      .returning('*');
    
    return attachment || null;
  }

  /**
   * Delete a workflow event attachment
   * 
   * @param knex Knex instance
   * @param attachmentId Attachment ID
   * @param tenantId Tenant ID
   * @returns True if the attachment was deleted, false otherwise
   */
  static async delete(
    knex: Knex,
    attachmentId: string,
    tenantId: string
  ): Promise<boolean> {
    const result = await knex('workflow_event_attachments')
      .where({
        attachment_id: attachmentId,
        tenant_id: tenantId
      })
      .delete();
    
    return result !== 0;
  }

  /**
   * Get all workflows attached to an event type
   * 
   * @param knex Knex instance
   * @param eventType Event type
   * @param tenantId Tenant ID
   * @returns Array of workflow IDs
   */
  static async getWorkflowsForEventType(
    knex: Knex,
    eventType: string,
    tenantId: string
  ): Promise<{ workflow_id: string; isSystemManaged: boolean }[]> {
    // Tenant-specific attachments using the new event_type column directly
    const tenantQuery = knex('workflow_event_attachments')
      .where({
        event_type: eventType,
        tenant_id: tenantId,
        is_active: true
      })
      .select('workflow_id', knex.raw('false as "isSystemManaged"')); // Add flag

    // // System attachments (Commented out as system table modification is out of scope)
    // const systemQuery = knex('system_workflow_event_attachments')
    //   .where({
    //     event_type: eventType, // Assuming system table also uses event_type
    //     // No tenant filter for system workflows
    //     is_active: true
    //   })
    //   .select('workflow_id', knex.raw('true as "isSystemManaged"')); // Add flag
    //
    // // Combine results
    // const results = await knex
    //   .unionAll([tenantQuery, systemQuery], true); // Wrap union
    //
    // return results;

    // Return only tenant results for now
    const results = await tenantQuery;
    return results;
  }

  /**
   * Delete tenant-specific attachments linked to specific system workflows and event types.
   * Used during integration disconnection (e.g., QBO).
   *
   * @param knex Knex instance
   * @param tenantId Tenant ID
   * @param workflowEventMap A map where keys are system workflow names and values are arrays of event types.
   * @returns The number of deleted attachments.
   */
  static async deleteSystemWorkflowAttachmentsForTenant(
    knex: Knex,
    tenantId: string,
    workflowEventMap: Record<string, string[]>
  ): Promise<number> {
    console.log(`[Model] Deleting attachments for tenant ${tenantId} based on system workflow names and event types:`, workflowEventMap);

    // Build the WHERE clause dynamically based on the map
    // Modify the query to use event_type directly from workflow_event_attachments
    const deleteQuery = knex('workflow_event_attachments as wea')
      .join('system_workflows as sw', 'wea.workflow_id', 'sw.workflow_id') // Join to get workflow name
      .where('wea.tenant_id', tenantId) // Filter attachments by tenant
      .where(function(this: Knex.QueryBuilder) { // Add type for 'this'
          let isFirstCondition = true;
          for (const workflowName in workflowEventMap) {
              const eventTypes = workflowEventMap[workflowName];
              if (eventTypes && eventTypes.length > 0) {
                  const condition = function(this: Knex.QueryBuilder) { // Add type for 'this'
                      this.where('sw.name', workflowName)
                          .whereIn('wea.event_type', eventTypes); // Use event_type from wea
                  };
                  if (isFirstCondition) {
                      this.where(condition);
                      isFirstCondition = false;
                  } else {
                      this.orWhere(condition);
                  }
              }
          }
          // If the map was empty or invalid, this where clause might be empty,
          // which is okay, the outer tenantId filter will still apply.
          // If no conditions were added, potentially add a clause that ensures nothing is deleted.
          if (isFirstCondition) {
              console.warn("[Model] No valid workflow/event combinations provided for deletion. Adding 'where false'.");
              this.whereRaw('false'); // Prevent accidental deletion if map is empty
          }
      });

      // Execute the delete operation
      const deleteResult = await deleteQuery.delete();

      console.log(`[Model] Deleted ${deleteResult} attachments for tenant ${tenantId} matching criteria.`);
      return deleteResult;
  }
}