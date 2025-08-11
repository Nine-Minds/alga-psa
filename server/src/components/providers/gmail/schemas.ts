import * as z from 'zod';

// Common/base schema used by both CE and EE
export const baseGmailProviderSchema = z.object({
  providerName: z.string().min(1, 'Provider name is required'),
  mailbox: z.string().email('Valid Gmail address is required'),
  isActive: z.boolean(),
  autoProcessEmails: z.boolean(),
  labelFilters: z.string().optional(),
  maxEmailsPerSync: z.number().min(1).max(1000),
});

export type BaseGmailProviderFormData = z.infer<typeof baseGmailProviderSchema>;

// CE-specific schema extends base with Google Cloud config fields
export const ceGmailProviderSchema = baseGmailProviderSchema.extend({
  clientId: z.string().min(1, 'Client ID is required'),
  clientSecret: z.string().min(1, 'Client Secret is required'),
  projectId: z.string().min(1, 'Google Cloud Project ID is required'),
  redirectUri: z.string().url('Valid redirect URI is required'),
});

export type CEGmailProviderFormData = z.infer<typeof ceGmailProviderSchema>;

