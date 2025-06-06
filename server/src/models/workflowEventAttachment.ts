import { BaseModel } from './BaseModel';
import type { Knex } from 'knex';
import { 
  IWorkflowEventAttachment, 
  ICreateWorkflowEventAttachment, 
  IUpdateWorkflowEventAttachment 
} from '@shared/workflow/types/eventCatalog';

/**
 * Model for workflow event attachments
 */
export class WorkflowEventAttachmentModel extends BaseModel {
  /**
   * Create a new workflow event attachment
   * 
   * @param knex Knex instance
   * @param data Workflow event attachment data
   * @returns The created workflow event attachment
   */
  static async create(
    knexOrTrx: Knex | Knex.Transaction,
    // Assuming ICreateWorkflowEventAttachment now has event_type instead of event_id
    data: ICreateWorkflowEventAttachment
  ): Promise<IWorkflowEventAttachment> {
    const [attachment] = await knexOrTrx('workflow_event_attachments')
      .insert({
        ...data,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
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
    knexOrTrx: Knex | Knex.Transaction,
    attachmentId: string,
    tenantId: string // Keep tenantId for potential RLS or future use, though not used for system query
  ): Promise<(IWorkflowEventAttachment & { isSystemManaged: boolean }) | null> { // Add flag to return type
    // Try tenant table first
    const tenantAttachment = await knexOrTrx('workflow_event_attachments')
      .select('*', knexOrTrx.raw('false as "isSystemManaged"'))
      .where({
        attachment_id: attachmentId,
        tenant: tenantId // Filter by tenant
      })
      .first();

    if (tenantAttachment) {
      // Add the isSystemManaged property explicitly if needed by the type, though raw select handles it
      // return { ...tenantAttachment, isSystemManaged: false };
      return tenantAttachment;
    }

    // // If not found, try system table (Commented out as system table modification is out of scope)
    // const systemAttachment = await knexOrTrx('system_workflow_event_attachments')
    //   .select('*', knexOrTrx.raw('true as "isSystemManaged"'))
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
    knexOrTrx: Knex | Knex.Transaction,
    workflowId: string,
    eventType: string, // Changed parameter name
    tenantId: string
  ): Promise<(IWorkflowEventAttachment & { isSystemManaged: boolean }) | null> { // Add flag to return type
    // Try tenant table first
    const tenantAttachment = await knexOrTrx('workflow_event_attachments')
      .select('*', knexOrTrx.raw('false as "isSystemManaged"'))
      .where({
        workflow_id: workflowId,
        event_type: eventType, // Changed column name
        tenant: tenantId // Filter by tenant
      })
      .first();

    if (tenantAttachment) {
      // Assuming IWorkflowEventAttachment now has event_type
      return tenantAttachment;
    }

    // // If not found, try system table (Commented out as system table modification is out of scope)
    // const systemAttachment = await knexOrTrx('system_workflow_event_attachments')
    //   .select('*', knexOrTrx.raw('true as "isSystemManaged"'))
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
    knexOrTrx: Knex | Knex.Transaction,
    workflowId: string,
    tenantId: string,
    options: {
      isActive?: boolean;
    } = {}
  ): Promise<(IWorkflowEventAttachment & { isSystemManaged: boolean })[]> { // Add flag to return type
    const { isActive } = options;

    // Tenant-specific attachments
    const tenantQuery = knexOrTrx('workflow_event_attachments')
      .select('*', knexOrTrx.raw('false as "isSystemManaged"'))
      .where({
        workflow_id: workflowId,
        tenant: tenantId
      });

    if (isActive !== undefined) {
      tenantQuery.where('is_active', isActive);
    }

    // // System attachments (Commented out as system table modification is out of scope)
    // const systemQuery = knexOrTrx('system_workflow_event_attachments')
    //   .select('*', knexOrTrx.raw('true as "isSystemManaged"'))
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
    // const attachments = await knexOrTrx
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
    knexOrTrx: Knex | Knex.Transaction,
    eventType: string, // Changed parameter name
    tenantId: string,
    options: {
      isActive?: boolean;
    } = {}
  ): Promise<(IWorkflowEventAttachment & { isSystemManaged: boolean })[]> { // Add isSystemManaged to return type
    const { isActive } = options;

    // Tenant-specific attachments
    const tenantQuery = knexOrTrx('workflow_event_attachments as wea')
      .join('workflow_registrations as wr', 'wea.workflow_id', 'wr.registration_id') // Join with tenant workflow registrations
      .join('workflow_registration_versions as wrv', function() { // Join with tenant workflow versions
        this.on('wr.registration_id', '=', 'wrv.registration_id')
            .andOn('wr.tenant', '=', 'wrv.tenant')
            .andOn('wrv.is_current', '=', knexOrTrx.raw('?', [true])); // Join only on current version
      })
      .select(
        'wea.*', // Select all columns from workflow_event_attachments
        'wr.name as workflow_name', // Select workflow name from tenant registrations
        'wrv.version as workflow_version', // Select workflow version from tenant versions
        knexOrTrx.raw('false as "isSystemManaged"') // Add isSystemManaged flag
      )
      .where({
        'wea.event_type': eventType, // Changed column name, use alias
        'wea.tenant': tenantId, // Use alias
        'wr.tenant': tenantId // Ensure tenant registration matches tenant
      });

    if (isActive !== undefined) {
      tenantQuery.where('wea.is_active', isActive); // Use alias
    }

    // System attachments
    const systemQuery = knexOrTrx('workflow_event_attachments as wea')
      .join('system_workflow_registrations as swr', 'wea.workflow_id', 'swr.registration_id') // Join with system workflow registrations
      .join('system_workflow_registration_versions as swrv', function() { // Join with system workflow versions
        this.on('swr.registration_id', '=', 'swrv.registration_id')
            .andOn('swrv.is_current', '=', knexOrTrx.raw('?', [true])); // Join only on current version
      })
      .select(
        'wea.*', // Select all columns from workflow_event_attachments
        'swr.name as workflow_name', // Select workflow name from system registrations
        'swrv.version as workflow_version', // Select workflow version from system versions
        knexOrTrx.raw('true as "isSystemManaged"') // Add isSystemManaged flag
      )
      .where({
        'wea.event_type': eventType, // Use alias
        'wea.tenant': tenantId // Use alias (system attachments are also tenant-specific in this table)
      });

    if (isActive !== undefined) {
      systemQuery.where('wea.is_active', isActive); // Use alias
    }

    // Combine results
    const attachments = await knexOrTrx
      .unionAll([tenantQuery, systemQuery], true) // Wrap union in subquery for ordering
      .orderBy('created_at', 'asc');

    // Assuming IWorkflowEventAttachment now has event_type, workflow_name, and workflow_version
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
    knexOrTrx: Knex | Knex.Transaction,
    attachmentId: string,
    tenantId: string,
    data: IUpdateWorkflowEventAttachment
  ): Promise<IWorkflowEventAttachment | null> {
    const [attachment] = await knexOrTrx('workflow_event_attachments')
      .where({
        attachment_id: attachmentId,
        tenant: tenantId
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
    knexOrTrx: Knex | Knex.Transaction,
    attachmentId: string,
    tenantId: string
  ): Promise<boolean> {
    const result = await knexOrTrx('workflow_event_attachments')
      .where({
        attachment_id: attachmentId,
        tenant: tenantId
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
   * @returns Array of workflow IDs, name, version, and isSystemManaged flag
   */
  static async getWorkflowsForEventType(
    knexOrTrx: Knex | Knex.Transaction,
    eventType: string,
    tenantId: string
  ): Promise<{ workflow_id: string; workflow_name: string; workflow_version: string; isSystemManaged: boolean }[]> { // Updated return type
    // Tenant-specific attachments using the new event_type column directly
    const tenantQuery = knexOrTrx('workflow_event_attachments as wea')
      .join('workflow_registrations as wr', 'wea.workflow_id', 'wr.registration_id') // Join with tenant workflow registrations
      .join('workflow_registration_versions as wrv', function() { // Join with tenant workflow versions
        this.on('wr.registration_id', '=', 'wrv.registration_id')
            .andOn('wr.tenant', '=', 'wrv.tenant')
            .andOn('wrv.is_current', '=', knexOrTrx.raw('?', [true])); // Join only on current version
      })
      .where({
        'wea.event_type': eventType,
        'wea.tenant': tenantId,
        'wea.is_active': true,
        'wr.tenant': tenantId // Ensure tenant registration matches tenant
      })
      .select(
        'wea.workflow_id',
        'wr.name as workflow_name', // Select workflow name from tenant registrations
        'wrv.version as workflow_version', // Select workflow version from tenant versions
        knexOrTrx.raw('false as "isSystemManaged"') // Add flag
      );

    // System attachments
    const systemQuery = knexOrTrx('workflow_event_attachments as wea')
      .join('system_workflow_registrations as swr', 'wea.workflow_id', 'swr.registration_id') // Join with system workflow registrations
      .join('system_workflow_registration_versions as swrv', function() { // Join with system workflow versions
        this.on('swr.registration_id', '=', 'swrv.registration_id')
            .andOn('swrv.is_current', '=', knexOrTrx.raw('?', [true])); // Join only on current version
      })
      .where({
        'wea.event_type': eventType,
        'wea.tenant': tenantId, // System attachments are also tenant-specific in this table
        'wea.is_active': true
      })
      .select(
        'wea.workflow_id',
        'swr.name as workflow_name', // Select workflow name from system registrations
        'swrv.version as workflow_version', // Select workflow version from system versions
        knexOrTrx.raw('true as "isSystemManaged"') // Add flag
      );

    // Combine results
    const results = await knexOrTrx
      .unionAll([tenantQuery, systemQuery], true); // Wrap union

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
    knexOrTrx: Knex | Knex.Transaction,
    tenantId: string,
    workflowEventMap: Record<string, string[]>
  ): Promise<number> {
    console.log(`[Model] Deleting attachments for tenant ${tenantId} based on system workflow names and event types:`, workflowEventMap);

    // Build the WHERE clause dynamically based on the map
    // Modify the query to use event_type directly from workflow_event_attachments
    const deleteQuery = knexOrTrx('workflow_event_attachments as wea')
      .join('system_workflow_registrations as swr', 'wea.workflow_id', 'swr.registration_id') // Join to get workflow name from system registrations
      .where('wea.tenant', tenantId) // Filter attachments by tenant
      .where(function(this: Knex.QueryBuilder) { // Add type for 'this'
          let isFirstCondition = true;
          for (const workflowName in workflowEventMap) {
              const eventTypes = workflowEventMap[workflowName];
              if (eventTypes && eventTypes.length > 0) {
                  const condition = function(this: Knex.QueryBuilder) { // Add type for 'this'
                      this.where('swr.name', workflowName) // Use swr.name
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
