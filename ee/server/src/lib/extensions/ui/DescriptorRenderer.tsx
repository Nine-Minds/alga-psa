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

  // Handle data fetching for page descriptors
  useEffect(() => {
    if (isPageDescriptor(descriptor) && descriptor.data) {
      fetchData(descriptor.data);
    }
  }, [descriptor]);

  const fetchData = async (dataDescriptors: DataDescriptor[]) => {
    for (const dataDesc of dataDescriptors) {
      setLoading(prev => ({ ...prev, [dataDesc.key]: true }));
      try {
        let result: any;
        
        switch (dataDesc.source) {
          case 'api':
            if (dataDesc.endpoint) {
              const response = await context.api.get(dataDesc.endpoint, dataDesc.params);
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

        setData(prev => ({ ...prev, [dataDesc.key]: result }));
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
        // If child is a primitive (string or number), pass it directly
        if (typeof child === 'string' || typeof child === 'number') {
          return renderDescriptor(child);
        }
        // If child is an object but doesn't have an id, add one
        if (typeof child === 'object' && !('id' in child)) {
          return renderDescriptor({ ...child, id: `${desc.id}-child-${index}` });
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

    const tableContext: HandlerContext = {
      ...context,
      table: {
        selectedRows,
        setSelectedRows,
        refresh: () => fetchData([desc.data])
      }
    };

    // TODO: Implement full table rendering with sorting, filtering, pagination
    return (
      <div>
        <table>
          <thead>
            <tr>
              {desc.columns.map(col => (
                <th key={col.key}>{col.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableData.map((row: any, index: number) => (
              <tr key={row.id || index}>
                {desc.columns.map(col => (
                  <td key={col.key}>
                    {col.cell ? renderDescriptor(col.cell) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  // Handle both UIDescriptor and PageDescriptor types
  if (isPageDescriptor(descriptor)) {
    return <>{renderDescriptor(descriptor.content)}</>;
  } else {
    return <>{renderDescriptor(descriptor as UIDescriptor)}</>;
  }
}