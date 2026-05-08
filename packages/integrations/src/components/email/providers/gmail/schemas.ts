import * as z from 'zod';

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

// Forbid control chars, double-quote, and angle brackets in the sender display
// name — these can break the `"Name" <email>` formatting or enable header
// injection when the value flows into outbound mail headers.
const SENDER_DISPLAY_NAME_FORBIDDEN = /[\x00-\x1F\x7F"<>]/;

export const createBaseGmailProviderSchema = (t: TranslateFn) => z.object({
  providerName: z.string().min(1, t('forms.gmail.validation.providerNameRequired', {
    defaultValue: 'Configuration name is required',
  })),
  senderDisplayName: z
    .string()
    .max(255)
    .refine((value) => !SENDER_DISPLAY_NAME_FORBIDDEN.test(value), {
      message: t('forms.gmail.validation.senderDisplayNameInvalid', {
        defaultValue: 'Display name cannot contain quotes, angle brackets, or line breaks',
      }),
    })
    .optional(),
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
