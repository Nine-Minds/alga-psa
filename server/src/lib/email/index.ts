/**
 * Email Services Export
 * 
 * This module provides two distinct email services:
 * 
 * 1. SystemEmailService - For platform/system emails using environment variables
 * 2. TenantEmailService - For tenant-specific business emails using database settings
 */

// System email exports
export { SystemEmailService, getSystemEmailService } from './system/SystemEmailService';
export * from './system/types';

// Tenant email exports  
export { TenantEmailService } from '../services/TenantEmailService';
export * from './tenant/templateProcessors';
export type { 
  SendEmailParams as TenantEmailParams,
  EmailSettingsValidation 
} from '../services/TenantEmailService';

// Re-export common types for convenience
export type {
  ITemplateProcessor,
  TemplateProcessorOptions,
  EmailTemplateContent
} from './tenant/templateProcessors';

export type {
  EmailAddress,
  EmailSendResult
} from './BaseEmailService';