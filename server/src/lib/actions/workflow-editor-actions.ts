'use server';
import { createTenantKnex } from "server/src/lib/db";
import { getCurrentUser } from "./user-actions/userActions";
import { z } from "zod";
import logger from "@shared/core/logger.js";
import { v4 as uuidv4 } from 'uuid';

import { serializeWorkflowDefinition, deserializeWorkflowDefinition } from "@shared/workflow/core/workflowDefinition";
import { getWorkflowRuntime } from "@shared/workflow/core/workflowRuntime";
import { submitWorkflowEventAction } from "./workflow-event-actions";
import { createWorkflowEventAttachment, deleteWorkflowEventAttachment } from "./workflow-event-attachment-actions";
import { EventCatalogModel } from "../../models/eventCatalog";
import {
  validateWorkflowCode,
  checkWorkflowSecurity,
  extractWorkflowMetadata,
  WorkflowMetadataSchema
} from "../utils/workflowValidation";

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
export type WorkflowData = z.infer<typeof WorkflowSchema>;

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
export async function createWorkflow(data: WorkflowData): Promise<string> {
  let knexInstance;
  try {
    // Get current user
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }
    
    // Validate input
    const validatedData = WorkflowSchema.parse(data);
    
    // Extract metadata from code
    const metadata = extractWorkflowMetadata(validatedData.code);
    if (!metadata) {
      throw new Error("Could not extract workflow metadata from code");
    }
    
    // Create Knex instance
    const { knex } = await createTenantKnex();
    knexInstance = knex;
    
    // Use a transaction to ensure both operations succeed or fail together
    return await knex.transaction(async (trx) => {
      // Create workflow registration
      const [registration] = await trx('workflow_registrations')
        .insert({
          tenant_id: user.tenant,
          name: validatedData.name,
          description: validatedData.description || '',
          category: 'custom',
          tags: JSON.stringify(validatedData.tags),
          status: validatedData.isActive ? 'active' : 'inactive',
          created_by: user.user_id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .returning('registration_id');
      
      // Create workflow definition
      const workflowDefinition = {
        metadata: {
          name: metadata.name,
          description: metadata.description || validatedData.description || '',
          version: metadata.version || validatedData.version,
          author: metadata.author || `${user.first_name} ${user.last_name}`.trim(),
          tags: metadata.tags || validatedData.tags,
        },
        executeFn: validatedData.code,
      };
      
      // Create workflow version
      await trx('workflow_registration_versions')
        .insert({
          registration_id: registration.registration_id,
          tenant_id: user.tenant,
          version: validatedData.version,
          is_current: true,
          definition: JSON.stringify(workflowDefinition),
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
}

/**
 * Update an existing workflow
 * 
 * @param id Workflow ID
 * @param data Workflow data
 * @returns Updated workflow ID
 */
export async function updateWorkflow(id: string, data: WorkflowData): Promise<string> {
  let knexInstance;
  try {
    // Get current user
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }
    
    // Validate input
    const validatedData = WorkflowSchema.parse(data);
    
    // Extract metadata from code
    const metadata = extractWorkflowMetadata(validatedData.code);
    if (!metadata) {
      throw new Error("Could not extract workflow metadata from code");
    }
    
    // Create Knex instance
    const { knex } = await createTenantKnex();
    knexInstance = knex;
    
    // Use a transaction to ensure all operations succeed or fail together
    return await knex.transaction(async (trx) => {
      // Update workflow registration
      await trx('workflow_registrations')
        .where({
          registration_id: id,
          tenant_id: user.tenant,
        })
        .update({
          name: validatedData.name,
          description: validatedData.description || '',
          tags: JSON.stringify(validatedData.tags),
          status: validatedData.isActive ? 'active' : 'inactive',
          updated_at: new Date().toISOString(),
        });
      
      // Create workflow definition
      const workflowDefinition = {
        metadata: {
          name: metadata.name,
          description: metadata.description || validatedData.description || '',
          version: metadata.version || validatedData.version,
          author: metadata.author || `${user.first_name} ${user.last_name}`.trim(),
          tags: metadata.tags || validatedData.tags,
        },
        executeFn: validatedData.code,
      };
      
      // Set all existing versions to not current
      await trx('workflow_registration_versions')
        .where({
          registration_id: id,
          tenant_id: user.tenant,
        })
        .update({
          is_current: false,
        });
      
      // Create new workflow version
      await trx('workflow_registration_versions')
        .insert({
          registration_id: id,
          tenant_id: user.tenant,
          version: validatedData.version,
          is_current: true,
          definition: JSON.stringify(workflowDefinition),
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
}

/**
 * Get all versions of a workflow
 *
 * @param id Workflow ID
 * @returns Array of workflow versions
 */
export async function getWorkflowVersions(id: string): Promise<WorkflowVersionData[]> {
  // Get current user
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("User not authenticated");
  }
  
  const { knex } = await createTenantKnex();
  
  try {
    // Get workflow registration to verify it exists
    const registration = await knex('workflow_registrations')
      .where({
        registration_id: id,
        tenant_id: user.tenant
      })
      .first();
    
    if (!registration) {
      throw new Error(`Workflow with ID ${id} not found`);
    }
    
    // Get all versions for the workflow
    const versions = await knex('workflow_registration_versions')
      .where({
        registration_id: id,
        tenant_id: user.tenant
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
  } catch (error) {
    logger.error(`Error getting workflow versions for ${id}:`, error);
    throw error;
  } finally {
    // Connection will be released automatically
  }
}

/**
 * Set a specific version as the active version
 *
 * @param workflowId Workflow ID
 * @param versionId Version ID to set as active
 * @returns Success status
 */
export async function setActiveWorkflowVersion(workflowId: string, versionId: string): Promise<{ success: boolean }> {
  // Get current user
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("User not authenticated");
  }
  
  const { knex } = await createTenantKnex();
  
  try {
    return await knex.transaction(async (trx) => {
      // Get workflow registration to verify it exists
      const registration = await trx('workflow_registrations')
        .where({
          registration_id: workflowId,
          tenant_id: user.tenant
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
          tenant_id: user.tenant
        })
        .first();
      
      if (!version) {
        throw new Error(`Version with ID ${versionId} not found for workflow ${workflowId}`);
      }
      
      // Set all versions to not current
      await trx('workflow_registration_versions')
        .where({
          registration_id: workflowId,
          tenant_id: user.tenant
        })
        .update({
          is_current: false
        });
      
      // Set the specified version as current
      await trx('workflow_registration_versions')
        .where({
          version_id: versionId,
          registration_id: workflowId,
          tenant_id: user.tenant
        })
        .update({
          is_current: true
        });
      
      // Update the workflow registration with the version number
      await trx('workflow_registrations')
        .where({
          registration_id: workflowId,
          tenant_id: user.tenant
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
}

/**
 * Get a workflow by ID
 * 
 * @param id Workflow ID
 * @returns Workflow data
 */
export async function getWorkflow(id: string): Promise<WorkflowData> {
  let knexInstance;
  try {
    // Get current user
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }
    
    // Create Knex instance
    const { knex } = await createTenantKnex();
    knexInstance = knex;
    
    // Get workflow registration and current version in a single query with JOIN
    const result = await knex('workflow_registrations as wr')
      .join(
        'workflow_registration_versions as wrv',
        function() {
          this.on('wrv.registration_id', '=', 'wr.registration_id')
              .andOn('wrv.tenant_id', '=', 'wr.tenant_id')
              .andOn('wrv.is_current', '=', knex.raw('true'));
        }
      )
      .where({
        'wr.registration_id': id,
        'wr.tenant_id': user.tenant,
      })
      .select(
        'wr.registration_id',
        'wr.name',
        'wr.description',
        'wr.tags',
        'wr.status',
        'wrv.version',
        'wrv.definition'
      )
      .first();
    
    if (!result) {
      throw new Error(`Workflow with ID ${id} not found or has no current version`);
    }
    
    // Parse definition
    const definition = result.definition;
    
    // Return workflow data
    return {
      id: result.registration_id,
      name: result.name,
      description: result.description,
      version: result.version,
      tags: Array.isArray(result.tags)
        ? result.tags
        : (typeof result.tags === 'string'
            ? (result.tags.startsWith('[')
                ? JSON.parse(result.tags)
                : result.tags.split(',').map((tag: string) => tag.trim()).filter(Boolean))
            : []),
      isActive: result.status === 'active',
      code: definition.executeFn,
    };
  } catch (error) {
    logger.error(`Error getting workflow ${id}:`, error);
    throw error;
  } finally {
    // Connection will be released automatically
  }
}

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
export async function getAllWorkflows(includeInactive: boolean = false): Promise<WorkflowData[]> {
  let knexInstance;
  try {
    console.log(`getAllWorkflows called with includeInactive=${includeInactive}`);

    // Create Knex instance
    const { knex, tenant } = await createTenantKnex();
    knexInstance = knex;
    
    // Single efficient query with JOIN to avoid N+1 problem
    const workflowsData = await knex('workflow_registrations as wr')
      .join(
        'workflow_registration_versions as wrv',
        function() {
          this.on('wrv.registration_id', '=', 'wr.registration_id')
              .andOn('wrv.tenant_id', '=', 'wr.tenant_id')
              .andOn('wrv.is_current', '=', knex.raw('true'));
        }
      )
      .where(function() {
        this.where('wr.tenant_id', tenant);
        
        // Only show active workflows unless includeInactive is true
        if (!includeInactive) {
          console.log('Filtering to show only active workflows');
          this.andWhere('wr.status', 'active');
        } else {
          console.log('Showing all workflows (active and inactive)');
        }
      })
      .select(
        'wr.registration_id',
        'wr.name',
        'wr.description',
        'wr.tags',
        'wr.status',
        'wrv.version',
        'wrv.definition'
      )
      .orderBy('wr.created_at', 'desc');
    
    // Process the results
    const workflows: WorkflowData[] = workflowsData.map(data => {
      const definition = data.definition;
      return {
        id: data.registration_id,
        name: data.name,
        description: data.description,
        version: data.version,
        tags: Array.isArray(data.tags)
          ? data.tags
          : (typeof data.tags === 'string'
              ? (data.tags.startsWith('[')
                  ? JSON.parse(data.tags)
                  : data.tags.split(',').map((tag: string) => tag.trim()).filter(Boolean))
              : []),
        isActive: data.status === 'active',
        code: definition.executeFn,
      };
    });
    
    console.log(`Returning ${workflows.length} workflows, with statuses: ${workflows.map(w => w.isActive ? 'active' : 'inactive').join(', ')}`);
    return workflows;
  } catch (error) {
    logger.error("Error getting all workflows:", error);
    throw error;
  } finally {
    // Connection will be released automatically
  }
}

/**
 * Delete a workflow
 * 
 * @param id Workflow ID
 * @returns Success status
 */
export async function deleteWorkflow(id: string): Promise<boolean> {
  let knexInstance;
  try {
    // Get current user
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }
    
    // Create Knex instance
    const { knex } = await createTenantKnex();
    knexInstance = knex;
    
    // Use a transaction to ensure both operations succeed or fail together
    return await knex.transaction(async (trx) => {
      // Delete workflow versions
      await trx('workflow_registration_versions')
        .where({
          registration_id: id,
          tenant_id: user.tenant,
        })
        .delete();
      
      // Delete workflow registration
      const deleted = await trx('workflow_registrations')
        .where({
          registration_id: id,
          tenant_id: user.tenant,
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
}

/**
 * Update workflow status (activate/deactivate)
 *
 * @param id Workflow ID
 * @param isActive New active status
 * @returns Success status
 */
export async function updateWorkflowStatus(id: string, isActive: boolean): Promise<boolean> {
  try {
    console.log(`updateWorkflowStatus called with id=${id}, isActive=${isActive}`);
    
    // Get current user
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }
    
    // Create Knex instance
    const { knex } = await createTenantKnex();
    
    // Get current status for logging
    const currentWorkflow = await knex('workflow_registrations')
      .where({
        registration_id: id,
        tenant_id: user.tenant,
      })
      .first();
    
    console.log(`Current workflow status: ${currentWorkflow?.status}`);
    
    // Update workflow status
    const newStatus = isActive ? 'active' : 'inactive';
    console.log(`Setting workflow status to: ${newStatus}`);
    
    const updated = await knex('workflow_registrations')
      .where({
        registration_id: id,
        tenant_id: user.tenant,
      })
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      });
    
    console.log(`Updated ${updated} workflow(s)`);
    return updated > 0;
  } catch (error) {
    logger.error(`Error updating workflow status for ${id}:`, error);
    throw error;
  }
}

/**
 * Test a workflow
 * 
 * @param code Workflow code
 * @returns Test result
 */
export async function testWorkflow(code: string): Promise<{ success: boolean; output: string; warnings?: string[] }> {
  let knexInstance;
  try {
    // Get current user
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }
    
    // Create Knex instance - we might need it for future operations
    const { knex } = await createTenantKnex();
    knexInstance = knex;
    
    // Validate workflow code
    const validation = validateWorkflowCode(code);
    
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
    
    // Create a temporary workflow definition for testing
    if (validation.metadata) {
      const workflowDefinition = {
        metadata: {
          name: validation.metadata.name,
          description: validation.metadata.description || '',
          version: validation.metadata.version || '1.0.0',
          author: validation.metadata.author || `${user.first_name} ${user.last_name}`.trim(),
          tags: validation.metadata.tags || [],
        },
        executeFn: code,
      };
      
      try {
        // This will throw if the code is invalid
        deserializeWorkflowDefinition(workflowDefinition);
        
        return {
          success: true,
          output: "Workflow code validated successfully. The workflow appears to be correctly structured.",
          warnings: allWarnings.length > 0 ? allWarnings : undefined
        };
      } catch (error) {
        return {
          success: false,
          output: `Workflow deserialization failed: ${error instanceof Error ? error.message : String(error)}`,
          warnings: allWarnings.length > 0 ? allWarnings : undefined
        };
      }
    }
    
    return {
      success: false,
      output: "Could not extract workflow metadata from code",
      warnings: allWarnings.length > 0 ? allWarnings : undefined
    };
  } catch (error) {
    logger.error("Error testing workflow:", error);
    throw error;
  } finally {
    // Release the knex connection to prevent connection pool exhaustion
    if (knexInstance) {
      await knexInstance.destroy();
    }
  }
}

/**
 * Execute a workflow test with the provided event data
 * This function creates a temporary workflow registration, attaches it to the event,
 * and then publishes the event to trigger the workflow
 * 
 * @param code Workflow code
 * @param eventName Event name
 * @param eventPayload Event payload
 * @returns Test execution result
 */
export async function executeWorkflowTest(
  code: string,
  eventName: string,
  eventPayload: any
): Promise<WorkflowTestResult> {
  let tempWorkflowId: string | undefined = undefined;
  let tempAttachmentId: string | undefined = undefined;
  
  try {
    // Get current user
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }
    
    // Create Knex instance
    const { knex, tenant } = await createTenantKnex();
    
    // First validate the workflow code
    const testResult = await testWorkflow(code);
    
    if (!testResult.success) {
      return {
        success: false,
        message: `Workflow validation failed: ${testResult.output}`,
        warnings: testResult.warnings
      };
    }
    
    // Extract metadata from code
    const metadata = extractWorkflowMetadata(code);
    if (!metadata) {
      return {
        success: false,
        message: "Could not extract workflow metadata from code",
        warnings: testResult.warnings
      };
    }
    
    // Create a temporary workflow registration for testing
    const tempWorkflowName = `Test_${metadata.name}_${Date.now()}`;
    const workflowDefinition = {
      metadata: {
        name: tempWorkflowName,
        description: metadata.description || 'Temporary test workflow',
        version: metadata.version || '1.0.0',
        author: metadata.author || `${user.first_name} ${user.last_name}`.trim(),
        tags: [...(metadata.tags || []), 'test', 'temporary'],
      },
      executeFn: code,
    };
    
    // Create the temporary workflow registration
    const [registration] = await knex('workflow_registrations')
      .insert({
        tenant_id: tenant || '',
        name: tempWorkflowName,
        description: metadata.description || 'Temporary test workflow',
        category: 'test',
        tags: JSON.stringify([...(metadata.tags || []), 'test', 'temporary']),
        status: 'active',
        created_by: user.user_id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .returning('registration_id');
    
    tempWorkflowId = registration.registration_id;
    
    // Create workflow version
    await knex('workflow_registration_versions')
      .insert({
        registration_id: tempWorkflowId,
        tenant_id: tenant || '',
        version: metadata.version || '1.0.0',
        is_current: true,
        definition: JSON.stringify(workflowDefinition),
        created_by: user.user_id,
        created_at: new Date().toISOString(),
      });
    
    // Find or create an event catalog entry for this event type
    let eventCatalogEntry = await EventCatalogModel.getByEventType(knex, eventName, tenant || '');
    
    if (!eventCatalogEntry) {
      // Create a new event catalog entry
      eventCatalogEntry = await EventCatalogModel.create(knex, {
        event_type: "CUSTOM_EVENT" as any, // Use a generic event type that's compatible with the system
        name: eventName,
        description: `Test event for ${tempWorkflowName}`,
        category: 'test',
        payload_schema: {
          type: 'object',
          properties: {
            tenantId: { type: 'string' }
          },
          required: ['tenantId']
        },
        is_system_event: false,
        tenant_id: tenant || ''
      });
    }
    
    if (!tempWorkflowId) {
      throw new Error("Failed to create temporary workflow registration");
    }
    
    // Create a temporary event attachment
    const attachment = await createWorkflowEventAttachment({
      workflow_id: tempWorkflowId,
      event_id: eventCatalogEntry.event_id,
      tenant_id: tenant || '',
      is_active: true
    });
    
    tempAttachmentId = attachment.attachment_id;
    
    // Submit the event to trigger the workflow
    // We use 'as any' to bypass the strict event type checking
    // This is acceptable for testing purposes
    const eventResult = await submitWorkflowEventAction({
      event_name: eventName,
      event_type: eventName as any,
      tenant: tenant || '',
      payload: {
        ...eventPayload,
        tenantId: tenant,
        userId: user.user_id
      }
    });
    
    if (eventResult.status === 'error') {
      return {
        success: false,
        message: `Error submitting event: ${eventResult.message}`,
        warnings: testResult.warnings
      };
    }
    
    // Get the execution ID from the event result
    // Note: In the current implementation, we don't have a direct way to get the execution ID
    // from the event result, so we'll need to query for it
    
    // Wait a moment for the workflow to start
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Query for the most recent workflow execution for this workflow
    const execution = await knex('workflow_executions')
      .where({
        tenant_id: tenant,
        workflow_name: tempWorkflowName
      })
      .orderBy('created_at', 'desc')
      .first();
    
    return {
      success: true,
      executionId: execution?.execution_id,
      message: `Workflow test started successfully. ${execution?.execution_id ? `Execution ID: ${execution.execution_id}` : ''}`,
      warnings: testResult.warnings
    };
  } catch (error) {
    logger.error("Error executing workflow test:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error)
    };
  } finally {
    // Clean up temporary resources
    try {
      if (tempAttachmentId && tempWorkflowId) {
        const { knex, tenant } = await createTenantKnex();
        
        // Delete the temporary attachment
        if (tempAttachmentId) {
          await deleteWorkflowEventAttachment({
            attachmentId: tempAttachmentId,
            tenant: tenant || ''
          });
        }
        
        // Delete the temporary workflow registration
        await knex('workflow_registration_versions')
          .where({
            registration_id: tempWorkflowId,
            tenant_id: tenant
          })
          .delete();
        
        await knex('workflow_registrations')
          .where({
            registration_id: tempWorkflowId,
            tenant_id: tenant
          })
          .delete();
      }
    } catch (cleanupError) {
      logger.error("Error cleaning up temporary resources:", cleanupError);
    }
  }
}
