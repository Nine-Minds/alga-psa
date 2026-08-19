/**
 * The single structural authority for client and contact fields.
 *
 * Consumed by the forms, the server actions and the REST API so the three tiers
 * cannot drift apart again. Rules here are structural only — does it parse, does it
 * fit the column, will it break something downstream. Everything that is an opinion
 * about whether the input is *sincere* lives in the advise* helpers in
 * clientFormValidation.ts and is surfaced as a warning.
 *
 * The columns are all `text`; the limits below are the reconciled application limit
 * (255 everywhere, replacing the 255-vs-256 disagreement between the REST API and
 * the form).
 */

import { z } from 'zod';
import { normalizePhone, PHONE_EXTENSION_MAX_LENGTH } from '../phone';

export const CLIENT_CONTACT_FIELD_LIMITS = {
  clientName: 255,
  contactName: 255,
  email: 255,
  url: 255,
  phone: 32,
  phoneExtension: PHONE_EXTENSION_MAX_LENGTH,
} as const;

const trimmed = () => z.string().transform((value) => value.trim());

/** Prefix a bare host with https:// so `acme.com` and `https://acme.com` agree. */
export function withDefaultScheme(url: string): string {
  if (!url) {
    return url;
  }
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
}

export function parseUrl(url: string): URL | null {
  try {
    const parsed = new URL(withDefaultScheme(url));
    return parsed.hostname.includes('.') ? parsed : null;
  } catch {
    return null;
  }
}

export const clientNameSchema = trimmed().pipe(
  z
    .string()
    .min(1, 'Client name is required')
    .max(CLIENT_CONTACT_FIELD_LIMITS.clientName, `Client name must be ${CLIENT_CONTACT_FIELD_LIMITS.clientName} characters or less`)
);

export const contactNameSchema = trimmed().pipe(
  z
    .string()
    .min(1, 'Contact name is required')
    .max(CLIENT_CONTACT_FIELD_LIMITS.contactName, `Contact name must be ${CLIENT_CONTACT_FIELD_LIMITS.contactName} characters or less`)
);

/** Trim + lowercase, then RFC-parse. Lowercasing is normalization, not a rule. */
export const emailFieldSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(
    z
      .string()
      .email('Please enter a valid email address')
      .max(CLIENT_CONTACT_FIELD_LIMITS.email, `Email address must be ${CLIENT_CONTACT_FIELD_LIMITS.email} characters or less`)
  );

export const urlFieldSchema = trimmed()
  .pipe(z.string().max(CLIENT_CONTACT_FIELD_LIMITS.url, `Website URL must be ${CLIENT_CONTACT_FIELD_LIMITS.url} characters or less`))
  .superRefine((value, ctx) => {
    if (value && !parseUrl(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Please enter a valid website URL (e.g., apple.com)',
      });
    }
  })
  .transform((value) => (value ? withDefaultScheme(value) : value));

export const phoneExtensionSchema = trimmed().pipe(
  z
    .string()
    .max(CLIENT_CONTACT_FIELD_LIMITS.phoneExtension, `Extension must be ${CLIENT_CONTACT_FIELD_LIMITS.phoneExtension} digits or less`)
    .regex(/^\d*$/, 'Extension can only contain digits')
);

/**
 * Phone parsed through libphonenumber-js. No region context is assumed: a bare
 * national number is length-checked and kept verbatim rather than guessed into a
 * country. Callers that know the region should normalize with `normalizePhone`
 * before parsing.
 */
export const phoneFieldSchema = z
  .string()
  .transform((value) => value.trim())
  .superRefine((value, ctx) => {
    if (!value) {
      return;
    }
    const normalized = normalizePhone(value);
    if (normalized.error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          normalized.error === 'extensionInvalid'
            ? 'Please enter a valid phone extension'
            : 'Please enter a valid phone number',
      });
    }
  })
  .transform((value) => (value ? normalizePhone(value).value : value));

/**
 * Blank, null and undefined all mean "not supplied" for these fields, so they skip
 * the schema entirely rather than being funnelled into a union whose failure message
 * would be a useless "invalid input".
 */
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) => (isBlank(value) ? undefined : value),
    schema.optional()
  );

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/**
 * Client fields that the schema owns. Deliberately narrow: every other client
 * column keeps whatever rules its own layer already declares.
 */
export const clientCoreFieldsSchema = z.object({
  client_name: clientNameSchema,
  email: optional(emailFieldSchema),
  url: optional(urlFieldSchema),
  phone_no: optional(phoneFieldSchema),
  phone_extension: optional(phoneExtensionSchema),
});

/**
 * Partial variant used for updates. Only submitted keys are validated, so a partial
 * update to a row that predates the schema cannot fail on a field nobody touched.
 */
export const clientCoreFieldsUpdateSchema = clientCoreFieldsSchema.partial();

export const contactCoreFieldsSchema = z.object({
  full_name: contactNameSchema,
  email: optional(emailFieldSchema),
  phone_number: optional(phoneFieldSchema),
  phone_extension: optional(phoneExtensionSchema),
});

export const contactCoreFieldsUpdateSchema = contactCoreFieldsSchema.partial();

export const clientLocationCoreFieldsSchema = z.object({
  email: optional(emailFieldSchema),
  phone: optional(phoneFieldSchema),
  phone_extension: optional(phoneExtensionSchema),
  fax: optional(phoneFieldSchema),
  fax_extension: optional(phoneExtensionSchema),
});

export const clientLocationCoreFieldsUpdateSchema = clientLocationCoreFieldsSchema.partial();

export type ClientCoreFields = z.infer<typeof clientCoreFieldsSchema>;
export type ContactCoreFields = z.infer<typeof contactCoreFieldsSchema>;
export type ClientLocationCoreFields = z.infer<typeof clientLocationCoreFieldsSchema>;

export interface StructuralParseResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * Parse only the keys present on the payload, leaving unrelated keys untouched.
 * This is the grandfathering rule: untouched legacy fields are never re-validated.
 */
export function parseSubmittedFields<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  payload: Record<string, unknown>,
  options: { partial?: boolean } = {}
): StructuralParseResult<Record<string, unknown>> {
  const partial = options.partial !== false;
  const submitted: Record<string, unknown> = {};
  for (const key of Object.keys(schema.shape)) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      submitted[key] = payload[key];
    }
  }

  const result = (partial ? schema.partial() : schema).safeParse(submitted);
  if (result.success) {
    // A field explicitly submitted as null/'' means "clear it"; preserve that intent
    // rather than letting the optional() preprocess drop it from the update.
    const data = { ...(result.data as Record<string, unknown>) };
    for (const [key, value] of Object.entries(submitted)) {
      if (isBlank(value) && data[key] === undefined) {
        data[key] = value;
      }
    }
    return { success: true, data };
  }

  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0] ?? '');
    if (field && !fieldErrors[field]) {
      fieldErrors[field] = issue.message;
    }
  }

  return {
    success: false,
    error: Object.values(fieldErrors)[0] ?? 'Invalid input',
    fieldErrors,
  };
}
