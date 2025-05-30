/**
 * UI Reflection System Types
 * 
 * This module defines the type system for the UI reflection framework, which provides
 * a live, high-level JSON description of the application's UI state. These types
 * enable automated testing and LLM-driven interactions by providing a structured
 * representation of UI components and their states.
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
  updatedComponent?: UIComponent;
  /** Additional data returned by the action */
  data?: any;
}

/**
 * Interface for components that support automation testing IDs.
 */
export interface AutomationProps {
  /** Optional automation Type for testing purposes */
  'data-automation-type'?: string;
  /** Optional automation ID for testing purposes */
  'data-automation-id'?: string;
}

/**
 * Base interface for all UI components in the reflection system.
 */
export interface BaseComponent {
  /** Unique identifier for the component (e.g., "add-ticket-button") */
  id: string;
  
  /** Component type identifier (e.g., "button", "dialog", "form", "dataGrid") */
  type: string;
  
  /** User-visible label text */
  label?: string;
  
  /** Whether the component is currently disabled */
  disabled?: boolean;

  /** Helper text to provide additional context or instructions */
  helperText?: string;
  
  /** Available actions that can be performed on this component */
  actions?: ComponentAction[];

  /** Parent component ID for hierarchical relationships */
  parentId?: string;

  /** Child components for hierarchical structure */
  children?: UIComponent[];

  /** Creation order for deterministic sorting */
  ordinal?: number;
}

/**
 * Button component representation.
 */
export interface ButtonComponent extends BaseComponent {
  type: "button";
  
  /** Visual style variant of the button */
  variant?: string;
}

/**
 * Dialog component representation.
 */
export interface DialogComponent extends BaseComponent {
  type: "dialog";
  
  /** Whether the dialog is currently open */
  open?: boolean;
  
  /** Dialog title text */
  title: string;
}

/**
 * Form field component representation.
 */
export interface FormFieldComponent extends BaseComponent {
  /** Specific type identifier for form fields */
  type: "formField";
  
  /** Type of form input */
  fieldType: "textField" | "checkbox" | "select" | "radio";
  
  /** Current field value */
  value?: string | boolean;
  
  /** Whether the field is required */
  required?: boolean;

  /** Available options for select/radio fields */
  options?: Array<{
    value: string;
    label: string;
  }>;
}

/**
 * Form component representation.
 */
export interface FormComponent extends BaseComponent {
  type: "form";
  // Uses children inherited from BaseComponent to contain FormFieldComponents
}

/**
 * Data table component representation.
 */
export interface DataTableComponent extends BaseComponent {
  type: "dataTable";
  
  /** Column definitions */
  columns: Array<{
    id: string;
    title: string;
    dataIndex: string | string[];
    hasCustomRender: boolean;
  }>;
  
  /** Pagination state */
  pagination: {
    enabled: boolean;
    currentPage: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
  
  /** Number of rows in the current data set */
  rowCount: number;

  /** Currently visible rows */
  visibleRows: Array<{
    id: string;
    values: Record<string, unknown>;
  }>;
  
  /** Current sorting state */
  sortedBy?: {
    column: string;
    direction: 'asc' | 'desc';
  };
  
  /** Whether the table has editable cells */
  isEditable: boolean;
}

/**
 * Navigation component representation.
 */
export interface NavigationComponent extends BaseComponent {
  type: "navigation";
  
  /** Whether the navigation menu is expanded */
  expanded: boolean;
  
  /** Child navigation items */
  items: Array<{
    id: string;
    label: string;
    href?: string;
    icon?: string;
    active?: boolean;
    items?: Array<{
      id: string;
      label: string;
      href?: string;
      icon?: string;
      active?: boolean;
    }>;
  }>;
}

/**
 * Container component representation.
 */
export interface ContainerComponent extends BaseComponent {
  type: "container";
}

/**
 * Card component representation.
 */
export interface CardComponent extends BaseComponent {
  type: "card";
}

/**
 * Union type of all possible UI components.
 */
/**
 * Drawer component representation.
 */
export interface DrawerComponent extends BaseComponent {
  type: "drawer";
  
  /** Whether the drawer is currently open */
  open: boolean;
  
  /** Width of the drawer (e.g., "40%", "500px") */
  width?: string;
}

/**
 * Date picker component representation.
 */
export interface DatePickerComponent extends BaseComponent {
  type: "datePicker";
  
  /** Current selected date in ISO format */
  value?: string;
  
  /** Whether the picker is required */
  required?: boolean;
  
  /** Whether the picker is disabled */
  disabled?: boolean;
}

/**
 * Time picker component representation.
 */
export interface TimePickerComponent extends BaseComponent {
  type: "timePicker";
  
  /** Current selected time in HH:mm format */
  value?: string;
  
  /** Whether the picker is required */
  required?: boolean;
  
  /** Whether the picker is disabled */
  disabled?: boolean;
}

/**
 * DateTime picker component representation.
 */
export interface DateTimePickerComponent extends BaseComponent {
  type: "dateTimePicker";
  
  /** Current selected date and time in ISO format */
  value?: string;
  
  /** Whether the picker is required */
  required?: boolean;
  
  /** Whether the picker is disabled */
  disabled?: boolean;
}

/**
 * Dropdown menu component representation.
 */
export interface DropdownMenuComponent extends BaseComponent {
  type: "dropdownMenu";
  
  /** Whether the dropdown menu is currently open */
  open: boolean;
  
  /** The trigger button label */
  triggerLabel?: string;
}

/**
 * Menu item component representation.
 */
export interface MenuItemComponent extends BaseComponent {
  type: "menuItem";
  
  /** The menu item text */
  text: string;
  
  /** Icon name if present */
  icon?: string;
  
  /** Visual variant (e.g., for destructive actions) */
  variant?: string;
}

/**
 * Input component representation.
 */
export interface InputComponent extends BaseComponent {
  type: "input";
  
  /** Current input value */
  value?: string;
  
  /** Input placeholder text */
  placeholder?: string;
  
  /** Whether the input is required */
  required?: boolean;
  
  /** Input type (text, email, password, etc.) */
  inputType?: string;
}

/**
 * Text component representation for displaying text content.
 */
export interface TextComponent extends BaseComponent {
  type: "text";
  
  /** The text content being displayed */
  text: string;
  
  /** Whether the text is currently visible */
  visible?: boolean;
}

export type UIComponent =
  | ButtonComponent
  | DialogComponent
  | FormComponent
  | FormFieldComponent
  | NavigationComponent
  | DataTableComponent
  | ContainerComponent
  | CardComponent
  | DrawerComponent
  | DatePickerComponent
  | TimePickerComponent
  | DateTimePickerComponent
  | DropdownMenuComponent
  | MenuItemComponent
  | InputComponent
  | TextComponent;

/**
 * Top-level page state representation.
 */
export interface PageState {
  /** Unique identifier for the page (e.g., "ticketing-dashboard") */
  id: string;
  
  /** User-visible page title */
  title: string;
  
  /** Current page URL */
  url?: string;
  
  /** List of components on the page */
  components: UIComponent[];
}
