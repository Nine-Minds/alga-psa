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
};