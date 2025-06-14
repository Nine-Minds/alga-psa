/**
 * Descriptor-based UI system for extensions
 * 
 * This system replaces React component imports with declarative descriptors
 * that describe UI structure and behavior without requiring module resolution.
 */

/**
 * Base descriptor interface that all UI descriptors extend
 */
export interface BaseDescriptor {
  /** Unique identifier for debugging */
  id?: string;
  /** Conditional rendering */
  condition?: ConditionDescriptor;
  /** Security context */
  permissions?: string[];
}

/**
 * Condition for conditional rendering
 */
export interface ConditionDescriptor {
  /** Property path to evaluate */
  path: string;
  /** Comparison operator */
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'contains' | 'exists';
  /** Value to compare against */
  value?: any;
}

/**
 * Main UI descriptor for any UI element
 */
export interface UIDescriptor extends BaseDescriptor {
  /** Type of UI element (button, input, card, etc.) */
  type: string;
  /** Props to pass to the component */
  props?: Record<string, any>;
  /** Child descriptors */
  children?: (UIDescriptor | string | number)[];
  /** Event handlers */
  handlers?: Record<string, string | HandlerDescriptor>;
  /** Styling */
  style?: StyleDescriptor;
}

/**
 * Handler descriptor for events
 */
export interface HandlerDescriptor {
  /** Handler function name from the handlers module */
  handler: string;
  /** Additional parameters to pass to handler */
  params?: Record<string, any>;
  /** Prevent default behavior */
  preventDefault?: boolean;
  /** Stop propagation */
  stopPropagation?: boolean;
}

/**
 * Style descriptor for component styling
 */
export interface StyleDescriptor {
  /** CSS class names */
  className?: string;
  /** Inline styles */
  style?: React.CSSProperties;
  /** Theme-aware styles (MUI sx prop) */
  sx?: Record<string, any>;
}

/**
 * Page descriptor for full pages
 */
export interface PageDescriptor extends BaseDescriptor {
  type: 'page';
  /** Page metadata */
  meta?: {
    title?: string;
    description?: string;
    keywords?: string[];
  };
  /** Page layout */
  layout?: string;
  /** Page content */
  content: UIDescriptor;
  /** Data requirements */
  data?: DataDescriptor[];
  /** Page-level handlers */
  handlers?: HandlerModule;
}

/**
 * Data descriptor for data fetching
 */
export interface DataDescriptor {
  /** Unique key for the data */
  key: string;
  /** Data source type */
  source: 'api' | 'storage' | 'context' | 'static';
  /** API endpoint or storage key */
  endpoint?: string;
  /** Request parameters */
  params?: Record<string, any>;
  /** Transform function name */
  transform?: string;
  /** Refresh interval in ms */
  refreshInterval?: number;
  /** Cache configuration */
  cache?: {
    enabled: boolean;
    ttl?: number;
    key?: string;
  };
}

/**
 * Component descriptor for reusable components
 */
export interface ComponentDescriptor extends BaseDescriptor {
  type: 'component';
  /** Component name for registry lookup */
  name: string;
  /** Props to pass to component */
  props?: Record<string, any>;
  /** Slot descriptors for component composition */
  slots?: Record<string, UIDescriptor>;
}

/**
 * Layout descriptor for page layouts
 */
export interface LayoutDescriptor extends BaseDescriptor {
  type: 'layout';
  /** Layout template name */
  template: 'default' | 'settings' | 'fullscreen' | 'minimal';
  /** Layout sections */
  sections?: {
    header?: UIDescriptor;
    sidebar?: UIDescriptor;
    content?: UIDescriptor;
    footer?: UIDescriptor;
  };
}

/**
 * Form descriptor for forms
 */
export interface FormDescriptor extends UIDescriptor {
  type: 'form';
  /** Form schema for validation */
  schema?: FormSchema;
  /** Initial values */
  initialValues?: Record<string, any>;
  /** Submit handler */
  onSubmit: string;
  /** Form fields */
  fields: FormFieldDescriptor[];
}

/**
 * Form field descriptor
 */
export interface FormFieldDescriptor extends UIDescriptor {
  /** Field name */
  name: string;
  /** Field label */
  label?: string;
  /** Field type */
  type: 'text' | 'number' | 'email' | 'password' | 'select' | 'checkbox' | 'radio' | 'textarea' | 'date' | 'time' | 'file';
  /** Validation rules */
  validation?: ValidationRule[];
  /** Field dependencies */
  dependsOn?: string[];
}

/**
 * Validation rule
 */
export interface ValidationRule {
  type: 'required' | 'min' | 'max' | 'pattern' | 'email' | 'custom';
  value?: any;
  message: string;
  /** Custom validation function name */
  validator?: string;
}

/**
 * Form schema for validation
 */
export interface FormSchema {
  /** Field definitions */
  fields: Record<string, {
    type: string;
    required?: boolean;
    validation?: ValidationRule[];
  }>;
}

/**
 * Table descriptor for data tables
 */
export interface TableDescriptor extends UIDescriptor {
  type: 'table';
  /** Column definitions */
  columns: ColumnDescriptor[];
  /** Data source */
  data: DataDescriptor;
  /** Row actions */
  rowActions?: UIDescriptor[];
  /** Bulk actions */
  bulkActions?: UIDescriptor[];
  /** Pagination config */
  pagination?: {
    enabled: boolean;
    pageSize?: number;
    pageSizeOptions?: number[];
  };
  /** Filtering config */
  filtering?: {
    enabled: boolean;
    filters?: FilterDescriptor[];
  };
  /** Sorting config */
  sorting?: {
    enabled: boolean;
    defaultSort?: { field: string; order: 'asc' | 'desc' };
  };
}

/**
 * Column descriptor for tables
 */
export interface ColumnDescriptor {
  /** Column key */
  key: string;
  /** Column header */
  header: string;
  /** Cell renderer */
  cell?: UIDescriptor | string;
  /** Column width */
  width?: number | string;
  /** Sortable */
  sortable?: boolean;
  /** Filterable */
  filterable?: boolean;
}

/**
 * Filter descriptor
 */
export interface FilterDescriptor {
  /** Filter key */
  key: string;
  /** Filter label */
  label: string;
  /** Filter type */
  type: 'text' | 'select' | 'date' | 'range' | 'boolean';
  /** Filter options for select */
  options?: { label: string; value: any }[];
}

/**
 * Handler module that contains handler functions
 */
export interface HandlerModule {
  /** Module path relative to extension root */
  module: string;
  /** Exported handler functions */
  handlers: Record<string, HandlerFunction>;
}

/**
 * Handler function signature
 */
export type HandlerFunction = (
  event: any,
  context: HandlerContext,
  params?: Record<string, any>
) => void | Promise<void>;

/**
 * Context provided to handlers
 */
export interface HandlerContext {
  /** Extension context */
  extension: {
    id: string;
    version: string;
    storage: ExtensionStorageAPI;
  };
  /** Navigation */
  navigate: (path: string) => void;
  /** API client */
  api: {
    get: (endpoint: string, params?: any) => Promise<any>;
    post: (endpoint: string, data?: any) => Promise<any>;
    put: (endpoint: string, data?: any) => Promise<any>;
    delete: (endpoint: string) => Promise<any>;
  };
  /** UI utilities */
  ui: {
    toast: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
    dialog: (descriptor: UIDescriptor) => Promise<any>;
    confirm: (message: string, title?: string) => Promise<boolean>;
  };
  /** Form utilities */
  form?: {
    values: Record<string, any>;
    errors: Record<string, string>;
    setFieldValue: (field: string, value: any) => void;
    setFieldError: (field: string, error: string) => void;
    submit: () => void;
    reset: () => void;
  };
  /** Table utilities */
  table?: {
    selectedRows: any[];
    setSelectedRows: (rows: any[]) => void;
    refresh: () => void;
  };
  /** Current user */
  user: {
    id: string;
    tenantId: string;
    permissions: string[];
  };
}

/**
 * Extension storage API interface
 */
export interface ExtensionStorageAPI {
  get: (key: string) => Promise<any>;
  set: (key: string, value: any) => Promise<void>;
  delete: (key: string) => Promise<void>;
  list: (prefix?: string) => Promise<string[]>;
}

/**
 * Descriptor validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validation error
 */
export interface ValidationError {
  path: string;
  message: string;
  code: string;
}

/**
 * Type guards for descriptors
 */
export const isUIDescriptor = (obj: any): obj is UIDescriptor => {
  return obj && typeof obj.type === 'string';
};

export const isPageDescriptor = (obj: any): obj is PageDescriptor => {
  return obj && obj.type === 'page';
};

export const isComponentDescriptor = (obj: any): obj is ComponentDescriptor => {
  return obj && obj.type === 'component';
};

export const isFormDescriptor = (obj: any): obj is FormDescriptor => {
  return obj && obj.type === 'form';
};

export const isTableDescriptor = (obj: any): obj is TableDescriptor => {
  return obj && obj.type === 'table';
};