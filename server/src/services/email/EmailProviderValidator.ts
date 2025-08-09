/**
 * Email Provider Validator
 * Validates email provider configurations and returns user-friendly error messages
 */

import { CreateProviderData } from './EmailProviderService';

export interface ValidationError {
  field: string;
  message: string;
}

export class EmailProviderValidator {
  /**
   * Validates email provider data before creation
   * @returns Array of validation errors, empty if valid
   */
  static validateCreateProvider(data: CreateProviderData): ValidationError[] {
    const errors: ValidationError[] = [];

    // Validate provider type
    if (!data.providerType) {
      errors.push({ field: 'providerType', message: 'Provider type is required' });
    } else if (!['google', 'microsoft'].includes(data.providerType)) {
      errors.push({ field: 'providerType', message: 'Provider type must be either "google" or "microsoft"' });
    }

    // Validate provider name
    if (!data.providerName || data.providerName.trim() === '') {
      errors.push({ field: 'providerName', message: 'Provider name is required' });
    } else if (data.providerName.length > 255) {
      errors.push({ field: 'providerName', message: 'Provider name must be less than 255 characters' });
    }

    // Validate mailbox
    if (!data.mailbox || data.mailbox.trim() === '') {
      errors.push({ field: 'mailbox', message: 'Email address is required' });
    } else if (!this.isValidEmail(data.mailbox.trim())) {
      errors.push({ field: 'mailbox', message: 'Please enter a valid email address' });
    }

    // Validate vendor-specific configuration
    if (data.providerType === 'google') {
      this.validateGoogleConfig(data.vendorConfig, errors);
    } else if (data.providerType === 'microsoft') {
      this.validateMicrosoftConfig(data.vendorConfig, errors);
    }

    return errors;
  }

  /**
   * Validates Google provider configuration
   */
  private static validateGoogleConfig(config: any, errors: ValidationError[]): void {
    if (!config) {
      errors.push({ field: 'vendorConfig', message: 'Google provider configuration is required' });
      return;
    }

    // Required fields for Google provider
    const requiredFields = [
      { field: 'clientId', message: 'Google Client ID is required' },
      { field: 'clientSecret', message: 'Google Client Secret is required' },
      { field: 'projectId', message: 'Google Cloud Project ID is required' },
      { field: 'pubSubTopic', message: 'Pub/Sub topic name is required' },
      { field: 'pubSubSubscription', message: 'Pub/Sub subscription name is required' }
    ];

    for (const { field, message } of requiredFields) {
      if (!config[field] || (typeof config[field] === 'string' && config[field].trim() === '')) {
        errors.push({ field: `vendorConfig.${field}`, message });
      }
    }

    // Validate specific field formats
    if (config.clientId && !config.clientId.endsWith('.apps.googleusercontent.com') && !config.clientId.includes('test')) {
      errors.push({ 
        field: 'vendorConfig.clientId', 
        message: 'Google Client ID should end with ".apps.googleusercontent.com"' 
      });
    }

    // Validate maxEmailsPerSync if provided
    if (config.maxEmailsPerSync !== undefined) {
      const max = Number(config.maxEmailsPerSync);
      if (isNaN(max) || max < 1 || max > 1000) {
        errors.push({ 
          field: 'vendorConfig.maxEmailsPerSync', 
          message: 'Max emails per sync must be between 1 and 1000' 
        });
      }
    }
  }

  /**
   * Validates Microsoft provider configuration
   */
  private static validateMicrosoftConfig(config: any, errors: ValidationError[]): void {
    if (!config) {
      errors.push({ field: 'vendorConfig', message: 'Microsoft provider configuration is required' });
      return;
    }

    // Required fields for Microsoft provider
    const requiredFields = [
      { field: 'clientId', message: 'Microsoft Client ID is required' },
      { field: 'clientSecret', message: 'Microsoft Client Secret is required' }
    ];

    for (const { field, message } of requiredFields) {
      if (!config[field] || (typeof config[field] === 'string' && config[field].trim() === '')) {
        errors.push({ field: `vendorConfig.${field}`, message });
      }
    }

    // Validate tenantId format if provided
    if (config.tenantId && config.tenantId !== 'common' && config.tenantId !== 'organizations' && config.tenantId !== 'consumers') {
      // Check if it looks like a GUID
      const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!guidPattern.test(config.tenantId)) {
        errors.push({ 
          field: 'vendorConfig.tenantId', 
          message: 'Tenant ID must be "common", "organizations", "consumers", or a valid GUID' 
        });
      }
    }

    // Validate maxEmailsPerSync if provided
    if (config.maxEmailsPerSync !== undefined) {
      const max = Number(config.maxEmailsPerSync);
      if (isNaN(max) || max < 1 || max > 1000) {
        errors.push({ 
          field: 'vendorConfig.maxEmailsPerSync', 
          message: 'Max emails per sync must be between 1 and 1000' 
        });
      }
    }
  }

  /**
   * Validates email address format
   */
  private static isValidEmail(email: string): boolean {
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Formats validation errors into a user-friendly message
   */
  static formatValidationErrors(errors: ValidationError[]): string {
    if (errors.length === 0) return '';
    
    if (errors.length === 1) {
      return errors[0].message;
    }

    return 'Please fix the following errors:\n' + 
      errors.map(e => `• ${e.message}`).join('\n');
  }
}