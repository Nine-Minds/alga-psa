/**
 * Form Validation Service
 *
 * This service provides validation of form data against JSON Schema
 */
import type { FormValidationResult } from '../persistence/formRegistryInterfaces.js';

// Define a simplified error object type that matches what Ajv returns
interface ValidationError {
  instancePath?: string;
  message?: string;
}

// Use type 'any' for Ajv to avoid TypeScript import issues
type AjvInstance = any;

export class FormValidationService {
  private ajv: AjvInstance;

  constructor() {
    try {
      // Dynamic imports to avoid TypeScript issues
      const Ajv = require('ajv');
      const ajvFormats = require('ajv-formats');
      
      // Initialize Ajv with options
      this.ajv = new (Ajv.default || Ajv)({
        allErrors: true
      });
      
      // Add formats like date, email, etc.
      (ajvFormats.default || ajvFormats)(this.ajv);
      
      // Add custom formats if needed
      this.addCustomFormats();
    } catch (error) {
      console.error('Error initializing Ajv:', error);
      throw new Error('Failed to initialize validation service');
    }
  }

  /**
   * Validate form data against a JSON schema
   */
  validate(schema: Record<string, any>, data: Record<string, any>): FormValidationResult {
    try {
      const validate = this.ajv.compile(schema);
      const valid = validate(data);
      
      if (valid) {
        return { valid: true };
      }
      
      // Format validation errors
      const errors = (validate.errors || []).map((error: ValidationError) => ({
        path: error.instancePath || '/',
        message: error.message || 'Invalid value'
      }));
      
      return {
        valid: false,
        errors
      };
    } catch (error) {
      console.error('Schema validation error:', error);
      return {
        valid: false,
        errors: [{
          path: '/',
          message: error instanceof Error ? error.message : 'Unknown validation error'
        }]
      };
    }
  }

  /**
   * Add custom formats for validation
   */
  private addCustomFormats(): void {
    // Example: Add a custom format for phone numbers
    this.ajv.addFormat('phone', {
      type: 'string',
      validate: (str: string) => {
        // Simple phone validation (can be enhanced)
        return /^\+?[0-9\s\-()]{8,20}$/.test(str);
      }
    });
    
    // Example: Add a custom format for currency
    this.ajv.addFormat('currency', {
      type: 'string',
      validate: (str: string) => {
        return /^[A-Z]{3}$/.test(str);
      }
    });
    
    // Add more custom formats as needed
  }

  /**
   * Validate a form against a specific schema version
   */
  validateAgainstVersion(
    schema: Record<string, any>,
    data: Record<string, any>,
    version: string
  ): FormValidationResult {
    // For now, this is the same as regular validation
    // In the future, this could handle version-specific validation logic
    return this.validate(schema, data);
  }

  /**
   * Validate a partial form update
   * This validates only the fields that are present in the data
   */
  validatePartial(
    schema: Record<string, any>,
    data: Record<string, any>
  ): FormValidationResult {
    // Create a modified schema where all properties are optional
    const partialSchema = {
      ...schema,
      required: [], // Remove required constraints
      properties: { ...schema.properties } // Copy properties
    };
    
    return this.validate(partialSchema, data);
  }
}

// Singleton instance
let validationServiceInstance: FormValidationService | null = null;

/**
 * Get the form validation service instance
 */
export function getFormValidationService(): FormValidationService {
  if (!validationServiceInstance) {
    validationServiceInstance = new FormValidationService();
  }
  return validationServiceInstance;
}