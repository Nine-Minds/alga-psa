'use server';
import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { z } from "zod";
import { logger } from "@alga-psa/core";
import { v4 as uuidv4 } from 'uuid';

import { serializeWorkflowDefinition, deserializeWorkflowDefinition } from "@alga-psa/shared/workflow";
import { getWorkflowRuntime } from "@alga-psa/shared/workflow";
import { submitWorkflowEventAction } from "./workflow-event-actions";
import { createWorkflowEventAttachment, deleteWorkflowEventAttachment } from "./workflow-event-attachment-actions";
import { EventCatalogModel } from '@alga-psa/workflows/models/eventCatalog';
import { validateWorkflowCode, checkWorkflowSecurity } from '@alga-psa/workflows/lib/workflowValidation';
import { EventType, EventTypeEnum, ICreateEventCatalogEntry } from "@alga-psa/shared/workflow";
import { WorkflowRegistrationModel } from "@alga-psa/shared/workflow";

// Zod schema for workflow data

// Zod schema for workflow creation/update
const WorkflowSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, "Workflow name is required"),
  description: z.string().optional(),
  version: z.string().default("1.0.0"),
  tags: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
  code: z.string().min(1, "Workflow code is required"),
});

// Type for workflow data
export type WorkflowData = z.infer<typeof WorkflowSchema> & {
  // Add fields from WorkflowRegistration that might be needed by UI
  registration_id?: string; // Use id from schema if available, else registration_id
  description?: string;
  category?: string;
  tags?: string[];
  status?: string;
  source_template_id?: string;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
};

// Add the flag to the return type for actions
export type WorkflowDataWithSystemFlag = WorkflowData & { isSystemManaged: boolean };


// Type for workflow version data
export type WorkflowVersionData = {
  versionId: string;
  version: string;
  isCurrent: boolean;
  createdAt: string;
  createdBy: string;
};

// Type for workflow test execution result
interface WorkflowTestResult {
  success: boolean;
  executionId?: string;
  message: string;
  warnings?: string[];
}

/**
 * Create a new workflow
 *
 * @param data Workflow data
 * @returns Created workflow ID
 */
export const createWorkflow = withAuth(async (user, { tenant }, data: WorkflowData): Promise<string> => {
  let knexInstance;
  try {
    // Validate input
    const validatedData = WorkflowSchema.parse(data);

    // We no longer need to extract metadata from the code
    // The metadata comes from workflowData (validatedData)

    // Create Knex instance
    const { knex } = await createTenantKnex();
    knexInstance = knex;

    // Use a transaction to ensure both operations succeed or fail together
    return await knex.transaction(async (trx) => {
      // Create workflow definition
      const workflowDefinition = {
        metadata: {
          name: validatedData.name,
          description: validatedData.description || '',
          version: validatedData.version,
          author: `${user.first_name} ${user.last_name}`.trim(),
          tags: validatedData.tags,
        },
        executeFn: validatedData.code,
      };

      // Create workflow registration
      const [registration] = await trx('workflow_registrations')
        .insert({
          tenant: tenant,
          name: validatedData.name,
          description: validatedData.description || '',
          category: 'custom',
          tags: validatedData.tags, // Pass the array directly, not as a JSON string
          version: validatedData.version, // Add the version field
          status: validatedData.isActive ? 'active' : 'inactive',
          created_by: user.user_id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .returning('registration_id');


      // Create workflow version
      await trx('workflow_registration_versions')
        .insert({
          registration_id: registration.registration_id,
          tenant: tenant,
          version: validatedData.version,
          is_current: true,
          code: validatedData.code, // Use the new code field
          created_by: user.user_id,
          created_at: new Date().toISOString(),
        });

      return registration.registration_id;
    });
  } catch (error) {
    logger.error("Error creating workflow:", error);
    throw error;
  } finally {
    // Connection will be released automatically
  }
});

/**
 * Update an existing workflow
 *
 * @param id Workflow ID
 * @param data Workflow data
 * @returns Updated workflow ID
 */
export const updateWorkflow = withAuth(async (user, { tenant }, id: string, data: WorkflowData): Promise<string> => {
  let knexInstance;
  try {
    // Validate input
    const validatedData = WorkflowSchema.parse(data);

    // Create Knex instance
    const { knex } = await createTenantKnex();
    knexInstance = knex;

    // Use a transaction to ensure all operations succeed or fail together
    return await knex.transaction(async (trx) => {
      // Get the latest version
      const registration = await trx('workflow_registrations')
        .where({
          registration_id: id,
          tenant: tenant,
        })
        .first();

      if (!registration) {
        throw new Error(`Workflow with ID ${id} not found`);
      }

      // Auto-increment the version number
      // Format is expected to be like 1.0.0 or 1.2.3
      // We increment the rightmost segment
      let newVersion = validatedData.version;

      // Check for existing versions to avoid conflicts
      const existingVersions = await trx('workflow_registration_versions')
        .where({
          registration_id: id,
          tenant: tenant
        })
        .select('version')
        .orderBy('created_at', 'desc');

      // Create a set of existing versions for quick lookup
      const existingVersionSet = new Set(existingVersions.map(v => v.version));

      // Get the version parts
      const versionParts = validatedData.version.split('.');
      if (versionParts.length > 0) {
        // Start with the current version and increment until we find a non-existent version
        let lastPart = parseInt(versionParts[versionParts.length - 1], 10);
        if (!isNaN(lastPart)) {
          do {
            lastPart++;
            versionParts[versionParts.length - 1] = String(lastPart);
            newVersion = versionParts.join('.');
          } while (existingVersionSet.has(newVersion));
        }
      }

      // Create workflow definition with new version
      const workflowDefinition = {
        metadata: {
          name: validatedData.name,
          description: validatedData.description || '',
          version: newVersion,
          author: `${user.first_name} ${user.last_name}`.trim(),
          tags: validatedData.tags,
        },
        executeFn: validatedData.code,
      };

      // Update workflow registration with new version
      await trx('workflow_registrations')
        .where({
          registration_id: id,
          tenant: tenant,
        })
        .update({
          name: validatedData.name,
          description: validatedData.description || '',
          tags: validatedData.tags,
          version: newVersion, // Update with incremented version
          status: validatedData.isActive ? 'active' : 'inactive',
          updated_at: new Date().toISOString(),
        });

      // Set all existing versions to not current
      await trx('workflow_registration_versions')
        .where({
          registration_id: id,
          tenant: tenant,
        })
        .update({
          is_current: false,
        });

      // Create new workflow version with incremented version number
      await trx('workflow_registration_versions')
        .insert({
          registration_id: id,
          tenant: tenant,
          version: newVersion, // Use the new version
          is_current: true,
          code: validatedData.code, // Use the new code field
          created_by: user.user_id,
          created_at: new Date().toISOString(),
        });

      return id;
    });
  } catch (error) {
    logger.error(`Error updating workflow ${id}:`, error);
    throw error;
  } finally {
    // Connection will be released automatically
  }
});

/**
 * Get all versions of a workflow
 *
 * @param id Workflow ID
 * @returns Array of workflow versions
 */
export const getWorkflowVersions = withAuth(async (_user, { tenant }, id: string): Promise<WorkflowVersionData[]> => {
  const { knex } = await createTenantKnex();

  try {
    return await withTransaction(knex, async (trx) => {
      // Get workflow registration to verify it exists
      const registration = await trx('workflow_registrations')
        .where({
          registration_id: id,
          tenant: tenant
        })
        .first();

      if (!registration) {
        throw new Error(`Workflow with ID ${id} not found`);
      }

      // Get all versions for the workflow
      const versions = await trx('workflow_registration_versions')
        .where({
          registration_id: id,
          tenant: tenant
        })
        .select(
          'version_id',
          'version',
          'is_current',
          'created_at',
          'created_by'
        )
        .orderBy('created_at', 'desc');

      // Map to version data
      return versions.map(version => ({
        versionId: version.version_id,
        version: version.version,
        isCurrent: version.is_current,
        createdAt: version.created_at,
        createdBy: version.created_by
      }));
    });
  } catch (error) {
    logger.error(`Error getting workflow versions for ${id}:`, error);
    throw error;
  }
});

/**
 * Set a specific version as the active version
 *
 * @param workflowId Workflow ID
 * @param versionId Version ID to set as active
 * @returns Success status
 */
export const setActiveWorkflowVersion = withAuth(async (_user, { tenant }, workflowId: string, versionId: string): Promise<{ success: boolean }> => {
  const { knex } = await createTenantKnex();

  try {
    return await knex.transaction(async (trx) => {
      // Get workflow registration to verify it exists
      const registration = await trx('workflow_registrations')
        .where({
          registration_id: workflowId,
          tenant: tenant
        })
        .first();

      if (!registration) {
        throw new Error(`Workflow with ID ${workflowId} not found`);
      }

      // Get the version to verify it exists
      const version = await trx('workflow_registration_versions')
        .where({
          version_id: versionId,
          registration_id: workflowId,
          tenant: tenant
        })
        .first();

      if (!version) {
        throw new Error(`Version with ID ${versionId} not found for workflow ${workflowId}`);
      }

      // Set all versions to not current
      await trx('workflow_registration_versions')
        .where({
          registration_id: workflowId,
          tenant: tenant
        })
        .update({
          is_current: false
        });

      // Set the specified version as current
      await trx('workflow_registration_versions')
        .where({
          version_id: versionId,
          registration_id: workflowId,
          tenant: tenant
        })
        .update({
          is_current: true
        });

      // Update the workflow registration with the version number
      await trx('workflow_registrations')
        .where({
          registration_id: workflowId,
          tenant: tenant
        })
        .update({
          version: version.version,
          updated_at: new Date().toISOString()
        });

      return { success: true };
    });
  } catch (error) {
    logger.error(`Error setting active workflow version for ${workflowId}:`, error);
    throw error;
  } finally {
    // Connection will be released automatically
  }
});

/**
 * Get a workflow by ID
 *
 * @param id Workflow ID
 * @returns Workflow data
 */
export const getWorkflow = withAuth(async (_user, { tenant }, id: string): Promise<WorkflowDataWithSystemFlag> => {
  try {
    // Create Knex instance
    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx) => {
      // Use the model to get the workflow, which handles system/tenant logic
      const result = await WorkflowRegistrationModel.getById(trx, tenant, id);

      if (!result) {
        throw new Error(`Workflow with ID ${id} not found`);
      }

      // Fetch the current version's code separately
      const currentVersion = await trx('workflow_registration_versions')
        .where({
          registration_id: id,
          tenant: tenant,
          is_current: true,
        })
        .select('code')
        .first();

      if (!currentVersion && !result.isSystemManaged) { // System workflows might not have a version initially? Or handle differently?
        // If it's not a system workflow and has no current version, something is wrong
        logger.warn(`Workflow ${id} has no current version, but registration exists.`);
        // Depending on requirements, you might throw an error or return default code
      }

      const workflowCode = currentVersion?.code || ''; // Use empty string if no code found

      // Return workflow data
      return {
        id: result.registration_id,
        name: result.name,
        description: result.description,
        version: result.version,
        tags: Array.isArray(result.tags) // Check if it's already an array
          ? result.tags
          : typeof result.tags === 'string' // Check if it's a string
              ? ((result.tags as string).startsWith('[') // Check if it's a JSON array string
                  ? JSON.parse(result.tags)
                  : (result.tags as string).split(',').map((tag: string) => tag.trim()).filter(Boolean)) // Otherwise, assume comma-separated
              : [], // Default to empty array if null or other type
        isActive: result.status === 'active',
        code: workflowCode, // Use code from the version table
        isSystemManaged: result.isSystemManaged, // Add the flag
      };
    });
  } catch (error) {
    logger.error(`Error getting workflow ${id}:`, error);
    throw error;
  }
});

/**
 * Get all workflows
 * 
 * @returns Array of workflow data
 */
/**
 * Get all workflows, optionally including inactive ones
 *
 * @param includeInactive Whether to include inactive workflows (default: false)
 * @returns Array of workflow data
 */
export const getAllWorkflows = withAuth(async (_user, { tenant }, includeInactive: boolean = false): Promise<WorkflowDataWithSystemFlag[]> => {
  try {
    console.log(`getAllWorkflows called with includeInactive=${includeInactive}`);

    // Create Knex instance
    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx) => {
      // Fetch tenant workflows
      let tenantWorkflowsQuery = trx('workflow_registrations as wr')
        .join('workflow_registration_versions as wrv', function() {
          this.on('wrv.registration_id', '=', 'wr.registration_id')
              .andOn('wrv.tenant', '=', 'wr.tenant')
              .andOn('wrv.is_current', '=', trx.raw('true'));
        })
        .where('wr.tenant', tenant)
        .select(
          'wr.registration_id',
          'wr.name',
          'wr.description',
          'wr.category',
          'wr.tags',
          'wr.status',
          'wr.source_template_id',
          'wr.created_by',
          'wr.created_at',
          'wr.updated_at',
          'wrv.version',
          'wrv.code',
          trx.raw('false as "isSystemManaged"') // Explicitly mark as not system managed
        );

      if (!includeInactive) {
        console.log('Filtering tenant workflows to show only active');
        tenantWorkflowsQuery = tenantWorkflowsQuery.andWhere('wr.status', 'active');
      }

      const tenantWorkflows = await tenantWorkflowsQuery;

      // Fetch system workflows
      let systemWorkflowsQuery = trx('system_workflow_registrations as swr')
        .join('system_workflow_registration_versions as swrv', function() {
          this.on('swrv.registration_id', '=', 'swr.registration_id')
              .andOn('swrv.is_current', '=', trx.raw('true'));
        })
        .select(
          'swr.registration_id',
          'swr.name',
          'swr.description',
          'swr.category',
          'swr.tags',
          'swr.status',
          'swr.source_template_id',
          'swr.created_by',
          'swr.created_at',
          'swr.updated_at',
          'swrv.version',
          'swrv.code',
          trx.raw('true as "isSystemManaged"') // Explicitly mark as system managed
        );

      if (!includeInactive) {
        console.log('Filtering system workflows to show only active');
        systemWorkflowsQuery = systemWorkflowsQuery.andWhere('swr.status', 'active');
      }

      const systemWorkflows = await systemWorkflowsQuery;

      // Combine and process the results
      const allWorkflowsData = [...tenantWorkflows, ...systemWorkflows];

      console.log(`Fetched ${tenantWorkflows.length} tenant and ${systemWorkflows.length} system workflows. Total: ${allWorkflowsData.length}`);

      // Map to the desired output format
      const workflows: WorkflowDataWithSystemFlag[] = allWorkflowsData.map(data => {
        // Safely parse tags
        let parsedTags: string[] = [];
        if (Array.isArray(data.tags)) {
          parsedTags = data.tags;
        } else if (typeof data.tags === 'string') {
          const tagsString = data.tags as string; // Explicit cast
          if (tagsString.startsWith('[')) {
            try { parsedTags = JSON.parse(tagsString); } catch (e) { /* ignore parse error */ }
          } else {
            parsedTags = tagsString.split(',').map((tag: string) => tag.trim()).filter(Boolean);
          }
        }

        return {
          registration_id: data.registration_id,
          id: data.registration_id,
          name: data.name,
          description: data.description,
          version: data.version,
          tags: parsedTags,
          isActive: data.status === 'active',
          code: data.code,
          category: data.category,
          status: data.status,
          source_template_id: data.source_template_id,
          created_by: data.created_by,
          created_at: data.created_at,
          updated_at: data.updated_at,
          isSystemManaged: data.isSystemManaged,
        };
      });

      console.log(`Returning ${workflows.length} workflows`);
      return workflows;
    });
  } catch (error) {
    logger.error("Error getting all workflows:", error);
    throw error;
  }
});

/**
 * Delete a workflow
 *
 * @param id Workflow ID
 * @returns Success status
 */
export const deleteWorkflow = withAuth(async (_user, { tenant }, id: string): Promise<boolean> => {
  let knexInstance;
  try {
    // Create Knex instance
    const { knex } = await createTenantKnex();
    knexInstance = knex;

    // Use a transaction to ensure both operations succeed or fail together
    return await knex.transaction(async (trx) => {
      // Delete workflow versions
      await trx('workflow_registration_versions')
        .where({
          registration_id: id,
          tenant: tenant,
        })
        .delete();

      // Delete workflow registration
      const deleted = await trx('workflow_registrations')
        .where({
          registration_id: id,
          tenant: tenant,
        })
        .delete();

      return deleted > 0;
    });
  } catch (error) {
    logger.error(`Error deleting workflow ${id}:`, error);
    throw error;
  } finally {
    // Connection will be released automatically
  }
});

/**
 * Update workflow status (activate/deactivate)
 *
 * @param id Workflow ID
 * @param isActive New active status
 * @returns Success status
 */
export const updateWorkflowStatus = withAuth(async (_user, { tenant }, id: string, isActive: boolean): Promise<boolean> => {
  try {
    console.log(`updateWorkflowStatus called with id=${id}, isActive=${isActive}`);

    // Create Knex instance
    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx) => {
      // Get current status for logging
      const currentWorkflow = await trx('workflow_registrations')
        .where({
          registration_id: id,
          tenant: tenant,
        })
        .first();

      console.log(`Current workflow status: ${currentWorkflow?.status}`);

      // Update workflow status
      const newStatus = isActive ? 'active' : 'inactive';
      console.log(`Setting workflow status to: ${newStatus}`);

      const updated = await trx('workflow_registrations')
        .where({
          registration_id: id,
          tenant: tenant,
        })
        .update({
          status: newStatus,
          updated_at: new Date().toISOString(),
        });

      console.log(`Updated ${updated} workflow(s)`);
      return updated > 0;
    });
  } catch (error) {
    logger.error(`Error updating workflow status for ${id}:`, error);
    throw error;
  }
});

/**
 * Test a workflow
 *
 * @param code Workflow code
 * @returns Test result
 */
export const testWorkflow = withAuth(async (_user, _ctx, code: string): Promise<{ success: boolean; output: string; warnings?: string[] }> => {
  try {
    // Validate workflow code
    const validation = validateWorkflowCode('async function execute(context) {\n' + code + '\n}');

    // Check for security issues
    const securityWarnings = checkWorkflowSecurity(code);

    // Combine all warnings
    const allWarnings = [...validation.warnings, ...securityWarnings];

    if (!validation.valid) {
      return {
        success: false,
        output: `Workflow validation failed: ${validation.errors.join(", ")}`,
        warnings: allWarnings.length > 0 ? allWarnings : undefined
      };
    }

    // We no longer need to extract metadata from the code
    // Just return success since the validation passed
    return {
      success: true,
      output: "Workflow code validated successfully. The workflow appears to be correctly structured.",
      warnings: allWarnings.length > 0 ? allWarnings : undefined
    };
  } catch (error) {
    logger.error("Error testing workflow:", error);
    throw error;
  }
});

// Helper function to safely convert string to EventType
const getEventType = (name: string): EventType => {
  // Try to parse the event name as a valid EventType
  const result = EventTypeEnum.safeParse(name);
  if (result.success) {
    return result.data;
  }
  // If not a standard event type, use a custom event approach
  // This is acceptable for testing purposes
  return 'UNKNOWN' as EventType;
};

/**
 * Execute a workflow test with the provided event data
 * This function uses version_id in the event payload to directly trigger
 * the specific workflow version without using temporary event attachments
 *
 * @param code Workflow code
 * @param eventName Event name
 * @param eventPayload Event payload
 * @param workflowId Workflow ID to use for testing
 * @returns Test execution result
 */
export const executeWorkflowTest = withAuth(async (
  user,
  { tenant },
  code: string,
  eventName: string,
  eventPayload: any,
  workflowId: string
): Promise<WorkflowTestResult> => {
  try {
    // Create Knex instance
    const { knex } = await createTenantKnex();

    // First validate the workflow code
    const testResult = await testWorkflow(code);

    if (!testResult.success) {
      return {
        success: false,
        message: `Workflow validation failed: ${testResult.output}`,
        warnings: testResult.warnings
      };
    }

    return await withTransaction(knex, async (trx) => {
      // Get the existing workflow registration and its current version
      const workflowRegistration = await trx('workflow_registrations as wr')
        .join('workflow_registration_versions as wrv', function() {
          this.on('wrv.registration_id', '=', 'wr.registration_id')
              .andOn('wrv.is_current', '=', trx.raw('true'));
        })
        .where({
          'wr.registration_id': workflowId,
          'wr.tenant': tenant
        })
        .select('wr.*', 'wrv.version_id')
        .first();

      if (!workflowRegistration) {
        return {
          success: false,
          message: "Could not find the workflow registration",
          warnings: testResult.warnings
        };
      }

      // Find or create an event catalog entry for this event type
      try {
        // First check if the event exists using the exact event name as the event_type
        let eventCatalogEntry = await EventCatalogModel.getByEventType(trx, eventName, tenant || '');

        if (!eventCatalogEntry) {
          // Also check if there's an existing CUSTOM_EVENT entry with this name
          const existingCustomEvent = await trx('event_catalog')
            .where({
              name: eventName,
              tenant: tenant || ''
            })
            .first();

          if (existingCustomEvent) {
            eventCatalogEntry = existingCustomEvent;
          } else {
            // Create a new event catalog entry
            eventCatalogEntry = await EventCatalogModel.create(trx, {
              event_type: getEventType(eventName), // Use the helper function
              name: eventName,
              description: `Test event for workflow test`,
              category: 'test',
              payload_schema: {
                type: 'object',
                properties: {
                  tenantId: { type: 'string' }
                },
                required: ['tenantId']
              },
              tenant: tenant || ''
            });
          }
        }
      } catch (error) {
        // If there's an error like a unique constraint violation, we can continue
        // since we just need a valid event type to exist, not necessarily create a new one
        logger.warn("Error handling event catalog entry, continuing with workflow test:", error);
      }

      // Submit the event to trigger the workflow
      const eventResult = await submitWorkflowEventAction({
        event_name: eventName,
        event_type: getEventType(eventName),
        tenant: tenant || '',
        payload: {
          ...eventPayload,
          tenantId: tenant,
          userId: user.user_id,
          workflowId: workflowId,
          versionId: workflowRegistration.version_id,
          isTestEvent: true // Add flag to indicate this is a test event
        }
      });

      if (eventResult.status === 'error') {
        return {
          success: false,
          message: `Error submitting event: ${eventResult.message}`,
          warnings: testResult.warnings
        };
      }

      // Query for the workflow execution using the version_id
      // This should work now that we have the version_id column
      const executions = await trx('workflow_executions')
        .where({
          'tenant': tenant,
          'version_id': workflowRegistration.version_id,
          'workflow_type': 'tenant'
        })
        .orderBy('created_at', 'desc')
        .limit(1);

      const executionId = executions.length > 0 ? executions[0].execution_id : undefined;

      return {
        success: true,
        executionId,
        message: `Workflow test started successfully. The event has been published to trigger the workflow.`,
        warnings: testResult.warnings
      };
    });
  } catch (error) {
    logger.error("Error executing workflow test:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
});
