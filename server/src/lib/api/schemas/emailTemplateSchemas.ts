/**
 * Email Template API Schemas
 * Validation schemas for tenant email template endpoints
 */

import { z } from 'zod';
import { LOCALE_CONFIG } from '@alga-psa/core/i18n/config';

/** Notification templates are keyed by a kebab-case name, not a UUID. */
export const emailTemplateNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Template name must be kebab-case');

export const emailTemplateLanguageSchema = z.enum(
  LOCALE_CONFIG.supportedLocales as unknown as [string, ...string[]],
);

/** HTML and text bodies are stored whole; the cap keeps a runaway agent out of the row. */
const CONTENT_MAX = 256 * 1024;

export const emailTemplateListQuerySchema = z.object({
  name: emailTemplateNameSchema.optional(),
  language: emailTemplateLanguageSchema.optional(),
  category: z.string().min(1).max(255).optional(),
  customized: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict();

export const emailTemplateDetailQuerySchema = z.object({
  language: emailTemplateLanguageSchema.optional(),
}).strict();

export const emailTemplateDeleteQuerySchema = z.object({
  language: emailTemplateLanguageSchema,
}).strict();

export const updateEmailTemplateSchema = z.object({
  language_code: emailTemplateLanguageSchema,
  subject: z.string().min(1).max(998).optional(),
  html_content: z.string().min(1).max(CONTENT_MAX).optional(),
  text_content: z.string().min(1).max(CONTENT_MAX).optional(),
}).strict().refine(
  (value) => value.subject !== undefined || value.html_content !== undefined || value.text_content !== undefined,
  { message: 'At least one of subject, html_content or text_content is required' },
);

export type EmailTemplateListQuery = z.infer<typeof emailTemplateListQuerySchema>;
export type EmailTemplateDetailQuery = z.infer<typeof emailTemplateDetailQuerySchema>;
export type EmailTemplateDeleteQuery = z.infer<typeof emailTemplateDeleteQuerySchema>;
export type UpdateEmailTemplateData = z.infer<typeof updateEmailTemplateSchema>;
