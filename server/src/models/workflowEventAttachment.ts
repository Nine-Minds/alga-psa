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

    // If not found, try system table
    const systemAttachment = await knex('system_workflow_event_attachments')
      .select('*', knex.raw('true as "isSystemManaged"'))
      .where({
        attachment_id: attachmentId
        // No tenant filter for system table
      })
      .first();

    // Add the isSystemManaged property explicitly if needed by the type
    // return systemAttachment ? { ...systemAttachment, isSystemManaged: true } : null;
    return systemAttachment || null;
  }

  /**
   * Get a workflow event attachment by workflow ID and event ID
   * 
   * @param knex Knex instance
   * @param workflowId Workflow ID
   * @param eventId Event ID
   * @param tenantId Tenant ID
   * @returns The workflow event attachment or null if not found
   */
  static async getByWorkflowAndEvent(
    knex: Knex,
    workflowId: string,
    eventId: string,
    tenantId: string
  ): Promise<(IWorkflowEventAttachment & { isSystemManaged: boolean }) | null> { // Add flag to return type
    // Try tenant table first
    const tenantAttachment = await knex('workflow_event_attachments')
      .select('*', knex.raw('false as "isSystemManaged"'))
      .where({
        workflow_id: workflowId,
        event_id: eventId,
        tenant_id: tenantId // Filter by tenant
      })
      .first();

    if (tenantAttachment) {
      return tenantAttachment;
    }

    // If not found, try system table
    const systemAttachment = await knex('system_workflow_event_attachments')
      .select('*', knex.raw('true as "isSystemManaged"'))
      .where({
        workflow_id: workflowId,
        event_id: eventId
        // No tenant filter for system table
      })
      .first();

    return systemAttachment || null;
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

    // System attachments
    const systemQuery = knex('system_workflow_event_attachments')
      .select('*', knex.raw('true as "isSystemManaged"'))
      .where({
        workflow_id: workflowId // Match the same workflowId
      });

     if (isActive !== undefined) {
      systemQuery.where('is_active', isActive);
    }

    // Combine results - only one of the queries should return results for a given workflowId
    // unless a system workflow somehow has the same ID as a tenant one (unlikely with UUIDs)
    const attachments = await knex
      .unionAll([tenantQuery, systemQuery], true) // Wrap union for ordering
      .orderBy('created_at', 'asc');

    return attachments;
  }

  /**
   * Get all workflow event attachments for an event
   * 
   * @param knex Knex instance
   * @param eventId Event ID
   * @param tenantId Tenant ID
   * @param options Query options
   * @returns Array of workflow event attachments
   */
  static async getAllForEvent(
    knex: Knex,
    eventId: string,
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
        event_id: eventId,
        tenant_id: tenantId
      });

    if (isActive !== undefined) {
      tenantQuery.where('is_active', isActive);
    }

    // System attachments
    const systemQuery = knex('system_workflow_event_attachments')
      .select('*', knex.raw('true as "isSystemManaged"')) // Add isSystemManaged flag
      .where({
        event_id: eventId
      });

    if (isActive !== undefined) {
      systemQuery.where('is_active', isActive);
    }

    // Combine results
    const attachments = await knex
      .unionAll([tenantQuery, systemQuery], true) // Wrap union in subquery for ordering
      .orderBy('created_at', 'asc');

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
  ): Promise<{ workflow_id: string; isSystemManaged: boolean }[]> { // Update return type
    // Tenant-specific attachments
    const tenantQuery = knex('workflow_event_attachments as wea')
      .join('event_catalog as ec', function() {
        // Assuming event_catalog is tenant-specific or has tenant_id
        this.on('wea.event_id', 'ec.event_id')
            .andOn('wea.tenant_id', 'ec.tenant_id');
      })
      .where({
        'ec.event_type': eventType,
        'wea.tenant_id': tenantId,
        'wea.is_active': true
      })
      .select('wea.workflow_id', knex.raw('false as "isSystemManaged"')); // Add flag

    // System attachments
    // Assuming event_catalog is global or has a separate system version
    // If event_catalog is purely tenant-specific, system workflows cannot be triggered by event type directly
    // Let's assume event_catalog is global for now.
    const systemQuery = knex('system_workflow_event_attachments as swea')
      .join('event_catalog as ec', 'swea.event_id', 'ec.event_id') // Join on event_id only
      .where({
        'ec.event_type': eventType,
        // No tenant filter for system workflows
        'swea.is_active': true
      })
      .select('swea.workflow_id', knex.raw('true as "isSystemManaged"')); // Add flag

    // Combine results
    const results = await knex
      .unionAll([tenantQuery, systemQuery], true); // Wrap union

    // No specific order needed here, just return the combined list
    return results;
  }
}