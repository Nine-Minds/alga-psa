import React, { useMemo, useCallback, useState, useEffect } from 'react';
import { 
  UIDescriptor, 
  PageDescriptor, 
  FormDescriptor, 
  TableDescriptor,
  HandlerContext,
  isPageDescriptor,
  isFormDescriptor,
  isTableDescriptor,
  DataDescriptor
} from './descriptors/types';
import { ComponentRegistry } from './descriptors/ComponentRegistry';
import { useRouter } from 'next/navigation';
import { sanitizeProps, validateDescriptor } from '../security/propWhitelist';

interface DescriptorRendererProps {
  descriptor: UIDescriptor | PageDescriptor;
  handlers?: Record<string, Function>;
  context?: Partial<HandlerContext>;
  data?: Record<string, any>;
}

/**
 * Renders UI from descriptors
 */
export function DescriptorRenderer({ 
  descriptor, 
  handlers = {}, 
  context: providedContext,
  data: providedData = {}
}: DescriptorRendererProps) {
  console.log(`[DescriptorRenderer] Initializing with descriptor:`, descriptor);
  console.log(`[DescriptorRenderer] Available handlers:`, Object.keys(handlers));
  
  const router = useRouter();
  const [data, setData] = useState<Record<string, any>>(providedData);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, Error>>({});

  // Build handler context
  const context = useMemo<HandlerContext>(() => {
    // If we have a full context provided, use it
    if (providedContext?.navigate && providedContext?.api && providedContext?.ui) {
      return providedContext as HandlerContext;
    }
    
    // Otherwise build a default context
    return {
      extension: {
        id: providedContext?.extension?.id || '',
        version: providedContext?.extension?.version || '',
        storage: providedContext?.extension?.storage || {
          get: async (key: string) => Promise.resolve(null),
          set: async (key: string, value: any) => Promise.resolve(),
          delete: async (key: string) => Promise.resolve(),
          list: async (prefix?: string) => Promise.resolve([])
        }
      },
      navigate: providedContext?.navigate || ((path: string) => router.push(path)),
      api: providedContext?.api || {
        get: async (endpoint: string, params?: any) => {
          const response = await fetch(endpoint, { 
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
          });
          return { data: await response.json() };
        },
        post: async (endpoint: string, body?: any) => {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          return { data: await response.json() };
        },
        put: async (endpoint: string, body?: any) => {
          const response = await fetch(endpoint, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          return { data: await response.json() };
        },
        delete: async (endpoint: string) => {
          const response = await fetch(endpoint, { method: 'DELETE' });
          return { data: await response.json() };
        }
      },
      ui: providedContext?.ui || {
        toast: (message: string, type = 'info') => {
          console.log(`[${type.toUpperCase()}] ${message}`);
        },
        dialog: async (descriptor: UIDescriptor) => {
          console.log('Dialog not yet implemented', descriptor);
          return null;
        },
        confirm: async (message: string, title?: string) => {
          return window.confirm(title ? `${title}\n\n${message}` : message);
        }
      },
      user: providedContext?.user || {
        id: '',
        tenantId: '',
        permissions: []
      }
    };
  }, [router, providedContext]);

  // Helper function to find all table descriptors recursively
  const findTableDescriptors = (desc: any): TableDescriptor[] => {
    const tables: TableDescriptor[] = [];
    
    if (isTableDescriptor(desc)) {
      tables.push(desc);
    }
    
    if (desc.children && Array.isArray(desc.children)) {
      for (const child of desc.children) {
        if (typeof child === 'object') {
          tables.push(...findTableDescriptors(child));
        }
      }
    }
    
    if (desc.content) {
      tables.push(...findTableDescriptors(desc.content));
    }
    
    return tables;
  };

  // Handle data fetching for page descriptors and tables
  useEffect(() => {
    const dataToLoad: DataDescriptor[] = [];
    
    // Load page-level data
    if (isPageDescriptor(descriptor) && descriptor.data) {
      dataToLoad.push(...descriptor.data);
    }
    
    // Find and load table data
    const tableDescriptors = findTableDescriptors(descriptor);
    for (const tableDesc of tableDescriptors) {
      dataToLoad.push(tableDesc.data);
    }
    
    if (dataToLoad.length > 0) {
      fetchData(dataToLoad);
    }
  }, [descriptor]);

  // Helper function to substitute template variables
  const substituteTemplate = (template: string, variables: Record<string, any>): string => {
    return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
      const value = variables[key.trim()];
      return value !== undefined ? String(value) : match;
    });
  };

  const fetchData = async (dataDescriptors: DataDescriptor[]) => {
    for (const dataDesc of dataDescriptors) {
      setLoading(prev => ({ ...prev, [dataDesc.key]: true }));
      try {
        let result: any;
        
        switch (dataDesc.source) {
          case 'api':
            if (dataDesc.endpoint) {
              // Substitute template variables in endpoint
              const templateVars = {
                extensionId: context.extension.id,
                ...providedData,
                ...(providedData.params || {})
              };
              const endpoint = substituteTemplate(dataDesc.endpoint, templateVars);
              console.log(`[DescriptorRenderer] API call: ${dataDesc.endpoint} -> ${endpoint}`);
              
              const response = await context.api.get(endpoint, dataDesc.params);
              result = response.data;
            }
            break;
          
          case 'storage':
            if (dataDesc.endpoint) {
              result = await context.extension.storage.get(dataDesc.endpoint);
            }
            break;
          
          case 'static':
            result = dataDesc.params;
            break;
          
          case 'context':
            result = providedData[dataDesc.key];
            break;
        }

        // Apply transform if specified
        if (dataDesc.transform && handlers[dataDesc.transform]) {
          result = await handlers[dataDesc.transform](result, context);
        }

        console.log(`[DescriptorRenderer] Setting data for key '${dataDesc.key}':`, result);
        
        setData(prev => ({ 
          ...prev, 
          [dataDesc.key]: result?.data || result  // Handle both {data: [...]} and [...] formats
        }));
      } catch (error) {
        console.error(`Error fetching data for ${dataDesc.key}:`, error);
        setErrors(prev => ({ ...prev, [dataDesc.key]: error as Error }));
      } finally {
        setLoading(prev => ({ ...prev, [dataDesc.key]: false }));
      }
    }
  };

  // Handle conditional rendering
  const checkCondition = (descriptor: UIDescriptor): boolean => {
    if (!descriptor.condition) return true;
    
    const { path, operator, value } = descriptor.condition;
    const actualValue = path.split('.').reduce((obj, key) => obj?.[key], data);
    
    switch (operator) {
      case 'eq': return actualValue === value;
      case 'neq': return actualValue !== value;
      case 'gt': return actualValue > value;
      case 'lt': return actualValue < value;
      case 'gte': return actualValue >= value;
      case 'lte': return actualValue <= value;
      case 'in': return Array.isArray(value) && value.includes(actualValue);
      case 'contains': return String(actualValue).includes(value);
      case 'exists': return actualValue !== undefined && actualValue !== null;
      default: return true;
    }
  };

  // Handle permission checks
  const hasPermission = (descriptor: UIDescriptor): boolean => {
    if (!descriptor.permissions || descriptor.permissions.length === 0) return true;
    return descriptor.permissions.every(perm => context.user.permissions.includes(perm));
  };

  // Render a single descriptor
  const renderDescriptor = (desc: UIDescriptor | string | number): React.ReactNode => {
    // Handle primitive values
    if (typeof desc === 'string' || typeof desc === 'number') {
      return desc;
    }

    // Validate descriptor for security
    if (!validateDescriptor(desc)) {
      console.error(`[DescriptorRenderer] Invalid descriptor detected, skipping render`);
      return null;
    }

    console.log(`[DescriptorRenderer] Rendering descriptor with type: ${desc.type}`);

    // Check conditions and permissions
    if (!checkCondition(desc) || !hasPermission(desc)) {
      console.log(`[DescriptorRenderer] Skipping descriptor due to condition/permission check`);
      return null;
    }

    // Handle page descriptors
    if (isPageDescriptor(desc)) {
      console.log(`[DescriptorRenderer] Rendering page descriptor`);
      const { content, layout = 'default' } = desc;
      // TODO: Apply layout
      return renderDescriptor(content);
    }

    // Get component from registry
    const Component = ComponentRegistry.get(desc.type);
    if (!Component) {
      console.warn(`[DescriptorRenderer] Component type "${desc.type}" not found in registry`);
      // For unknown types, try to render as a plain HTML element if it's an allowed element
      const allowedElements = ['div', 'span', 'a', 'button', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'li', 'nav', 'section', 'article', 'header', 'footer', 'main'];
      if (allowedElements.includes(desc.type)) {
        const Element = desc.type as keyof JSX.IntrinsicElements;
        const sanitizedProps = sanitizeProps(desc.props || {});
        if (desc.children) {
          const children = desc.children.map((child, index) => {
            if (typeof child === 'string' || typeof child === 'number') {
              return child;
            }
            return renderDescriptor({ ...child, id: `${desc.id}-child-${index}` });
          });
          return <Element {...sanitizedProps} key={desc.id}>{children}</Element>;
        }
        return <Element {...sanitizedProps} key={desc.id} />;
      }
      return null;
    }
    
    console.log(`[DescriptorRenderer] Found component for type: ${desc.type}`);

    // Build and sanitize props
    const props: any = sanitizeProps({
      ...desc.props,
      key: desc.id
    });

    // Handle styles
    if (desc.style) {
      if (desc.style.className) props.className = desc.style.className;
      if (desc.style.style) props.style = desc.style.style;
      if (desc.style.sx) props.sx = desc.style.sx;
    }

    // Handle event handlers
    if (desc.handlers) {
      Object.entries(desc.handlers).forEach(([event, handler]) => {
        const eventName = event.startsWith('on') ? event : `on${event.charAt(0).toUpperCase()}${event.slice(1)}`;
        
        if (typeof handler === 'string') {
          // Simple handler reference
          props[eventName] = (e: any) => {
            if (handlers[handler]) {
              handlers[handler](e, context);
            } else {
              console.warn(`Handler "${handler}" not found`);
            }
          };
        } else {
          // Handler descriptor with options
          props[eventName] = (e: any) => {
            if (handler.preventDefault) e.preventDefault();
            if (handler.stopPropagation) e.stopPropagation();
            
            if (handlers[handler.handler]) {
              handlers[handler.handler](e, context, handler.params);
            } else {
              console.warn(`Handler "${handler.handler}" not found`);
            }
          };
        }
      });
    }

    // Handle form descriptors
    if (isFormDescriptor(desc)) {
      return renderForm(desc);
    }

    // Handle table descriptors
    if (isTableDescriptor(desc)) {
      return renderTable(desc);
    }

    // Handle children
    if (desc.children) {
      const children = desc.children.map((child, index) => {
        const key = `${desc.id || 'desc'}-child-${index}`;
        
        // If child is a primitive (string or number), return it directly
        if (typeof child === 'string' || typeof child === 'number') {
          return child;
        }
        
        // If child is an object but doesn't have an id, add one
        if (typeof child === 'object' && !('id' in child)) {
          return renderDescriptor({ ...child, id: key });
        }
        
        // Otherwise, render as is
        return renderDescriptor(child);
      });
      return <Component {...props}>{children}</Component>;
    }

    return <Component {...props} />;
  };

  // Render form descriptor
  const renderForm = (desc: FormDescriptor): React.ReactNode => {
    const [formData, setFormData] = useState(desc.initialValues || {});
    const [formErrors, setFormErrors] = useState<Record<string, string>>({});

    const formContext: HandlerContext = {
      ...context,
      form: {
        values: formData,
        errors: formErrors,
        setFieldValue: (field: string, value: any) => {
          setFormData(prev => ({ ...prev, [field]: value }));
        },
        setFieldError: (field: string, error: string) => {
          setFormErrors(prev => ({ ...prev, [field]: error }));
        },
        submit: () => {
          if (handlers[desc.onSubmit]) {
            handlers[desc.onSubmit](formData, formContext);
          }
        },
        reset: () => {
          setFormData(desc.initialValues || {});
          setFormErrors({});
        }
      }
    };

    return (
      <form onSubmit={(e) => {
        e.preventDefault();
        formContext.form!.submit();
      }}>
        {desc.fields.map(field => renderDescriptor({ ...field, id: field.name }))}
      </form>
    );
  };

  // Render table descriptor
  const renderTable = (desc: TableDescriptor): React.ReactNode => {
    const [selectedRows, setSelectedRows] = useState<any[]>([]);
    const tableData = data[desc.data.key] || [];

    console.log(`[DescriptorRenderer] Rendering table with data:`, {
      key: desc.data.key,
      dataKeys: Object.keys(data),
      tableData,
      loading: loading[desc.data.key]
    });

    const tableContext: HandlerContext = {
      ...context,
      table: {
        selectedRows,
        setSelectedRows,
        refresh: () => fetchData([desc.data])
      }
    };

    // Convert descriptor columns to DataTable format
    const dataTableColumns = desc.columns.map(col => ({
      title: col.header,
      dataIndex: col.key,
      width: col.width,
      sortable: col.sortable,
      render: col.cell ? (value: any, record: any, index: number) => {
        // Create a context with the current row data for template substitution
        const cellContext = {
          row: record,
          value,
          index,
          ...providedData
        };
        
        // If cell has template variables, substitute them
        let cellDescriptor = col.cell;
        if (typeof cellDescriptor === 'object') {
          console.log(`[DescriptorRenderer] Before substitution:`, JSON.stringify(cellDescriptor));
          console.log(`[DescriptorRenderer] Cell context:`, cellContext);
          
          cellDescriptor = JSON.parse(JSON.stringify(cellDescriptor).replace(/\{\{([^}]+)\}\}/g, (match, key) => {
            const expression = key.trim();
            console.log(`[DescriptorRenderer] Processing template: ${match}, expression: '${expression}'`);
            
            try {
              // Create a safe evaluation context
              const evalContext = {
                row: record,
                value,
                index,
                ...providedData
              };
              
              // For simple property access, use direct access for safety
              if (expression.match(/^row\.\w+$/)) {
                const propPath = expression.substring(4); // Remove 'row.'
                const result = record[propPath];
                console.log(`[DescriptorRenderer] Simple property '${propPath}' = ${result}`);
                return result !== undefined ? String(result) : match;
              }
              
              // For method calls and complex expressions, use Function constructor for safe evaluation
              // Replace 'row' with 'evalContext.row' in the expression
              const safeExpression = expression.replace(/\brow\b/g, 'evalContext.row');
              console.log(`[DescriptorRenderer] Safe expression: ${safeExpression}`);
              
              // Create a function that evaluates the expression in the given context
              const func = new Function('evalContext', `
                try {
                  return ${safeExpression};
                } catch (e) {
                  console.warn('Template evaluation error:', e.message);
                  return undefined;
                }
              `);
              
              const result = func(evalContext);
              console.log(`[DescriptorRenderer] Expression result: ${result}`);
              return result !== undefined ? String(result) : match;
              
            } catch (error) {
              console.warn(`[DescriptorRenderer] Failed to evaluate template ${match}:`, error);
              return match; // Return original template if evaluation fails
            }
          }));
          
          console.log(`[DescriptorRenderer] After substitution:`, JSON.stringify(cellDescriptor));
        }
        
        return renderDescriptor({
          ...cellDescriptor,
          handlers: cellDescriptor.handlers ? Object.entries(cellDescriptor.handlers).reduce((acc, [event, handler]) => {
            if (typeof handler === 'string') {
              acc[event] = (e: any) => {
                if (handlers[handler]) {
                  handlers[handler](e, tableContext, { ...record });
                }
              };
            } else if (typeof handler === 'object' && handler.handler) {
              acc[event] = (e: any) => {
                if (handler.preventDefault) e.preventDefault();
                if (handler.stopPropagation) e.stopPropagation();
                
                if (handlers[handler.handler]) {
                  // Substitute template variables in params
                  const params = handler.params ? JSON.parse(JSON.stringify(handler.params).replace(/\{\{([^}]+)\}\}/g, (match, key) => {
                    const value = cellContext[key.trim()];
                    return value !== undefined ? String(value) : match;
                  })) : record;
                  
                  handlers[handler.handler](e, tableContext, params);
                }
              };
            }
            return acc;
          }, {} as any) : undefined
        });
      } : undefined
    }));

    // Get the DataTable component from registry
    const DataTableComponent = ComponentRegistry.get('DataTable');
    
    if (!DataTableComponent) {
      console.error('[DescriptorRenderer] DataTable component not found in registry');
      return <div className="text-red-500">DataTable component not available</div>;
    }

    const dataTableProps = {
      columns: dataTableColumns,
      data: tableData,
      pagination: desc.pagination?.enabled !== false,
      pageSize: desc.pagination?.pageSize || 10,
      initialSorting: desc.sorting?.defaultSort ? [{
        id: desc.sorting.defaultSort.field,
        desc: desc.sorting.defaultSort.order === 'desc'
      }] : undefined,
      onRowClick: (record: any) => {
        // Handle row click if defined in table descriptor
        console.log('Row clicked:', record);
      }
    };

    console.log(`[DescriptorRenderer] DataTable props:`, dataTableProps);

    // Show loading state if data is being fetched
    if (loading[desc.data.key]) {
      return (
        <div className="p-4 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-2"></div>
          <div className="text-gray-600">Loading data...</div>
        </div>
      );
    }

    // Show error state if there was an error
    if (errors[desc.data.key]) {
      return (
        <div className="p-4 text-center text-red-600">
          <div className="mb-2">❌ Failed to load data</div>
          <div className="text-sm">{errors[desc.data.key].message}</div>
        </div>
      );
    }

    return <DataTableComponent {...dataTableProps} />;
  };

  // Handle both UIDescriptor and PageDescriptor types
  if (isPageDescriptor(descriptor)) {
    return renderDescriptor(descriptor.content);
  } else {
    return renderDescriptor(descriptor as UIDescriptor);
  }
}