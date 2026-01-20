export * from './EmailProviderCard';
export { EmailProviderConfiguration } from './EmailProviderConfiguration';
export type { EmailProvider, MicrosoftEmailProviderConfig, GoogleEmailProviderConfig, ImapEmailProviderConfig } from './types';
export * from './EmailProviderConfigurationWrapper';
export * from './EmailProviderList';
export * from './EmailProviderSelector';
export * from './GmailProviderForm';
export * from './ImapProviderForm';
export * from './MicrosoftProviderForm';
export * from './ProviderSetupWizardDialog';
export * from './emailProviderDefaults';

export * from './admin';
export * from './forms';

export type {
  BaseGmailProviderFormData,
  CEGmailProviderFormData,
} from './providers/gmail/schemas';

// Gmail provider components for EE extension
export { useOAuthPopup } from './providers/gmail/useOAuthPopup';
export { BasicConfigCard } from './providers/gmail/BasicConfigCard';
export { ProcessingSettingsCard } from './providers/gmail/ProcessingSettingsCard';
export { OAuthSection } from './providers/gmail/OAuthSection';
export { baseGmailProviderSchema } from './providers/gmail/schemas';
