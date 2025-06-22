import { 
  UIDescriptor, 
  PageDescriptor, 
  FormDescriptor,
  TableDescriptor,
  ValidationResult, 
  ValidationError,
  isPageDescriptor,
  isFormDescriptor,
  isTableDescriptor
} from './types';

/**
 * Validate a descriptor
 */
export async function validateDescriptor(descriptor: any): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  
  if (!descriptor) {
    errors.push({
      path: '',
      message: 'Descriptor is null or undefined',
      code: 'INVALID_DESCRIPTOR'
    });
    return { valid: false, errors };
  }

  if (typeof descriptor !== 'object') {
    errors.push({
      path: '',
      message: 'Descriptor must be an object',
      code: 'INVALID_TYPE'
    });
    return { valid: false, errors };
  }

  if (!descriptor.type || typeof descriptor.type !== 'string') {
    errors.push({
      path: 'type',
      message: 'Descriptor must have a type property of type string',
      code: 'MISSING_TYPE'
    });
    return { valid: false, errors };
  }

  // Type-specific validation
  if (isPageDescriptor(descriptor)) {
    validatePageDescriptor(descriptor, errors);
  } else if (isFormDescriptor(descriptor)) {
    validateFormDescriptor(descriptor, errors);
  } else if (isTableDescriptor(descriptor)) {
    validateTableDescriptor(descriptor, errors);
  } else {
    validateUIDescriptor(descriptor as UIDescriptor, errors);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate a UI descriptor
 */
function validateUIDescriptor(descriptor: UIDescriptor, errors: ValidationError[], path = '') {
  // Validate props
  if (descriptor.props && typeof descriptor.props !== 'object') {
    errors.push({
      path: `${path}.props`,
      message: 'Props must be an object',
      code: 'INVALID_PROPS'
    });
  }

  // Validate children
  if (descriptor.children) {
    if (!Array.isArray(descriptor.children)) {
      errors.push({
        path: `${path}.children`,
        message: 'Children must be an array',
        code: 'INVALID_CHILDREN'
      });
    } else {
      descriptor.children.forEach((child, index) => {
        if (typeof child === 'object' && child !== null) {
          validateUIDescriptor(child as UIDescriptor, errors, `${path}.children[${index}]`);
        }
      });
    }
  }

  // Validate handlers
  if (descriptor.handlers) {
    if (typeof descriptor.handlers !== 'object') {
      errors.push({
        path: `${path}.handlers`,
        message: 'Handlers must be an object',
        code: 'INVALID_HANDLERS'
      });
    } else {
      Object.entries(descriptor.handlers).forEach(([event, handler]) => {
        if (typeof handler === 'object' && handler !== null) {
          if (!handler.handler || typeof handler.handler !== 'string') {
            errors.push({
              path: `${path}.handlers.${event}`,
              message: 'Handler descriptor must have a handler property of type string',
              code: 'INVALID_HANDLER'
            });
          }
        } else if (typeof handler !== 'string') {
          errors.push({
            path: `${path}.handlers.${event}`,
            message: 'Handler must be a string or handler descriptor',
            code: 'INVALID_HANDLER'
          });
        }
      });
    }
  }

  // Validate condition
  if (descriptor.condition) {
    if (!descriptor.condition.path || typeof descriptor.condition.path !== 'string') {
      errors.push({
        path: `${path}.condition.path`,
        message: 'Condition must have a path property of type string',
        code: 'INVALID_CONDITION'
      });
    }
    if (!descriptor.condition.operator || typeof descriptor.condition.operator !== 'string') {
      errors.push({
        path: `${path}.condition.operator`,
        message: 'Condition must have an operator property',
        code: 'INVALID_CONDITION'
      });
    }
  }

  // Validate permissions
  if (descriptor.permissions && !Array.isArray(descriptor.permissions)) {
    errors.push({
      path: `${path}.permissions`,
      message: 'Permissions must be an array',
      code: 'INVALID_PERMISSIONS'
    });
  }

  // Validate style
  if (descriptor.style) {
    if (typeof descriptor.style !== 'object') {
      errors.push({
        path: `${path}.style`,
        message: 'Style must be an object',
        code: 'INVALID_STYLE'
      });
    }
  }
}

/**
 * Validate a page descriptor
 */
function validatePageDescriptor(descriptor: PageDescriptor, errors: ValidationError[]) {
  if (!descriptor.content) {
    errors.push({
      path: 'content',
      message: 'Page descriptor must have a content property',
      code: 'MISSING_CONTENT'
    });
  } else {
    validateUIDescriptor(descriptor.content, errors, 'content');
  }

  if (descriptor.data) {
    if (!Array.isArray(descriptor.data)) {
      errors.push({
        path: 'data',
        message: 'Data must be an array',
        code: 'INVALID_DATA'
      });
    } else {
      descriptor.data.forEach((dataDesc, index) => {
        if (!dataDesc.key || typeof dataDesc.key !== 'string') {
          errors.push({
            path: `data[${index}].key`,
            message: 'Data descriptor must have a key property',
            code: 'MISSING_DATA_KEY'
          });
        }
        if (!dataDesc.source || typeof dataDesc.source !== 'string') {
          errors.push({
            path: `data[${index}].source`,
            message: 'Data descriptor must have a source property',
            code: 'MISSING_DATA_SOURCE'
          });
        }
      });
    }
  }

  if (descriptor.handlers) {
    if (!descriptor.handlers.module || typeof descriptor.handlers.module !== 'string') {
      errors.push({
        path: 'handlers.module',
        message: 'Handler module must have a module property of type string',
        code: 'MISSING_HANDLER_MODULE'
      });
    }
  }
}

/**
 * Validate a form descriptor
 */
function validateFormDescriptor(descriptor: FormDescriptor, errors: ValidationError[]) {
  if (!descriptor.onSubmit || typeof descriptor.onSubmit !== 'string') {
    errors.push({
      path: 'onSubmit',
      message: 'Form descriptor must have an onSubmit property of type string',
      code: 'MISSING_ONSUBMIT'
    });
  }

  if (!descriptor.fields || !Array.isArray(descriptor.fields)) {
    errors.push({
      path: 'fields',
      message: 'Form descriptor must have a fields array',
      code: 'MISSING_FIELDS'
    });
  } else {
    descriptor.fields.forEach((field, index) => {
      if (!field.name || typeof field.name !== 'string') {
        errors.push({
          path: `fields[${index}].name`,
          message: 'Field must have a name property',
          code: 'MISSING_FIELD_NAME'
        });
      }
      if (!field.type || typeof field.type !== 'string') {
        errors.push({
          path: `fields[${index}].type`,
          message: 'Field must have a type property',
          code: 'MISSING_FIELD_TYPE'
        });
      }
      validateUIDescriptor(field, errors, `fields[${index}]`);
    });
  }
}

/**
 * Validate a table descriptor
 */
function validateTableDescriptor(descriptor: TableDescriptor, errors: ValidationError[]) {
  if (!descriptor.columns || !Array.isArray(descriptor.columns)) {
    errors.push({
      path: 'columns',
      message: 'Table descriptor must have a columns array',
      code: 'MISSING_COLUMNS'
    });
  } else {
    descriptor.columns.forEach((column, index) => {
      if (!column.key || typeof column.key !== 'string') {
        errors.push({
          path: `columns[${index}].key`,
          message: 'Column must have a key property',
          code: 'MISSING_COLUMN_KEY'
        });
      }
      if (!column.header || typeof column.header !== 'string') {
        errors.push({
          path: `columns[${index}].header`,
          message: 'Column must have a header property',
          code: 'MISSING_COLUMN_HEADER'
        });
      }
    });
  }

  if (!descriptor.data) {
    errors.push({
      path: 'data',
      message: 'Table descriptor must have a data property',
      code: 'MISSING_DATA'
    });
  } else {
    if (!descriptor.data.key || typeof descriptor.data.key !== 'string') {
      errors.push({
        path: 'data.key',
        message: 'Table data must have a key property',
        code: 'MISSING_DATA_KEY'
      });
    }
    if (!descriptor.data.source || typeof descriptor.data.source !== 'string') {
      errors.push({
        path: 'data.source',
        message: 'Table data must have a source property',
        code: 'MISSING_DATA_SOURCE'
      });
    }
  }

  validateUIDescriptor(descriptor, errors);
}

/**
 * Check for circular references in a descriptor
 */
export function hasCircularReference(descriptor: any, visited = new WeakSet()): boolean {
  if (typeof descriptor !== 'object' || descriptor === null) {
    return false;
  }

  if (visited.has(descriptor)) {
    return true;
  }

  visited.add(descriptor);

  for (const key in descriptor) {
    if (descriptor.hasOwnProperty(key)) {
      if (hasCircularReference(descriptor[key], visited)) {
        return true;
      }
    }
  }

  visited.delete(descriptor);
  return false;
}

/**
 * Sanitize a descriptor (remove potentially dangerous properties)
 */
export function sanitizeDescriptor(descriptor: any): any {
  if (typeof descriptor !== 'object' || descriptor === null) {
    return descriptor;
  }

  const sanitized: any = {};
  const dangerousProps = ['__proto__', 'constructor', 'prototype'];

  for (const key in descriptor) {
    if (descriptor.hasOwnProperty(key) && !dangerousProps.includes(key)) {
      if (key === 'handlers' && typeof descriptor[key] === 'object') {
        // Sanitize handler names
        sanitized[key] = {};
        for (const event in descriptor[key]) {
          const handler = descriptor[key][event];
          if (typeof handler === 'string') {
            // Ensure handler name is alphanumeric with underscores
            if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(handler)) {
              sanitized[key][event] = handler;
            }
          } else if (typeof handler === 'object' && handler.handler) {
            if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(handler.handler)) {
              sanitized[key][event] = {
                ...handler,
                handler: handler.handler
              };
            }
          }
        }
      } else if (Array.isArray(descriptor[key])) {
        sanitized[key] = descriptor[key].map(sanitizeDescriptor);
      } else if (typeof descriptor[key] === 'object') {
        sanitized[key] = sanitizeDescriptor(descriptor[key]);
      } else {
        sanitized[key] = descriptor[key];
      }
    }
  }

  return sanitized;
}