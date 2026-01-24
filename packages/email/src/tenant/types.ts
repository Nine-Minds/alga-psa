/**
 * Tenant Email Types
 * These types are used for tenant-specific business emails
 */

import { 
  EmailMessage, 
  EmailSendResult, 
  EmailAddress,
  TenantEmailSettings 
} from '@alga-psa/types';

// Re-export commonly used types for convenience
export type { 
  EmailMessage, 
  EmailSendResult, 
  EmailAddress,
  TenantEmailSettings 
};

// Additional tenant-specific types
export interface TenantEmailParams {
  tenantId: string;
  to: string | EmailAddress;
  templateData?: Record<string, any>;
  from?: EmailAddress;
  fromName?: string;
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  attachments?: any[];
  replyTo?: EmailAddress;
  templateProcessor: ITemplateProcessor;
}

export interface ITemplateProcessor {
  process(options: TemplateProcessorOptions): Promise<EmailTemplateContent>;
}

export interface TemplateProcessorOptions {
  templateData?: Record<string, any>;
  tenantId?: string;
}

export interface EmailTemplateContent {
  subject: string;
  htmlContent: string;
  textContent?: string;
}

export interface EmailSettingsValidation {
  valid: boolean;
  error?: string;
  settings?: TenantEmailSettings;
}
