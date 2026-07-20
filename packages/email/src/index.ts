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
export { DelayedEmailQueue } from './DelayedEmailQueue';
export type {
  DelayedEmailEntry,
  DelayedEmailQueueConfig,
  RedisClientLike,
  RedisClientGetter,
  EmailSendCallback
} from './DelayedEmailQueue';
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

// Ticket-scoped email threading helpers (also used by verification scripts/tests).
export {
  applyTicketThreadHeaders,
  buildTicketThreadHeaders,
  capReferences
} from './BaseEmailService';

// Individual email sending functions
export { sendPasswordResetEmail } from './sendPasswordResetEmail';
export { sendPortalInvitationEmail } from './sendPortalInvitationEmail';
export { sendTenantRecoveryEmail } from './clientPortalTenantRecoveryEmail';
export { sendVerificationEmail } from './sendVerificationEmail';
export { sendCancellationFeedbackEmail } from './sendCancellationFeedbackEmail';
export { sendPremiumTrialRequestEmail } from './sendPremiumTrialRequestEmail';

// System email provider factory
export { SystemEmailProviderFactory } from './system/SystemEmailProviderFactory';

// Tenant email provider manager
export { EmailProviderManager } from './providers/EmailProviderManager';

// Shared settings defaults
export {
  createDefaultProviderConfig,
  type EditableEmailProviderType,
} from './providerConfig';
