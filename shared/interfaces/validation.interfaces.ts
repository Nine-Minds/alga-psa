/**
 * Canonical Validation Interfaces
 * Common validation types used across models
 */

/**
 * Result of a validation operation
 */
export interface ValidationResult {
  valid: boolean;
  data?: any;
  errors?: string[];
}