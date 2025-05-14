
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
   * @param timeoutMs Optional timeout in milliseconds
   * @returns Promise that resolves with the event payload when it occurs, or rejects on timeout
   */
  waitFor(eventName: string | string[], timeoutMs?: number): Promise<WorkflowEvent['payload']>;
  
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
   * User ID of the user who initiated the workflow or event
   */
  userId?: string;
  
  /**
   * Proxy object for executing actions
   * This is dynamically generated based on registered actions
   */
  actions: Record<string, (params: any) => Promise<any>> & {
    createTaskAndWaitForResult: (params: CreateTaskAndWaitForResultParams) => Promise<CreateTaskAndWaitForResultReturn>;
  };
  
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
   * Input data for the workflow, often containing the trigger event
   */
  input?: {
    triggerEvent?: WorkflowEvent;
    [key: string]: any; // Allow other input properties
  };
  
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
 * Parameters for the createTaskAndWaitForResult action
 */
export interface CreateTaskAndWaitForResultParams {
  taskType: 'qbo_customer_mapping_lookup_error' |
    'secret_fetch_error' |
    'qbo_mapping_error' |
    'qbo_item_lookup_failed' |
    'qbo_item_lookup_internal_error' |
    'qbo_invoice_no_items_mapped' |
    'qbo_sync_error' |
    'workflow_execution_error' |
    'internal_workflow_error';
  title: string;
  description?: string;
  priority?: string;
  dueDate?: string; // ISO string date
  assignTo?: {
    roles?: string[];
    users?: string[];
  };
  contextData?: Record<string, any>;
  waitForEventTimeoutMilliseconds?: number;
}

/**
 * Return type for the createTaskAndWaitForResult action
 */
export interface CreateTaskAndWaitForResultReturn {
  success: boolean;
  resolutionData?: any; // Payload from the task completion event
  taskId: string | null;
  error?: string; // Error message if success is false
  details?: any; // Additional error details
}

/**
 * Type definition for a workflow function
 */
export type WorkflowFunction = (context: WorkflowContext) => Promise<void>;
