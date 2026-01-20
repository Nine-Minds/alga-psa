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
export { TenantEmailService } from './TenantEmailService';
export * from './templateProcessors';
export type { 
  SendEmailParams as TenantEmailParams,
  EmailSettingsValidation 
} from './TenantEmailService';

// Re-export common types for convenience
export type {
  ITemplateProcessor,
  TemplateProcessorOptions,
  EmailTemplateContent
} from './templateProcessors';

export type {
  EmailAddress,
  EmailSendResult
} from './BaseEmailService';

// Individual email sending functions
export { sendPasswordResetEmail } from './sendPasswordResetEmail';
export { sendPortalInvitationEmail } from './sendPortalInvitationEmail';
export { sendTenantRecoveryEmail } from './clientPortalTenantRecoveryEmail';
export { sendVerificationEmail } from './sendVerificationEmail';
export { sendCancellationFeedbackEmail } from './sendCancellationFeedbackEmail';

// System email provider factory
export { SystemEmailProviderFactory } from './system/SystemEmailProviderFactory';
