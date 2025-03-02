import { ActionRegistry } from './actionRegistry';

/**
 * Interface for workflow data management
 */
export interface WorkflowDataManager {
  /**
   * Get data by key with type safety
   */
  get<T>(key: string): T;
  
  /**
   * Set data by key
   */
  set<T>(key: string, value: T): void;
}

/**
 * Interface for workflow event handling
 */
export interface WorkflowEventManager {
  /**
   * Wait for a specific event or one of multiple events
   * @param eventName Event name or array of event names to wait for
   * @returns Promise that resolves with the event when it occurs
   */
  waitFor(eventName: string | string[]): Promise<WorkflowEvent>;
  
  /**
   * Emit an event from within the workflow
   * @param eventName Name of the event to emit
   * @param payload Optional payload for the event
   */
  emit(eventName: string, payload?: any): Promise<void>;
}

/**
 * Interface for workflow event
 */
export interface WorkflowEvent {
  name: string;
  payload: any;
  user_id?: string;
  timestamp: string;
  processed?: boolean;
}

/**
 * Interface for workflow logger
 */
export interface WorkflowLogger {
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
}

/**
 * Main workflow context interface provided to workflow functions
 */
export interface WorkflowContext {
  /**
   * Workflow execution ID
   */
  executionId: string;
  
  /**
   * Tenant ID
   */
  tenant: string;
  
  /**
   * Proxy object for executing actions
   * This is dynamically generated based on registered actions
   */
  actions: Record<string, any>;
  
  /**
   * Data manager for storing and retrieving workflow data
   */
  data: WorkflowDataManager;
  
  /**
   * Event manager for waiting for and emitting events
   */
  events: WorkflowEventManager;
  
  /**
   * Logger for workflow execution
   */
  logger: WorkflowLogger;
  
  /**
   * Get the current state of the workflow
   */
  getCurrentState(): string;
  
  /**
   * Set the current state of the workflow
   */
  setState(state: string): void;
}

/**
 * Type definition for a workflow function
 */
export type WorkflowFunction = (context: WorkflowContext) => Promise<void>;
