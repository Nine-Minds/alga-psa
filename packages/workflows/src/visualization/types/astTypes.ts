/**
 * Types for AST analysis of workflow definitions
 */

/**
 * Source location information for a node
 */
export interface SourceLocation {
  line: number;
  character: number;
  text: string;
}

/**
 * Base interface for all workflow components
 */
export interface WorkflowComponent {
  type: string;
  sourceLocation: SourceLocation;
}

/**
 * State transition component (context.setState)
 */
export interface StateTransition extends WorkflowComponent {
  type: 'stateTransition';
  stateName: string;
  fromState?: string;
  event?: string;
  condition?: string;
}

/**
 * Action call component (actions.someAction)
 */
export interface ActionCall extends WorkflowComponent {
  type: 'actionCall';
  actionName: string;
  arguments: any[];
}

/**
 * Event waiting component (events.waitFor)
 */
export interface EventWaiting extends WorkflowComponent {
  type: 'eventWaiting';
  eventNames: string[];
}

/**
 * Event emission component (events.emit)
 */
export interface EventEmission extends WorkflowComponent {
  type: 'eventEmission';
  eventName: string;
  payload?: any;
}

/**
 * Conditional component (if/else)
 */
export interface Conditional extends WorkflowComponent {
  type: 'conditional';
  condition: string;
  thenBranch: WorkflowComponent[];
  elseBranch?: WorkflowComponent[];
}

/**
 * Loop component (for, while, do-while)
 */
export interface Loop extends WorkflowComponent {
  type: 'loop';
  loopType: 'for' | 'while' | 'doWhile';
  condition: string;
  body: WorkflowComponent[];
}

/**
 * Parallel execution component (Promise.all, Promise.allSettled, etc.)
 */
export interface ParallelExecution extends WorkflowComponent {
  type: 'parallelExecution';
  branches: WorkflowComponent[][];
  executionType?: string;
}

/**
 * Control flow relationship between components
 */
export interface ControlFlow {
  from: WorkflowComponent;
  to: WorkflowComponent;
  type: 'sequential' | 'conditional' | 'loop' | 'parallel';
  condition?: string;
}

/**
 * Complete workflow analysis result
 */
export interface WorkflowAnalysis {
  states: StateTransition[];
  actions: ActionCall[];
  events: (EventWaiting | EventEmission)[];
  conditionals: Conditional[];
  loops: Loop[];
  parallelExecutions: ParallelExecution[];
  controlFlow: ControlFlow[];
}