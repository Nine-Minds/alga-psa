/**
 * Seed file for workflow data
 * This creates sample workflow executions, events, and action results
 * for demonstration and testing purposes with an Alice in Wonderland theme
 * Updated for the new TypeScript-based workflow system
 */

const { v4: uuidv4 } = require('uuid');

// Helper function to generate a random date within the last 30 days
function randomRecentDate() {
  const now = new Date();
  const daysAgo = Math.floor(Math.random() * 30);
  const result = new Date(now);
  result.setDate(result.getDate() - daysAgo);
  return result.toISOString();
}

// Helper function to generate a random date after a given date
function randomLaterDate(startDate, maxMinutesLater = 60) {
  const start = new Date(startDate);
  const minutesLater = Math.floor(Math.random() * maxMinutesLater) + 1;
  const result = new Date(start);
  result.setMinutes(result.getMinutes() + minutesLater);
  return result.toISOString();
}

// Helper function to create a workflow execution
function createWorkflowExecution(tenant, workflowName, status = 'completed', createdAt = null, currentState = null, versionId = null) {
  const executionId = uuidv4();
  return {
    execution_id: executionId,
    tenant,
    workflow_name: workflowName,
    workflow_version: '1.0.0',
    current_state: currentState || (status === 'completed' ? 'final' : 'in_progress'),
    status,
    created_at: createdAt || randomRecentDate(),
    updated_at: randomRecentDate(),
    context_data: JSON.stringify({
      id: executionId,
      data: {}
    }),
    version_id: versionId
  };
}

// Helper function to create a workflow event
function createWorkflowEvent(executionId, tenant, eventName, fromState, toState, createdAt, payload = {}) {
  return {
    event_id: uuidv4(),
    execution_id: executionId,
    tenant,
    event_name: eventName,
    event_type: 'state_transition',
    from_state: fromState,
    to_state: toState,
    user_id: null,
    created_at: createdAt,
    payload: JSON.stringify(payload)
  };
}

// Helper function to create a workflow action result
function createWorkflowActionResult(executionId, tenant, actionName, eventId, success = true, createdAt = null) {
  const startedAt = createdAt || randomRecentDate();
  const completedAt = success ? randomLaterDate(startedAt, 5) : null;
  
  return {
    result_id: uuidv4(),
    execution_id: executionId,
    tenant,
    action_name: actionName,
    event_id: eventId,
    idempotency_key: `${executionId}:${actionName}:${Date.now()}`,
    parameters: JSON.stringify({}),
    result: success ? JSON.stringify({ success: true }) : null,
    error_message: success ? null : 'Action failed due to an error',
    success,
    ready_to_execute: false,
    started_at: startedAt,
    completed_at: completedAt
  };
}

// Wonderland characters for use in the seed data
const wonderlandCharacters = [
  'Alice', 'White Rabbit', 'Mad Hatter', 'March Hare', 'Dormouse', 
  'Cheshire Cat', 'Queen of Hearts', 'King of Hearts', 'Caterpillar',
  'Duchess', 'Cook', 'Bill the Lizard', 'Mock Turtle', 'Gryphon'
];

exports.seed = async function(knex) {
  // Clean up existing data
  await knex('workflow_event_processing').del();
  await knex('workflow_action_results').del();
  await knex('workflow_events').del();
  await knex('workflow_executions').del();
  
  // Get the tenant ID from the tenants table
  const tenantRecord = await knex('tenants').select('tenant').first();
  if (!tenantRecord) {
    console.error('No tenant found in the database. Please run the tenant seed first.');
    return;
  }
  
  // Use the tenant ID from the database
  const tenant = tenantRecord.tenant;
  
  // Check if there's a registration version for InvoiceApproval
  let invoiceApprovalVersionId = null;
  const registration = await knex('workflow_registrations')
    .where('tenant_id', tenant)
    .where('name', 'InvoiceApproval')
    .first();
    
  if (registration) {
    const versionRecord = await knex('workflow_registration_versions')
      .where('tenant_id', tenant)
      .where('registration_id', registration.registration_id)
      .where('is_current', true)
      .first();
      
    if (versionRecord) {
      invoiceApprovalVersionId = versionRecord.version_id;
    }
  }
  
  // Create workflow executions
  const workflowExecutions = [];
  const workflowEvents = [];
  const workflowActionResults = [];
  
  // 1. Invoice Approval Workflows
  for (let i = 0; i < 10; i++) {
    const status = i < 6 ? 'completed' : (i < 9 ? 'active' : 'failed');
    const createdAt = randomRecentDate();
    
    // Determine current state based on status and progress
    let currentState;
    if (status === 'completed') {
      currentState = 'paid';
    } else if (status === 'failed') {
      currentState = 'rejected';
    } else {
      // For active workflows, pick a random state
      const activeStates = ['draft', 'submitted', 'approved'];
      currentState = activeStates[Math.floor(Math.random() * activeStates.length)];
    }
    
    // Create workflow execution
    const execution = createWorkflowExecution(tenant, 'InvoiceApproval', status, createdAt, currentState, invoiceApprovalVersionId);
    workflowExecutions.push(execution);
    
    // Create initial context data
    const invoiceId = `INV-${1000 + i}`;
    const invoiceAmount = Math.floor(Math.random() * 5000) + 500;
    const submitter = wonderlandCharacters[Math.floor(Math.random() * wonderlandCharacters.length)];
    
    // Update context data with invoice information
    const contextData = JSON.parse(execution.context_data);
    contextData.data.invoice = {
      id: invoiceId,
      amount: invoiceAmount,
      submitter: submitter,
      status: 'draft'
    };
    execution.context_data = JSON.stringify(contextData);
    
    // Create initial state event
    const initialEvent = createWorkflowEvent(
      execution.execution_id,
      tenant,
      'workflow.started',
      'none',
      'draft',
      createdAt,
      {
        workflow_name: 'InvoiceApproval',
        initial_data: {
          invoice: {
            id: invoiceId,
            amount: invoiceAmount,
            submitter: submitter,
            status: 'draft'
          }
        }
      }
    );
    workflowEvents.push(initialEvent);
    
    // Add Submit event for all workflows
    if (currentState !== 'draft' || status !== 'active') {
      const submitEventTime = randomLaterDate(createdAt, 60);
      
      const submitEvent = createWorkflowEvent(
        execution.execution_id,
        tenant,
        'Submit',
        'draft',
        'submitted',
        submitEventTime,
        {
          submittedBy: submitter
        }
      );
      workflowEvents.push(submitEvent);
      
      // Create action results for the submit event
      workflowActionResults.push(
        createWorkflowActionResult(
          execution.execution_id,
          tenant,
          'send_notification',
          submitEvent.event_id,
          true,
          randomLaterDate(submitEventTime, 1)
        )
      );
      
      workflowActionResults.push(
        createWorkflowActionResult(
          execution.execution_id,
          tenant,
          'log_audit_event',
          submitEvent.event_id,
          true,
          randomLaterDate(submitEventTime, 2)
        )
      );
      
      // Add Approve/Reject event for workflows past submission
      if (currentState !== 'submitted' || status !== 'active') {
        const decisionEventTime = randomLaterDate(submitEventTime, 120);
        const decisionEvent = status === 'failed' ? 'Reject' : 'Approve';
        const nextState = status === 'failed' ? 'rejected' : 'approved';
        const approver = wonderlandCharacters[Math.floor(Math.random() * wonderlandCharacters.length)];
        
        const decisionEventObj = createWorkflowEvent(
          execution.execution_id,
          tenant,
          decisionEvent,
          'submitted',
          nextState,
          decisionEventTime,
          {
            approver: approver
          }
        );
        workflowEvents.push(decisionEventObj);
        
        // Create action results for the decision event
        if (decisionEvent === 'Approve') {
          // For approval
          workflowActionResults.push(
            createWorkflowActionResult(
              execution.execution_id,
              tenant,
              'get_user_role',
              decisionEventObj.event_id,
              true,
              randomLaterDate(decisionEventTime, 1)
            )
          );
          
          workflowActionResults.push(
            createWorkflowActionResult(
              execution.execution_id,
              tenant,
              'send_notification',
              decisionEventObj.event_id,
              true,
              randomLaterDate(decisionEventTime, 2)
            )
          );
          
          workflowActionResults.push(
            createWorkflowActionResult(
              execution.execution_id,
              tenant,
              'update_invoice_status',
              decisionEventObj.event_id,
              true,
              randomLaterDate(decisionEventTime, 3)
            )
          );
          
          // Add Pay event for completed workflows
          if (status === 'completed') {
            const payEventTime = randomLaterDate(decisionEventTime, 240);
            
            const payEvent = createWorkflowEvent(
              execution.execution_id,
              tenant,
              'Pay',
              'approved',
              'paid',
              payEventTime,
              {}
            );
            workflowEvents.push(payEvent);
            
            // Create action results for the pay event
            workflowActionResults.push(
              createWorkflowActionResult(
                execution.execution_id,
                tenant,
                'generate_payment',
                payEvent.event_id,
                true,
                randomLaterDate(payEventTime, 1)
              )
            );
            
            workflowActionResults.push(
              createWorkflowActionResult(
                execution.execution_id,
                tenant,
                'record_payment',
                payEvent.event_id,
                true,
                randomLaterDate(payEventTime, 2)
              )
            );
            
            workflowActionResults.push(
              createWorkflowActionResult(
                execution.execution_id,
                tenant,
                'send_receipt',
                payEvent.event_id,
                true,
                randomLaterDate(payEventTime, 3)
              )
            );
          }
        } else {
          // For rejection
          workflowActionResults.push(
            createWorkflowActionResult(
              execution.execution_id,
              tenant,
              'send_notification',
              decisionEventObj.event_id,
              true,
              randomLaterDate(decisionEventTime, 1)
            )
          );
          
          workflowActionResults.push(
            createWorkflowActionResult(
              execution.execution_id,
              tenant,
              'update_invoice_status',
              decisionEventObj.event_id,
              true,
              randomLaterDate(decisionEventTime, 2)
            )
          );
        }
      }
    }
  }
  
  // Insert all the data
  await knex('workflow_executions').insert(workflowExecutions);
  await knex('workflow_events').insert(workflowEvents);
  await knex('workflow_action_results').insert(workflowActionResults);
  
  console.log(`Inserted ${workflowExecutions.length} workflow executions`);
  console.log(`Inserted ${workflowEvents.length} workflow events`);
  console.log(`Inserted ${workflowActionResults.length} workflow action results`);
};