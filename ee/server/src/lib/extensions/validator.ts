/**
 * Extension manifest validator
 */
import { z } from 'zod';
import { ExtensionManifest, ExtensionComponentType } from './types';
import { extensionManifestSchema } from './schemas/manifest.schema';
import { permissionsSchema, isValidPermission } from './schemas/permissions.schema';
import { 
  extensionPointSchema, 
  isValidExtensionPoint,
  getRequiredPermissions 
} from './schemas/extension-points.schema';

/**
 * Validation error structure
 */
export interface ValidationError {
  path: string;
  message: string;
}

/**
 * Result of manifest validation
 */
export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

/**
 * Validates an extension manifest
 */
export function validateManifest(manifest: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  
  // Validate against base schema
  const schemaResult = extensionManifestSchema.safeParse(manifest);
  
  if (!schemaResult.success) {
    // Convert Zod errors to our error format
    return {
      isValid: false,
      errors: schemaResult.error.errors.map(err => ({
        path: err.path.join('.'),
        message: err.message
      }))
    };
  }
  
  const validatedManifest = schemaResult.data;
  
  // Validate components and their extension points
  if (validatedManifest.components) {
    validatedManifest.components.forEach((component, index) => {
      // Check if slot is valid extension point
      if (!isValidExtensionPoint(component.slot)) {
        errors.push({
          path: `components[${index}].slot`,
          message: `Invalid extension point: ${component.slot}`
        });
      }
      
      // Check component-specific requirements
      switch (component.type) {
        case ExtensionComponentType.TAB:
          validateTabExtension(component, index, errors);
          break;
        case ExtensionComponentType.NAVIGATION:
          validateNavigationItem(component, index, errors);
          break;
        case ExtensionComponentType.DASHBOARD_WIDGET:
          validateDashboardWidget(component, index, errors);
          break;
        case ExtensionComponentType.CUSTOM_PAGE:
          validateCustomPage(component, index, errors);
          break;
      }
      
      // Check if component requests the necessary permissions for its slot
      if (isValidExtensionPoint(component.slot)) {
        const requiredPermissions = getRequiredPermissions(component.slot);
        const componentPermissions = component.props?.permissions || [];
        const declaredPermissions = validatedManifest.permissions || [];
        
        // Check if all required permissions are declared
        for (const required of requiredPermissions) {
          if (!declaredPermissions.includes(required) && 
              !componentPermissions.includes(required)) {
            errors.push({
              path: `components[${index}]`,
              message: `Component requires permission "${required}" for slot "${component.slot}", but it's not declared`
            });
          }
        }
      }
    });
  }
  
  // Validate permissions
  if (validatedManifest.permissions) {
    const permissionsResult = permissionsSchema.safeParse(validatedManifest.permissions);
    if (!permissionsResult.success) {
      permissionsResult.error.errors.forEach(err => {
        errors.push({
          path: `permissions`,
          message: err.message
        });
      });
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Validate tab extension component
 */
function validateTabExtension(component: any, index: number, errors: ValidationError[]) {
  // Validate parent page is specified
  if (!component.props?.parentPage) {
    errors.push({
      path: `components[${index}].props.parentPage`,
      message: 'Tab extensions require a parentPage property'
    });
  }
  
  // Tab-specific validation
  if (component.props?.parentPage && !component.slot.includes('tabs')) {
    errors.push({
      path: `components[${index}].slot`,
      message: `Tab extensions should use a tab-related slot (ending with -tabs)`
    });
  }
}

/**
 * Validate navigation item component
 */
function validateNavigationItem(component: any, index: number, errors: ValidationError[]) {
  // Validate path format
  if (component.props?.path && !component.props.path.startsWith('/')) {
    errors.push({
      path: `components[${index}].props.path`,
      message: 'Navigation path must start with /'
    });
  }
  
  // Check navigation-specific slots
  if (!component.slot.includes('navigation')) {
    errors.push({
      path: `components[${index}].slot`,
      message: `Navigation items should use a navigation-related slot`
    });
  }
}

/**
 * Validate dashboard widget component
 */
function validateDashboardWidget(component: any, index: number, errors: ValidationError[]) {
  // Check dashboard-specific slots
  if (!component.slot.includes('widgets')) {
    errors.push({
      path: `components[${index}].slot`,
      message: `Dashboard widgets should use a widget-related slot`
    });
  }
  
  // Validate refresh interval
  if (component.props?.refreshInterval && 
     (component.props.refreshInterval < 10 || component.props.refreshInterval > 3600)) {
    errors.push({
      path: `components[${index}].props.refreshInterval`,
      message: 'Refresh interval must be between 10 and 3600 seconds'
    });
  }
}

/**
 * Validate custom page component
 */
function validateCustomPage(component: any, index: number, errors: ValidationError[]) {
  // Validate path format
  if (component.props?.path) {
    if (!component.props.path.startsWith('/')) {
      errors.push({
        path: `components[${index}].props.path`,
        message: 'Custom page path must start with /'
      });
    }
    
    // Ensure path doesn't conflict with core routes
    const protectedPaths = ['/msp', '/auth', '/api'];
    for (const protectedPath of protectedPaths) {
      if (component.props.path.startsWith(protectedPath)) {
        errors.push({
          path: `components[${index}].props.path`,
          message: `Custom page path cannot start with protected route "${protectedPath}"`
        });
      }
    }
  }
  
  // Check custom page slot
  if (component.slot !== 'custom-pages') {
    errors.push({
      path: `components[${index}].slot`,
      message: `Custom pages should use the 'custom-pages' slot`
    });
  }
}

/**
 * Validates extension component path
 */
export function validateComponentPath(componentPath: string): boolean {
  // Component path should be a relative path and not navigate outside the extension
  return (
    componentPath &&
    !componentPath.startsWith('/') &&
    !componentPath.startsWith('./') &&
    !componentPath.includes('../')
  );
}