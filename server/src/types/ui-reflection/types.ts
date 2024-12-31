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
  
  /** Child components contained within the dialog */
  content?: UIComponent[];
}

/**
 * Form field representation within a form component.
 */
export interface FormField {
  /** Unique identifier for the field */
  id: string;
  
  /** Type of form field */
  type: "textField" | "checkbox" | "select" | "radio";
  
  /** Field label text */
  label?: string;
  
  /** Current field value */
  value?: string | boolean;
  
  /** Whether the field is disabled */
  disabled?: boolean;
  
  /** Whether the field is required */
  required?: boolean;
}

/**
 * Form component representation.
 */
export interface FormComponent extends BaseComponent {
  type: "form";
  
  /** List of form fields */
  fields: FormField[];
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
 * Union type of all possible UI components.
 */
export type UIComponent =
  | ButtonComponent
  | DialogComponent
  | FormComponent
  | DataGridComponent;

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
