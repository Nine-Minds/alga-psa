import * as z from 'zod';

// Common/base schema used by both CE and EE
export const baseGmailProviderSchema = z.object({
  providerName: z.string().min(1, 'Provider name is required'),
  mailbox: z.string().email('Valid Gmail address is required'),
  isActive: z.boolean(),
  autoProcessEmails: z.boolean(),
  labelFilters: z.string().optional(),
  // Max per sync is not used; keep optional for backward compatibility
  maxEmailsPerSync: z.number().min(1).max(1000).optional(),
  inboundTicketDefaultsId: z.string().optional(),
});

export type BaseGmailProviderFormData = z.infer<typeof baseGmailProviderSchema>;

// CE-specific schema extends base with Google Cloud config fields
export const ceGmailProviderSchema = baseGmailProviderSchema;

export type CEGmailProviderFormData = z.infer<typeof ceGmailProviderSchema>;
