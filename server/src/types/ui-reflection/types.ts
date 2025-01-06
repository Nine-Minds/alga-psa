/**
 * UI Reflection System Types
 * 
 * This module defines the type system for the UI reflection framework, which provides
 * a live, high-level JSON description of the application's UI state. These types
 * enable automated testing and LLM-driven interactions by providing a structured
 * representation of UI components and their states.
 */

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
  
  /** List of valid actions that can be performed on this component */
  actions?: string[];

  /** Parent component ID for hierarchical relationships */
  parentId?: string;

  /** Child components for hierarchical structure */
  children?: UIComponent[];
}

/**
 * Button component representation.
 */
export interface ButtonComponent extends BaseComponent {
  type: "button";
  
  /** Visual style variant of the button */
  variant?: "primary" | "secondary" | "danger" | string;
}

/**
 * Dialog component representation.
 */
export interface DialogComponent extends BaseComponent {
  type: "dialog";
  
  /** Whether the dialog is currently open */
  open: boolean;
  
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
}

/**
 * Form component representation.
 */
export interface FormComponent extends BaseComponent {
  type: "form";
  // Uses children inherited from BaseComponent to contain FormFieldComponents
}

/**
 * Data grid component representation.
 */
export interface DataGridComponent extends BaseComponent {
  type: "dataGrid";
  
  /** Column definitions */
  columns: Array<{
    id: string;
    header: string;
  }>;
  
  /** Row data */
  rows: Array<{
    id: string;
    cells: Array<{
      columnId: string;
      value: string;
    }>;
    actions?: string[];
  }>;
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
export type UIComponent =
  | ButtonComponent
  | DialogComponent
  | FormComponent
  | FormFieldComponent
  | DataGridComponent
  | NavigationComponent
  | DataTableComponent
  | ContainerComponent
  | CardComponent;

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
