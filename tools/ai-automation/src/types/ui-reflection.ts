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

export type UIComponent =
  | ButtonComponent
  | DialogComponent
  | FormComponent
  | DataGridComponent;

export interface PageState {
  id: string;
  title: string;
  url?: string;
  components: UIComponent[];
}
