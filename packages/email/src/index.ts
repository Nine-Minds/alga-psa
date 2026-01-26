/**
 * @alga-psa/email
 *
 * Main entry point exports buildable lib/services code only.
 * For runtime code, use:
 * - '@alga-psa/email/actions' for server actions (send* functions)
 */

// System email exports (buildable)
export { SystemEmailService, getSystemEmailService } from './system/SystemEmailService';
export * from './system/types';

// Tenant email exports (buildable)
export { TenantEmailService } from './TenantEmailService';
export { DelayedEmailQueue } from './DelayedEmailQueue';
export type {
  DelayedEmailEntry,
  DelayedEmailQueueConfig,
  RedisClientLike,
  RedisClientGetter,
  EmailSendCallback
} from './DelayedEmailQueue';
export { TokenBucketRateLimiter } from './TokenBucketRateLimiter';
export type {
  RateLimitResult,
  BucketConfig,
  TokenBucketRedisClient,
  TokenBucketRedisGetter,
  BucketConfigGetter
} from './TokenBucketRateLimiter';
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

// System email provider factory (buildable)
export { SystemEmailProviderFactory } from './system/SystemEmailProviderFactory';

// Tenant email provider manager (buildable)
export { EmailProviderManager } from './providers/EmailProviderManager';

// Locale and features (buildable)
export {
  resolveEmailLocale,
  getTenantDefaultLocale,
  resolveEmailLocalesForRecipients,
  getUserInfoForEmail,
  type EmailRecipient
} from './emailLocaleResolver';
export { isEnterprise, getFeatureImplementation } from './features';
export { LOCALE_CONFIG, isSupportedLocale, type SupportedLocale } from './lib/localeConfig';
