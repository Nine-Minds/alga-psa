/**
 * Shared types for extension handlers
 */

export interface HandlerContext {
  extension: {
    id: string;
    version: string;
    storage: {
      get: (key: string) => Promise<any>;
      set: (key: string, value: any) => Promise<void>;
      delete: (key: string) => Promise<void>;
      list: (prefix?: string) => Promise<string[]>;
    };
  };
  navigate: (path: string) => void;
  api: {
    get: (endpoint: string, params?: any) => Promise<any>;
    post: (endpoint: string, data?: any) => Promise<any>;
    put: (endpoint: string, data?: any) => Promise<any>;
    delete: (endpoint: string) => Promise<any>;
  };
  ui: {
    toast: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
    dialog: (descriptor: any) => Promise<any>;
    confirm: (message: string, title?: string) => Promise<boolean>;
  };
  form?: {
    values: Record<string, any>;
    errors: Record<string, string>;
    setFieldValue: (field: string, value: any) => void;
    setFieldError: (field: string, error: string) => void;
    submit: () => void;
    reset: () => void;
  };
  table?: {
    selectedRows: any[];
    setSelectedRows: (rows: any[]) => void;
    refresh: () => void;
  };
  user: {
    id: string;
    tenantId: string;
    permissions: string[];
  };
}