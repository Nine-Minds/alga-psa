/**
 * UI Reflection System Types
 * These types mirror the ones in the server for UI state tracking
 */

export interface BaseComponent {
  id: string;
  type: string;
  label?: string;
  disabled?: boolean;
  actions?: string[];
  parentId?: string;
  children?: UIComponent[];
  ordinal?: number;
}

export interface ButtonComponent extends BaseComponent {
  type: "button";
  variant?: "primary" | "secondary" | "danger" | string;
}

export interface DialogComponent extends BaseComponent {
  type: "dialog";
  open: boolean;
  title: string;
  content?: UIComponent[];
}

export interface FormField {
  id: string;
  type: "textField" | "checkbox" | "select" | "radio";
  label?: string;
  value?: string | boolean;
  disabled?: boolean;
  required?: boolean;
}

export interface FormComponent extends BaseComponent {
  type: "form";
  fields: FormField[];
}

export interface DataTableComponent extends BaseComponent {
  type: "dataTable";
  columns: Array<{
    id: string;
    title: string;
    dataIndex: string | string[];
    hasCustomRender: boolean;
    visible?: boolean;
  }>;
  pagination: {
    enabled: boolean;
    currentPage: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
  rowCount: number;
  visibleRows: Array<{
    id: string;
    values: Record<string, unknown>;
  }>;
  sortedBy?: {
    column: string;
    direction: 'asc' | 'desc';
  };
  isEditable: boolean;
}

export interface DataGridComponent extends BaseComponent {
  type: "dataGrid";
  columns: Array<{
    id: string;
    header: string;
  }>;
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
 * Text component representation for displaying text content.
 */
export interface TextComponent extends BaseComponent {
  type: "text";
  
  /** The text content being displayed */
  text: string;
  
  /** Whether the text is currently visible */
  visible?: boolean;
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

export type UIComponent =
  | ButtonComponent
  | DialogComponent
  | FormComponent
  | DataTableComponent
  | DataGridComponent
  | TextComponent
  | NavigationComponent
  | ContainerComponent
  | InputComponent;

export interface PageState {
  id: string;
  title: string;
  url?: string;
  components: UIComponent[];
}
