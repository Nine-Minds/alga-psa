'use server';

import fs from 'fs/promises';
import path from 'path';
import * as ts from 'typescript';
import {
  getWorkflowRuntime,
  getActionRegistry,
  type WorkflowDefinition
} from '@alga-psa/shared/workflow/core';

import {
  type IWorkflowExecution,
  type IWorkflowEvent,
  type IWorkflowActionResult,
  WorkflowExecutionModel,
  WorkflowEventModel,
  WorkflowActionResultModel
} from '@alga-psa/shared/workflow/persistence';
import { initializeServerWorkflows } from '@alga-psa/shared/workflow/init/serverInit';
import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';

/**
 * Get workflow definition by ID
 * This function retrieves a workflow definition from the runtime registry
 */
export const getWorkflowDefinition = withAuth(async (
  _user,
  { tenant },
  definitionId: string
): Promise<any> => {
  try {
    // Initialize the workflow system on the server side
    await initializeServerWorkflows();

    // Get the action registry
    const actionRegistry = getActionRegistry();

    // Get the workflow runtime
    const runtime = getWorkflowRuntime(actionRegistry);

    // Get all registered workflows
    const workflowDefinitions = runtime.getRegisteredWorkflows();

    // Find the requested workflow in registered workflows
    let workflowDefinition = workflowDefinitions.get(definitionId);

    // If not found in registered workflows, try to load it from the database
    if (!workflowDefinition) {
      console.log(`Workflow definition "${definitionId}" not found in registered workflows, trying to load from database...`);

      // Create a tenant knex instance
      const { knex } = await createTenantKnex();

      if (!tenant) {
        throw new Error('Tenant not found');
      }

      // Import WorkflowRegistrationModel
      const WorkflowRegistrationModel = (await import('@alga-psa/shared/workflow/persistence/workflowRegistrationModel')).default;

      // Try to get the workflow registration and its current version's code
      const registrationWithVersion = await knex('workflow_registrations as reg')
        .join('workflow_registration_versions as ver', function() {
          this.on('reg.registration_id', '=', 'ver.registration_id')
              .andOn('ver.is_current', '=', knex.raw('true'));
        })
        .where({
          'reg.tenant': tenant,
          'reg.name': definitionId // Assuming definitionId is the workflow name
        })
        .select(
          'reg.name',
          'reg.description', // Get description from registration
          'reg.tags', // Get tags from registration
          'ver.version',
          'ver.code' // Get code from the current version
        )
        .first();

      if (registrationWithVersion) {
        console.log(`Found workflow registration and current version for "${definitionId}" in tenant database`);

        // Convert the stored definition to a WorkflowDefinition
        const { deserializeWorkflowDefinition } = await import('@alga-psa/shared/workflow/core/workflowDefinition');

        try {
          // Create a serialized definition from the database record
          const serializedDefinition = {
            metadata: {
              name: registrationWithVersion.name,
              description: registrationWithVersion.description || '', // Use registration description
              version: registrationWithVersion.version,
              tags: registrationWithVersion.tags || [] // Use registration tags
            },
            executeFn: registrationWithVersion.code // Use code from the version table
          };

          if (!serializedDefinition.executeFn) {
             console.error(`Workflow code not found in current version for "${definitionId}" in tenant database`);
             throw new Error(`Workflow code not found for ${definitionId}`);
          }

          // Deserialize the workflow definition
          workflowDefinition = deserializeWorkflowDefinition(serializedDefinition);
          console.log(`Successfully deserialized workflow definition for "${definitionId}" from tenant database`);
        }
        catch (error) {
          console.error(`Error deserializing workflow definition for "${definitionId}" from tenant database:`, error);
        }
      } else {
        console.log(`No workflow registration found for "${definitionId}" in tenant database, trying system database...`);

        // Try to get the workflow registration and its current version's code from system tables
        const systemRegistrationWithVersion = await knex('system_workflow_registrations as reg')
          .join('system_workflow_registration_versions as ver', function() {
            this.on('reg.registration_id', '=', 'ver.registration_id')
                .andOn('ver.is_current', '=', knex.raw('true'));
          })
          .where({
            'reg.name': definitionId // Assuming definitionId is the workflow name
          })
          .select(
            'reg.name',
            'reg.description', // Get description from registration
            'reg.tags', // Get tags from registration
            'ver.version',
            'ver.code' // Get code from the current version
          )
          .first();

        if (systemRegistrationWithVersion) {
          console.log(`Found workflow registration and current version for "${definitionId}" in system database`);

          // Convert the stored definition to a WorkflowDefinition
          const { deserializeWorkflowDefinition } = await import('@alga-psa/shared/workflow/core/workflowDefinition');

          try {
            // Create a serialized definition from the database record
            const serializedDefinition = {
              metadata: {
                name: systemRegistrationWithVersion.name,
                description: systemRegistrationWithVersion.description || '', // Use registration description
                version: systemRegistrationWithVersion.version,
                tags: systemRegistrationWithVersion.tags || [] // Use registration tags
              },
              executeFn: systemRegistrationWithVersion.code // Use code from the version table
            };

            if (!serializedDefinition.executeFn) {
               console.error(`Workflow code not found in current version for "${definitionId}" in system database`);
               throw new Error(`Workflow code not found for ${definitionId}`);
            }

            // Deserialize the workflow definition
            workflowDefinition = deserializeWorkflowDefinition(serializedDefinition);
            console.log(`Successfully deserialized workflow definition for "${definitionId}" from system database`);
          }
          catch (error) {
            console.error(`Error deserializing workflow definition for "${definitionId}" from system database:`, error);
          }
        } else {
          console.log(`No workflow registration found for "${definitionId}" in system database`);
        }
      }
    }

    if (!workflowDefinition) {
      throw new Error(`Workflow definition not found: ${definitionId}`);
    }

    // Convert the workflow definition to a format suitable for visualization
    return {
      name: workflowDefinition.metadata.name,
      description: workflowDefinition.metadata.description || '',
      version: workflowDefinition.metadata.version || '1.0.0',
      states: extractStatesFromWorkflow(workflowDefinition),
      events: [],
      actions: [],
      transitions: extractTransitionsFromWorkflow(workflowDefinition)
    };
  } catch (error) {
    console.error(`Error loading workflow definition ${definitionId}:`, error);
    throw error instanceof Error
      ? error
      : new Error(`Unknown error loading workflow definition: ${String(error)}`);
  }
});

/**
 * Extract states from a TypeScript workflow definition
 * Analyzes the workflow definition to find all possible states
 *
 * @param workflowDefinition The workflow definition to analyze
 * @returns Array of state objects with name and description
 */
function extractStatesFromWorkflow(workflowDefinition: WorkflowDefinition): any[] {
  // Get the execute function source code
  let executeFnSource = '';

  // Check if we have a serialized function string directly
  if ('executeFn' in workflowDefinition && typeof (workflowDefinition as any).executeFn === 'string') {
    executeFnSource = (workflowDefinition as any).executeFn;
  }
  // Otherwise, serialize the execute function to get its source
  else if (workflowDefinition.execute) {
    executeFnSource = workflowDefinition.execute.toString();
  }

  if (!executeFnSource) {
    console.warn('No execute function source found in workflow definition');
    return [];
  }

  try {
    // Parse the execute function source code
    const sourceFile = ts.createSourceFile(
      'workflow.ts',
      executeFnSource,
      ts.ScriptTarget.Latest,
      true
    );

    // Find all state transitions (context.setState calls)
    const states = new Map<string, { name: string; description: string }>();

    // Visitor function to find all setState calls
    function visit(node: ts.Node) {
      // Check if this is a setState call
      if (ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isPropertyAccessExpression(node.expression.expression) &&
          node.expression.expression.name.text === 'context' &&
          node.expression.name.text === 'setState') {

        // Get the state argument
        const stateArg = node.arguments[0];
        let stateName = 'unknown';

        if (ts.isStringLiteral(stateArg)) {
          stateName = stateArg.text;
        } else if (ts.isIdentifier(stateArg)) {
          stateName = `[${stateArg.text}]`; // Variable reference
        } else if (ts.isPropertyAccessExpression(stateArg)) {
          // Handle object property access like someObject.someProperty
          stateName = `[${stateArg.getText()}]`;
        } else if (stateArg) {
          // For other expressions, use the text representation
          stateName = `[${stateArg.getText()}]`;
        }

        // Add the state to our map if it's not already there
        if (!states.has(stateName)) {
          states.set(stateName, {
            name: stateName,
            description: `State: ${stateName}`
          });
        }
      }

      // Visit all children
      ts.forEachChild(node, visit);
    }

    // Start the visitor at the source file level
    visit(sourceFile);

    // If we didn't find any states, look for state constants
    if (states.size === 0) {
      // Look for state constants (e.g., const DRAFT = 'draft')
      function findStateConstants(node: ts.Node) {
        if (ts.isVariableStatement(node)) {
          for (const declaration of node.declarationList.declarations) {
            if (ts.isIdentifier(declaration.name) &&
                declaration.initializer &&
                ts.isStringLiteral(declaration.initializer)) {
              const name = declaration.initializer.text;
              states.set(name, {
                name,
                description: `State: ${name}`
              });
            }
          }
        }

        ts.forEachChild(node, findStateConstants);
      }

      findStateConstants(sourceFile);
    }

    // Convert the map to an array
    return Array.from(states.values());
  } catch (error) {
    console.error('Error extracting states from workflow definition:', error);
    return [];
  }
}

/**
 * Extract transitions from a TypeScript workflow definition
 * This is a placeholder implementation that would need to be expanded
 * based on how transitions are defined in your TypeScript workflows
 */
function extractTransitionsFromWorkflow(workflowDefinition: WorkflowDefinition): any[] {
  // Get the execute function source code
  let executeFnSource = '';

  // Check if we have a serialized function string directly
  if ('executeFn' in workflowDefinition && typeof (workflowDefinition as any).executeFn === 'string') {
    executeFnSource = (workflowDefinition as any).executeFn;
  }
  // Otherwise, serialize the execute function to get its source
  else if (workflowDefinition.execute) {
    executeFnSource = workflowDefinition.execute.toString();
  }

  if (!executeFnSource) {
    console.warn('No execute function source found in workflow definition');
    return [];
  }

  try {
    // Parse the execute function source code
    const sourceFile = ts.createSourceFile(
      'workflow.ts',
      executeFnSource,
      ts.ScriptTarget.Latest,
      true
    );

    // Track the current state and transitions
    const transitions: { from: string; to: string; event: string }[] = [];
    let currentState: string | null = null;

    // Helper function to find the nearest enclosing if condition
    function findEnclosingCondition(node: ts.Node): string | null {
      let parent = node.parent;
      while (parent) {
        if (ts.isIfStatement(parent) && parent.expression) {
          // Check if the condition is a state check
          const condition = parent.expression.getText();

          // Look for patterns like context.state === 'someState'
          const stateCheckRegex = /context\.state\s*===?\s*['"]([^'"]+)['"]/;
          const match = condition.match(stateCheckRegex);
          if (match) {
            return match[1];
          }

          // Look for other state check patterns
          if (condition.includes('context.state')) {
            return '[conditional]';
          }
        }
        parent = parent.parent;
      }
      return null;
    }

    // Visitor function to find state transitions and build the transition graph
    function visit(node: ts.Node) {
      // Check if this is a setState call
      if (ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isPropertyAccessExpression(node.expression.expression) &&
          node.expression.expression.name.text === 'context' &&
          node.expression.name.text === 'setState') {

        // Get the state argument
        const stateArg = node.arguments[0];
        let toState = 'unknown';

        if (ts.isStringLiteral(stateArg)) {
          toState = stateArg.text;
        } else if (ts.isIdentifier(stateArg)) {
          toState = `[${stateArg.text}]`; // Variable reference
        } else if (ts.isPropertyAccessExpression(stateArg)) {
          toState = `[${stateArg.getText()}]`;
        } else if (stateArg) {
          toState = `[${stateArg.getText()}]`;
        }

        // Find the enclosing condition to determine the from state
        const fromState = findEnclosingCondition(node) || currentState || 'initial';

        // Find the event that triggered this transition
        let event = 'unknown';

        // Look for event handling patterns
        let parent = node.parent;
        while (parent) {
          // Check if we're in an event handler function
          if (ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isArrowFunction(parent)) {
            const functionText = parent.getText();

            // Look for patterns like handleEvent, onEvent, processEvent
            const eventHandlerRegex = /handle([A-Z]\w+)|on([A-Z]\w+)|process([A-Z]\w+)/;
            const match = functionText.match(eventHandlerRegex);
            if (match) {
              event = match[1] || match[2] || match[3] || 'unknown';
              break;
            }
          }

          // Check if we're in a waitForEvent call
          if (ts.isCallExpression(parent) &&
              ts.isPropertyAccessExpression(parent.expression) &&
              ts.isPropertyAccessExpression(parent.expression.expression) &&
              parent.expression.expression.name.text === 'context' &&
              parent.expression.name.text === 'waitForEvent') {

            const eventArg = parent.arguments[0];
            if (ts.isStringLiteral(eventArg)) {
              event = eventArg.text;
              break;
            }
          }

          parent = parent.parent;
        }

        // Add the transition
        transitions.push({
          from: fromState,
          to: toState,
          event: event
        });

        // Update the current state
        currentState = toState;
      }

      // Visit all children
      ts.forEachChild(node, visit);
    }

    // Start the visitor at the source file level
    visit(sourceFile);

    // If we didn't find any transitions, create some default ones based on the states
    if (transitions.length === 0) {
      const states = extractStatesFromWorkflow(workflowDefinition);

      // Create transitions between consecutive states
      for (let i = 0; i < states.length - 1; i++) {
        transitions.push({
          from: states[i].name,
          to: states[i + 1].name,
          event: `Transition_${i}`
        });
      }
    }

    return transitions;
  } catch (error) {
    console.error('Error extracting transitions from workflow definition:', error);
    return [];
  }
}

/**
 * Get raw TypeScript content for a workflow definition
 */
export const getWorkflowDSLContent = withAuth(async (
  _user,
  { tenant },
  definitionId: string
): Promise<string> => {
  try {
    // First, try to find the workflow in the examples directory
    const examplesDir = path.join(process.cwd(), 'src', 'lib', 'workflow', 'examples');
    const tsFilePath = path.join(examplesDir, `${definitionId}Workflow.ts`);

    try {
      // Try to read the TypeScript file from the examples directory
      const tsContent = await fs.readFile(tsFilePath, 'utf-8');
      console.log(`Read workflow TypeScript file from examples: ${definitionId}, size: ${tsContent.length} bytes`);
      return tsContent;
    } catch (fileError) {
      if ((fileError as NodeJS.ErrnoException).code === 'ENOENT') {
        // File not found in examples directory, try to load from database
        console.log(`Workflow TypeScript file not found in examples directory, trying to load from database: ${definitionId}`);

        // Create a tenant knex instance
        const { knex } = await createTenantKnex();

        if (!tenant) {
          throw new Error('Tenant not found');
        }

        // Import WorkflowRegistrationModel
        const WorkflowRegistrationModel = (await import('@alga-psa/shared/workflow/persistence/workflowRegistrationModel')).default;

        // Try to get the workflow registration and its current version's code
        const registrationWithVersion = await knex('workflow_registrations as reg')
          .join('workflow_registration_versions as ver', function() {
            this.on('reg.registration_id', '=', 'ver.registration_id')
                .andOn('ver.is_current', '=', knex.raw('true'));
          })
          .where({
            'reg.tenant': tenant,
            'reg.name': definitionId // Assuming definitionId is the workflow name
          })
          .select('ver.code') // Select only the code from the current version
          .first();

        if (registrationWithVersion && registrationWithVersion.code) {
          console.log(`Found workflow registration for "${definitionId}" in tenant database, returning code from current version`);
          return registrationWithVersion.code;
        } else {
          console.log(`No workflow registration found for "${definitionId}" in tenant database, trying system database...`);

          // Try to get the workflow registration and its current version's code from system tables
          const systemRegistrationWithVersion = await knex('system_workflow_registrations as reg')
            .join('system_workflow_registration_versions as ver', function() {
              this.on('reg.registration_id', '=', 'ver.registration_id')
                  .andOn('ver.is_current', '=', knex.raw('true'));
            })
            .where({
              'reg.name': definitionId // Assuming definitionId is the workflow name
            })
            .select('ver.code') // Select only the code from the current version
            .first();

          if (systemRegistrationWithVersion && systemRegistrationWithVersion.code) {
            console.log(`Found workflow registration for "${definitionId}" in system database, returning code from current version`);
            return systemRegistrationWithVersion.code;
          }
        }

        // If we get here, the workflow was not found in either database
        throw new Error(`Workflow definition not found: ${definitionId}`);
      }
      // Rethrow other errors
      throw fileError;
    }
  } catch (error) {
    console.error(`Error loading workflow TypeScript content for ${definitionId}:`, error);
    throw error instanceof Error
      ? error
      : new Error(`Unknown error loading workflow TypeScript content: ${String(error)}`);
  }
});

/**
 * Get workflow execution by ID
 */
export const getWorkflowExecution = withAuth(async (
  _user,
  { tenant },
  executionId: string
): Promise<IWorkflowExecution | null> => {
  try {
    // For testing purposes, return mock data if executionId is 'mock'
    if (executionId === 'mock') {
      return {
        execution_id: 'mock-execution',
        workflow_name: 'InvoiceApproval',
        workflow_version: '1.0.0',
        current_state: 'draft',
        status: 'active',
        context_data: {
          id: 'mock-execution',
          data: {
            invoice: {
              id: 'INV-MOCK',
              amount: 1000,
              submitter: 'Alice',
              status: 'draft'
            }
          }
        },
        workflow_type: 'tenant',
        tenant: 'mock-tenant',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    }

    // Create a tenant knex instance
    const { knex } = await createTenantKnex();

    const execution = await WorkflowExecutionModel.getById(knex, tenant!, executionId);

    // If no execution found, return null
    if (!execution) {
      return null;
    }

    // Return a clean copy without any non-serializable data
    return {
      execution_id: execution.execution_id,
      workflow_name: execution.workflow_name,
      workflow_version: execution.workflow_version,
      current_state: execution.current_state,
      status: execution.status,
      context_data: execution.context_data,
      tenant: execution.tenant,
      created_at: execution.created_at,
      updated_at: execution.updated_at,
      workflow_type: 'tenant'
    };
  } catch (error) {
    console.error(`Error getting workflow execution ${executionId}:`, error);
    throw error;
  }
});

/**
 * Get workflow events by execution ID
 */
export const getWorkflowEvents = withAuth(async (
  _user,
  { tenant },
  executionId: string
): Promise<IWorkflowEvent[]> => {
  try {
    // For testing purposes, return mock data if executionId is 'mock'
    if (executionId === 'mock') {
      return [
        {
          event_id: 'mock-event-1',
          execution_id: 'mock-execution',
          event_name: 'workflow.started',
          event_type: 'system',
          from_state: 'none',
          to_state: 'draft',
          payload: {
            workflow_name: 'InvoiceApproval',
            initial_data: {
              invoice: {
                id: 'INV-MOCK',
                amount: 1000,
                submitter: 'Alice',
                status: 'draft'
              }
            }
          },
          tenant: 'mock-tenant',
          created_at: new Date().toISOString()
        }
      ];
    }

    // Create a tenant knex instance
    const { knex } = await createTenantKnex();

    const events = await WorkflowEventModel.getByExecutionId(knex, tenant!, executionId);

    // Return clean copies without any non-serializable data
    return events.map((event: IWorkflowEvent) => ({
      event_id: event.event_id,
      execution_id: event.execution_id,
      event_name: event.event_name,
      event_type: event.event_type,
      from_state: event.from_state,
      to_state: event.to_state,
      payload: event.payload,
      tenant: event.tenant,
      created_at: event.created_at
    }));
  } catch (error) {
    console.error(`Error getting workflow events for execution ${executionId}:`, error);
    throw error;
  }
});

/**
 * Get workflow action results by execution ID
 */
export const getWorkflowActionResults = withAuth(async (
  _user,
  { tenant },
  executionId: string
): Promise<IWorkflowActionResult[]> => {
  try {
    // For testing purposes, return mock data if executionId is 'mock'
    if (executionId === 'mock') {
      return [
        {
          result_id: 'mock-result-1',
          execution_id: 'mock-execution',
          event_id: 'mock-event-1',
          action_name: 'send_notification',
          success: true,
          result: { success: true, notificationId: 'notif-123' },
          error_message: '',
          idempotency_key: 'mock-execution:send_notification:123',
          ready_to_execute: false,
          tenant: 'mock-tenant',
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          created_at: new Date().toISOString()
        }
      ];
    }

    // Create a tenant knex instance
    const { knex } = await createTenantKnex();

    const results = await WorkflowActionResultModel.getByExecutionId(knex, tenant!, executionId);

    // Return clean copies without any non-serializable data
    return results.map((result: IWorkflowActionResult) => ({
      result_id: result.result_id,
      execution_id: result.execution_id,
      event_id: result.event_id,
      action_name: result.action_name,
      action_path: result.action_path,
      action_group: result.action_group,
      parameters: result.parameters,
      success: result.success,
      result: result.result,
      error_message: result.error_message || '',
      idempotency_key: result.idempotency_key,
      ready_to_execute: result.ready_to_execute,
      tenant: result.tenant,
      started_at: result.started_at,
      completed_at: result.completed_at,
      created_at: result.created_at
    }));
  } catch (error) {
    console.error(`Error getting workflow action results for execution ${executionId}:`, error);
    throw error;
  }
});

/**
 * Helper function to ensure an object is serializable
 * Removes any functions, circular references, etc.
 */
function makeSerializable(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle Date objects
  if (obj instanceof Date) {
    return obj.toISOString();
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => makeSerializable(item));
  }

  // Handle plain objects
  if (typeof obj === 'object') {
    const result: Record<string, any> = {};

    for (const key in obj) {
      // Skip functions and properties that start with underscore (often internal properties)
      if (typeof obj[key] !== 'function' && !key.startsWith('_')) {
        try {
          // Test if the value can be serialized
          JSON.stringify(obj[key]);
          result[key] = makeSerializable(obj[key]);
        } catch (e) {
          // If it can't be serialized, skip it
          console.warn(`Skipping non-serializable property: ${key}`);
        }
      }
    }

    return result;
  }

  // Return primitive values as is
  return obj;
}

/**
 * Get workflow execution status
 * This function returns a serializable version of the execution data
 */
export const getWorkflowExecutionStatus = withAuth(async (
  _user,
  { tenant },
  executionId: string
) => {
  try {
    // Mock data for testing
    if (executionId === 'mock') {
      return {
        execution: {
          execution_id: 'mock-execution',
          workflow_name: 'InvoiceApproval',
          workflow_version: '1.0.0',
          current_state: 'draft',
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        events: [
          {
            event_id: 'mock-event-1',
            execution_id: 'mock-execution',
            event_name: 'workflow.started',
            event_type: 'system',
            from_state: 'none',
            to_state: 'draft',
            created_at: new Date().toISOString()
          }
        ],
        actionResults: [
          {
            result_id: 'mock-result-1',
            execution_id: 'mock-execution',
            action_name: 'send_notification',
            success: true,
            result: { success: true, notificationId: 'notif-123' },
            error_message: '',
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            created_at: new Date().toISOString()
          }
        ]
      };
    }

    // Create a tenant knex instance - we'll use the same one for all queries
    const { knex } = await createTenantKnex();

    // Fetch execution, events, and action results
    const execution = await WorkflowExecutionModel.getById(knex, tenant!, executionId);
    const events = await WorkflowEventModel.getByExecutionId(knex, tenant!, executionId);
    const actionResults = await WorkflowActionResultModel.getByExecutionId(knex, tenant!, executionId);

    if (!execution) {
      return null;
    }

    // Create a serializable version of the data
    const serializedData = {
      execution: {
        execution_id: execution.execution_id,
        workflow_name: execution.workflow_name,
        workflow_version: execution.workflow_version,
        current_state: execution.current_state,
        status: execution.status,
        created_at: execution.created_at,
        updated_at: execution.updated_at
      },
      events: events.map((event: IWorkflowEvent) => ({
        event_id: event.event_id,
        execution_id: event.execution_id,
        event_name: event.event_name,
        event_type: event.event_type,
        from_state: event.from_state,
        to_state: event.to_state,
        created_at: event.created_at
      })),
      actionResults: actionResults.map((result: IWorkflowActionResult) => ({
        result_id: result.result_id,
        execution_id: result.execution_id,
        action_name: result.action_name,
        success: result.success,
        result: makeSerializable(result.result),
        error_message: result.error_message || '',
        started_at: result.started_at,
        completed_at: result.completed_at,
        created_at: result.created_at
      }))
    };

    // Ensure the data is fully serializable
    return makeSerializable(serializedData);
  } catch (error) {
    console.error(`Error getting workflow execution status for ${executionId}:`, error);
    throw error;
  }
});

/**
 * Get workflow visualization data
 * This combines definition, execution status, and TypeScript content
 */
export const getWorkflowVisualizationData = withAuth(async (
  _user,
  { tenant },
  definitionId: string,
  executionId?: string
) => {
  try {
    // Fetch definition and TypeScript content
    const definition = await getWorkflowDefinition(definitionId);
    const tsContent = await getWorkflowDSLContent(definitionId).catch(() => null);
    const executionStatus = executionId ? await getWorkflowExecutionStatus(executionId) : null;

    return {
      definition,
      tsContent,
      executionStatus
    };
  } catch (error) {
    console.error(`Error getting workflow visualization data:`, error);
    throw error;
  }
});
