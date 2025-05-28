/**
 * Local copy of UI reflection types for the automation tools.
 * This avoids cross-package import issues during build.
 */

/**
 * Supported action types for UI components.
 */
export type ActionType = 'click' | 'type' | 'select' | 'focus' | 'open' | 'close' | 'toggle' | 'clear' | 'search' | 'navigate';

/**
 * Parameter definition for component actions.
 */
export interface ActionParameter {
  /** Parameter name */
  name: string;
  /** Parameter type */
  type: 'string' | 'option' | 'boolean' | 'number';
  /** Whether the parameter is required */
  required: boolean;
  /** Available options for 'option' type parameters */
  options?: string[];
  /** Parameter description */
  description: string;
  /** Default value if not required */
  defaultValue?: any;
}

/**
 * Action definition for UI components.
 */
export interface ComponentAction {
  /** Action type identifier */
  type: ActionType;
  /** Whether the action is currently available */
  available: boolean;
  /** Human-readable description of what the action does */
  description: string;
  /** Parameters required for this action */
  parameters?: ActionParameter[];
  /** Prerequisites that must be met before this action is available */
  prerequisites?: string[];
}

/**
 * Result of executing an action on a component.
 */
export interface ActionResult {
  /** Whether the action was successful */
  success: boolean;
  /** Error message if action failed */
  error?: string;
  /** Updated component state after action */
  updatedComponent?: any;
  /** Additional data returned by the action */
  data?: any;
}