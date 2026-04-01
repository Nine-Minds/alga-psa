import * as z from 'zod';

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

export const createBaseGmailProviderSchema = (t: TranslateFn) => z.object({
  providerName: z.string().min(1, t('forms.gmail.validation.providerNameRequired', {
    defaultValue: 'Provider name is required',
  })),
  mailbox: z.string().email(t('forms.gmail.validation.gmailAddressRequired', {
    defaultValue: 'Valid Gmail address is required',
  })),
  isActive: z.boolean(),
  autoProcessEmails: z.boolean(),
  labelFilters: z.string().optional(),
  // Max per sync is not used; keep optional for backward compatibility
  maxEmailsPerSync: z.number().min(1).max(1000).optional(),
  inboundTicketDefaultsId: z.string().optional(),
});

export type BaseGmailProviderFormData = z.infer<ReturnType<typeof createBaseGmailProviderSchema>>;

export const createCeGmailProviderSchema = (t: TranslateFn) => createBaseGmailProviderSchema(t);

export type CEGmailProviderFormData = z.infer<ReturnType<typeof createCeGmailProviderSchema>>;

const englishFallbackT: TranslateFn = (key, options) => {
  if (typeof options?.defaultValue === 'string') {
    return options.defaultValue;
  }
  return key;
};

export const baseGmailProviderSchema = createBaseGmailProviderSchema(englishFallbackT);
export const ceGmailProviderSchema = baseGmailProviderSchema;
