/**
 * @alga-psa/integrations - Components
 */

export * from './csv';
export * from './calendar';
export { AccountingMappingManager } from './accounting-mappings';
export type { AccountingMappingContext, AccountingMappingModule, AccountingMappingLoadResult } from './accounting-mappings/types';
export {
  EmailProviderConfiguration,
  INBOUND_DEFAULTS_WARNING,
  providerNeedsInboundDefaults,
  InboundTicketDefaultsManager,
  // Gmail provider components
  useOAuthPopup,
  BasicConfigCard,
  ProcessingSettingsCard,
  OAuthSection,
  baseGmailProviderSchema,
  // Provider form components
  GmailProviderForm,
  ImapProviderForm,
  MicrosoftProviderForm
} from './email';
export type { EmailProvider, MicrosoftEmailProviderConfig, GoogleEmailProviderConfig, ImapEmailProviderConfig } from './email/types';
export type { BaseGmailProviderFormData, CEGmailProviderFormData } from './email/providers/gmail/schemas';
export * from './settings';
