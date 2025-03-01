import { WorkflowDefinition, Expression, ActionInvocation, TransitionAction, ParallelBlock, ForkBlock, JoinBlock } from './workflowParser';

/**
 * Interfaces for the stateless event-sourced state machine
 */

export interface WorkflowContext {
  [key: string]: any;
}

export interface WorkflowEvent {
  event_id: string;         // Unique identifier for idempotency
  execution_id: string;     // Workflow instance ID
  event_name: string;       // Name of the event
  payload: any;             // Event data
  user_id?: string;         // User who triggered the event (if applicable)
  timestamp: string;        // When the event occurred
  tenant: string;           // Tenant identifier for multi-tenancy
  from_state?: string;      // State before the event (optional, determined during processing)
  to_state?: string;        // State after the event (optional, determined during processing)
}

export interface ActionToExecute {
  name: string;             // Name of the action to execute
  parameters: Record<string, any>;  // Parameters for the action
  idempotencyKey: string;   // To ensure the action is executed exactly once
}

export interface EventProcessingResult {
  previousState: string;    // The state before processing the event
  nextState: string;        // The state after processing the event
  actionsToExecute: ActionToExecute[]; // Actions to execute as a result
  isValid: boolean;         // Whether the event was valid in the current state
  errorMessage?: string;    // Error message if the event was invalid
}

export interface ReplayResult {
  currentState: string;     // The current state after replaying all events
  context: WorkflowContext; // The accumulated context data
}

/**
 * Evaluates a condition expression against the provided context
 * @param condition The condition expression to evaluate
 * @param context The context data to evaluate against
 * @param userRole The role of the user attempting the transition
 * @returns Whether the condition is satisfied
 */
export function evaluateCondition(
  condition: Expression | undefined,
  context: WorkflowContext,
  userRole?: string
): boolean {
  if (!condition) {
    return true; // No condition means it's always satisfied
  }

  // Add the userRole to the context if provided
  const evaluationContext = userRole ? { ...context, role: userRole } : context;

  switch (condition.type) {
    case 'literal':
      return Boolean(condition.value);

    case 'variable':
      return Boolean(evaluationContext[condition.name]);

    case 'property_access': {
      let value = evaluationContext[condition.base];
      if (value === undefined) {
        return false;
      }
      
      for (const prop of condition.properties) {
        if (value === null || value === undefined || typeof value !== 'object') {
          return false;
        }
        value = value[prop];
        if (value === undefined) {
          return false;
        }
      }
      
      return Boolean(value);
    }

    case 'binary_operation': {
      const left = evaluateCondition(condition.left, evaluationContext);
      const right = evaluateCondition(condition.right, evaluationContext);
      
      switch (condition.operator) {
        case '==': return left == right;
        case '!=': return left != right;
        case '>': return left > right;
        case '>=': return left >= right;
        case '<': return left < right;
        case '<=': return left <= right;
        case 'in': {
          // Handle 'in' operator for checking if a value is in an array or string
          if (Array.isArray(right)) {
            return (right as any[]).includes(left);
          } else if (typeof right === 'string') {
            return (right as string).includes(String(left));
          }
          return false;
        }
        default:
          throw new Error(`Unsupported binary operator: ${condition.operator}`);
      }
    }

    case 'logical_operation': {
      switch (condition.operator) {
        case 'and':
          return condition.operands.every((operand: Expression) => 
            evaluateCondition(operand, evaluationContext)
          );
        case 'or':
          return condition.operands.some((operand: Expression) => 
            evaluateCondition(operand, evaluationContext)
          );
        case 'not':
          return !evaluateCondition(condition.operands[0], evaluationContext);
        default:
          throw new Error(`Unsupported logical operator: ${condition.operator}`);
      }
    }

    default:
      throw new Error(`Unsupported condition type: ${condition.type}`);
  }
}

/**
 * Generates a unique idempotency key for an action based on its parameters and context
 * @param actionName The name of the action
 * @param parameters The parameters for the action
 * @param eventId The ID of the event that triggered the action
 * @returns A unique idempotency key
 */
function generateIdempotencyKey(actionName: string, parameters: any, eventId: string): string {
  return `${actionName}:${eventId}:${JSON.stringify(parameters)}`;
}

/**
 * Stateless State Machine class that processes events by replaying the event log
 */
export class StateMachine {
  /**
   * Process a new event by replaying all previous events and determining the resulting actions
   * @param workflowDefinition The workflow definition
   * @param eventLog All previous events for this workflow execution
   * @param newEvent The new event being processed
   * @param contextData Additional context data for condition evaluation
   * @returns The result of processing the event
   */
  processEvent(
    workflowDefinition: WorkflowDefinition,
    eventLog: WorkflowEvent[],
    newEvent: WorkflowEvent,
    contextData: WorkflowContext = {}
  ): EventProcessingResult {
    // First, replay all previous events to determine the current state and context
    const { currentState, context } = this.replayEvents(workflowDefinition, eventLog);
    
    // Merge the new event's payload with the accumulated context
    const mergedContext = {
      ...context,
      ...contextData
    };
    
    // Find all transitions that can be triggered by this event from the current state
    const possibleTransitions = workflowDefinition.transitions.filter(
      t => t.from === currentState && t.event === newEvent.event_name
    );
    
    if (possibleTransitions.length === 0) {
      return {
        previousState: currentState,
        nextState: currentState, // State doesn't change
        actionsToExecute: [],
        isValid: false,
        errorMessage: `No transition defined for event '${newEvent.event_name}' from state '${currentState}'`
      };
    }
    
    // Find the first transition whose condition is satisfied
    const applicableTransition = possibleTransitions.find(transition => 
      evaluateCondition(transition.condition, mergedContext, newEvent.user_id)
    );
    
    if (!applicableTransition) {
      return {
        previousState: currentState,
        nextState: currentState, // State doesn't change
        actionsToExecute: [],
        isValid: false,
        errorMessage: `Conditions not satisfied for any transition from '${currentState}' for event '${newEvent.event_name}'`
      };
    }
    
    // Convert action invocations to executable actions with idempotency keys
    const actionsToExecute: ActionToExecute[] = [];
    
    // Process all actions in the transition
    applicableTransition.actions.forEach(action => {
      // Only process ActionInvocation types directly
      if (action.type === 'action_invocation') {
        const actionInvocation = action as ActionInvocation;
        const parameters: Record<string, any> = {};
        
        actionInvocation.arguments.forEach((arg, index) => {
          // Evaluate the argument value if it's an expression
          const value = arg.value && typeof arg.value === 'object' && 'type' in arg.value ? 
            evaluateCondition(arg.value as Expression, mergedContext) : 
            arg.value;
          
          // Use the argument name if provided, otherwise use a numeric index
          const paramName = arg.name || `param${index}`;
          parameters[paramName] = value;
        });
        
        actionsToExecute.push({
          name: actionInvocation.name,
          parameters,
          idempotencyKey: generateIdempotencyKey(
            actionInvocation.name, 
            actionInvocation.arguments, 
            newEvent.event_id
          )
        });
      }
      // For other types (ParallelBlock, ForkBlock, JoinBlock), they will be processed
      // separately by the workflow runtime or execution engine
    });
    
    // Update the from_state and to_state in the new event
    newEvent.from_state = currentState;
    newEvent.to_state = applicableTransition.to;
    
    return {
      previousState: currentState,
      nextState: applicableTransition.to,
      actionsToExecute,
      isValid: true
    };
  }
  
  /**
   * Replay events to determine the current state and context
   * @param workflowDefinition The workflow definition
   * @param events The events to replay
   * @returns The current state and accumulated context after replaying events
   */
  replayEvents(
    workflowDefinition: WorkflowDefinition,
    events: WorkflowEvent[]
  ): ReplayResult {
    // Start with the initial state (first state defined in the workflow)
    let currentState = workflowDefinition.states[0]?.name || 'draft';
    
    // Accumulate context data from all events
    const context: WorkflowContext = {};
    
    // Replay each event in order
    for (const event of events) {
      // Find transitions from the current state that match this event
      const possibleTransitions = workflowDefinition.transitions.filter(
        t => t.from === currentState && t.event === event.event_name
      );
      
      // If there are no matching transitions, skip this event
      if (possibleTransitions.length === 0) {
        continue;
      }
      
      // Merge the event payload into the context
      if (event.payload) {
        Object.assign(context, event.payload);
      }
      
      // Find the first transition whose condition is satisfied
      const applicableTransition = possibleTransitions.find(transition => 
        evaluateCondition(transition.condition, context, event.user_id)
      );
      
      // If a valid transition is found, update the current state
      if (applicableTransition) {
        currentState = applicableTransition.to;
      }
    }
    
    return { currentState, context };
  }
  
  /**
   * Get all available events for the current state
   * @param workflowDefinition The workflow definition
   * @param currentState The current state
   * @returns An array of available event names
   */
  getAvailableEvents(
    workflowDefinition: WorkflowDefinition,
    currentState: string
  ): string[] {
    // Find all transitions from the current state
    const transitions = workflowDefinition.transitions.filter(
      t => t.from === currentState
    );
    
    // Extract unique event names
    const eventNames = transitions
      .map(t => t.event)
      .filter((event): event is string => event !== undefined);
    
    return [...new Set(eventNames)];
  }
  
  /**
   * Get all available actions for the current state
   * @param workflowDefinition The workflow definition
   * @param currentState The current state
   * @returns An array of available action names
   */
  getAvailableActions(
    workflowDefinition: WorkflowDefinition,
    currentState: string
  ): string[] {
    // Find the state definition
    const state = workflowDefinition.states.find(s => s.name === currentState);
    
    // If the state has explicitly defined available actions, use those
    if (state?.availableActions && state.availableActions.length > 0) {
      return state.availableActions;
    }
    
    // Otherwise, infer available actions from transitions
    const transitions = workflowDefinition.transitions.filter(
      t => t.from === currentState
    );
    
    // Extract unique action names from all transitions
    const actionNames = transitions.flatMap(
      t => t.actions
        .filter(a => a.type === 'action_invocation')
        .map(a => (a as ActionInvocation).name)
    );
    
    return [...new Set(actionNames)];
  }
}

/**
 * Creates a new StateMachine instance
 * @returns A new StateMachine instance
 */
export function createStateMachine(): StateMachine {
  return new StateMachine();
}
