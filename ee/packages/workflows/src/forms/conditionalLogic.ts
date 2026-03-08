/**
 * Conditional Logic Utilities for JSON Schema Forms
 *
 * This module provides utilities for handling conditional display logic in JSON Schema forms.
 * It supports dynamic schema modifications based on form data.
 */

import { RJSFSchema, UiSchema } from '@rjsf/utils';

// Simple deep clone function
function cloneDeep<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => cloneDeep(item)) as unknown as T;
  }
  
  const cloned: Record<string, any> = {};
  Object.keys(obj as Record<string, any>).forEach(key => {
    cloned[key] = cloneDeep((obj as Record<string, any>)[key]);
  });
  
  return cloned as T;
}

/**
 * Apply conditional display logic to a schema based on form data
 *
 * This function processes a schema with conditional logic and returns a modified schema
 * with appropriate fields shown or hidden based on the current form data.
 *
 * @param schema The JSON Schema to process
 * @param uiSchema The UI Schema to process
 * @param formData The current form data
 * @returns An object containing the processed schema and UI schema
 */
export function applyConditionalLogic(
  schema: RJSFSchema,
  uiSchema: UiSchema = {},
  formData: Record<string, any> = {}
): { schema: RJSFSchema; uiSchema: UiSchema } {
  // Create deep copies to avoid modifying the original objects
  const processedSchema = cloneDeep(schema);
  const processedUiSchema = cloneDeep(uiSchema);
  
  // Apply conditional display logic based on form data
  processConditionalFields(processedSchema, processedUiSchema, formData);
  
  return { schema: processedSchema, uiSchema: processedUiSchema };
}

/**
 * Process conditional fields in a schema
 *
 * @param schema The schema to process
 * @param uiSchema The UI schema to process
 * @param formData The current form data
 */
function processConditionalFields(
  schema: RJSFSchema,
  uiSchema: UiSchema,
  formData: Record<string, any>
): void {
  // Process conditional fields based on dependencies
  if (schema.properties) {
    // Check for conditional fields in the UI schema
    Object.keys(uiSchema).forEach(fieldName => {
      const fieldUiSchema = uiSchema[fieldName];
      
      // Check if the field has conditional display logic
      if (fieldUiSchema && typeof fieldUiSchema === 'object' && 'ui:displayIf' in fieldUiSchema) {
        const displayCondition = (fieldUiSchema as any)['ui:displayIf'];
        
        // Process the display condition
        const shouldDisplay = evaluateDisplayCondition(displayCondition, formData);
        
        if (!shouldDisplay) {
          // Hide the field by setting ui:widget to hidden
          (fieldUiSchema as any)['ui:widget'] = 'hidden';
        }
      }
    });
  }
}

/**
 * Evaluate a display condition based on form data
 *
 * @param condition The display condition to evaluate
 * @param formData The current form data
 * @returns True if the field should be displayed, false otherwise
 */
function evaluateDisplayCondition(
  condition: any,
  formData: Record<string, any>
): boolean {
  // Handle different condition types
  if (typeof condition === 'function') {
    // Function condition
    return condition(formData);
  } else if (typeof condition === 'object') {
    // Object condition
    if ('field' in condition && 'value' in condition) {
      // Simple field equals value condition
      const fieldValue = formData[condition.field];
      
      if (Array.isArray(condition.value)) {
        // Check if the field value is in the array
        return condition.value.includes(fieldValue);
      } else {
        // Check if the field value equals the condition value
        return fieldValue === condition.value;
      }
    } else if ('field' in condition && 'not' in condition) {
      // Simple field not equals value condition
      const fieldValue = formData[condition.field];
      
      if (Array.isArray(condition.not)) {
        // Check if the field value is not in the array
        return !condition.not.includes(fieldValue);
      } else {
        // Check if the field value does not equal the condition value
        return fieldValue !== condition.not;
      }
    } else if ('and' in condition && Array.isArray(condition.and)) {
      // AND condition
      return condition.and.every((subCondition: any) =>
        evaluateDisplayCondition(subCondition, formData)
      );
    } else if ('or' in condition && Array.isArray(condition.or)) {
      // OR condition
      return condition.or.some((subCondition: any) =>
        evaluateDisplayCondition(subCondition, formData)
      );
    }
  }
  
  // Default to showing the field if the condition is not recognized
  return true;
}

/**
 * Create a conditional field that depends on another field
 *
 * @param field The field name
 * @param dependsOn The field that this field depends on
 * @param dependsOnValue The value that the dependent field must have
 * @param schema The field schema
 * @param uiSchema The field UI schema
 * @returns An object with the field schema and UI schema
 */
export function createConditionalField(
  field: string,
  dependsOn: string,
  dependsOnValue: any,
  schema: RJSFSchema,
  uiSchema: UiSchema = {}
): { schema: RJSFSchema; uiSchema: UiSchema } {
  // Create a new UI schema with the conditional display logic
  const conditionalUiSchema = {
    ...uiSchema,
    [field]: {
      ...(uiSchema[field] || {}),
      'ui:displayIf': {
        field: dependsOn,
        value: dependsOnValue
      }
    }
  };
  
  return {
    schema,
    uiSchema: conditionalUiSchema
  };
}

/**
 * Create a conditional field that depends on multiple conditions
 *
 * @param field The field name
 * @param conditions The conditions that must be met for the field to be displayed
 * @param schema The field schema
 * @param uiSchema The field UI schema
 * @returns An object with the field schema and UI schema
 */
export function createMultiConditionalField(
  field: string,
  conditions: Array<{ field: string; value: any }>,
  schema: RJSFSchema,
  uiSchema: UiSchema = {}
): { schema: RJSFSchema; uiSchema: UiSchema } {
  // Create a new UI schema with the conditional display logic
  const conditionalUiSchema = {
    ...uiSchema,
    [field]: {
      ...(uiSchema[field] || {}),
      'ui:displayIf': {
        and: conditions
      }
    }
  };
  
  return {
    schema,
    uiSchema: conditionalUiSchema
  };
}