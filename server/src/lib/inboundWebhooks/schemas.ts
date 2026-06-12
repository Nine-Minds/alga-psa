import { z } from 'zod';
import { isReservedInboundWebhookIntegrationType } from './reservedIntegrationTypes';

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Slug must use lowercase letters, numbers, and hyphens')
  .refine((slug) => !isReservedInboundWebhookIntegrationType(slug), 'Slug is reserved for a bundled integration');

const hmacAuthConfigSchema = z.object({
  type: z.literal('hmac_sha256'),
  signature_header: z.string().trim().min(1),
  secret: z.string().min(16).optional(),
  secret_vault_path: z.string().trim().min(1).optional(),
});

const bearerAuthConfigSchema = z.object({
  type: z.literal('bearer'),
  token: z.string().min(16).optional(),
  token_vault_path: z.string().trim().min(1).optional(),
});

const ipAllowlistAuthConfigSchema = z.object({
  type: z.literal('ip_allowlist'),
  ip_cidrs: z.array(z.string().trim().min(1)).min(1),
});

const pathTokenAuthConfigSchema = z.object({
  type: z.literal('path_token'),
  query_param: z.string().trim().min(1).default('token'),
  token: z.string().min(16).optional(),
  token_vault_path: z.string().trim().min(1).optional(),
});

export const inboundWebhookAuthConfigSchema = z.discriminatedUnion('type', [
  hmacAuthConfigSchema,
  bearerAuthConfigSchema,
  ipAllowlistAuthConfigSchema,
  pathTokenAuthConfigSchema,
]);

export const inboundWebhookIdempotencySourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('header'),
    value: z.string().trim().min(1),
  }),
  z.object({
    type: z.literal('jsonata'),
    value: z.string().trim().min(1),
  }),
]);

const directActionHandlerConfigSchema = z.object({
  type: z.literal('direct_action'),
  action: z.string().trim().min(1),
  field_mapping: z.record(z.string().trim().min(1)).default({}),
});

const workflowHandlerConfigSchema = z.object({
  type: z.literal('workflow'),
  workflow_id: z.string().uuid(),
});

export const inboundWebhookHandlerConfigSchema = z.discriminatedUnion('type', [
  directActionHandlerConfigSchema,
  workflowHandlerConfigSchema,
]);

const inboundWebhookUpsertInputBaseSchema = z.object({
  inbound_webhook_id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(255),
  slug: slugSchema,
  description: z.string().trim().max(2000).nullable().optional(),
  auth_type: z.enum(['hmac_sha256', 'bearer', 'ip_allowlist', 'path_token']),
  auth_config: inboundWebhookAuthConfigSchema,
  idempotency_source: inboundWebhookIdempotencySourceSchema.nullable().optional(),
  idempotency_window_seconds: z.number().int().positive().max(2_592_000).default(86_400),
  handler_type: z.enum(['direct_action', 'workflow']),
  handler_config: inboundWebhookHandlerConfigSchema,
  is_active: z.boolean().default(true),
  rate_limit_per_minute: z.number().int().positive().max(60_000).default(600),
});

export const inboundWebhookUpsertInputSchema = inboundWebhookUpsertInputBaseSchema.superRefine((input, ctx) => {
    if (input.auth_type !== input.auth_config.type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['auth_config', 'type'],
        message: 'Auth config type must match auth_type',
      });
    }

    if (input.handler_type !== input.handler_config.type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['handler_config', 'type'],
        message: 'Handler config type must match handler_type',
      });
    }
  });

export const inboundWebhookUpdateInputSchema = inboundWebhookUpsertInputBaseSchema
  .extend({
    inbound_webhook_id: z.string().uuid(),
  })
  .partial()
  .required({ inbound_webhook_id: true })
  .superRefine((input, ctx) => {
    if (input.auth_type && input.auth_config && input.auth_type !== input.auth_config.type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['auth_config', 'type'],
        message: 'Auth config type must match auth_type',
      });
    }

    if (input.handler_type && input.handler_config && input.handler_type !== input.handler_config.type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['handler_config', 'type'],
        message: 'Handler config type must match handler_type',
      });
    }
  });

export type InboundWebhookUpsertInput = z.infer<typeof inboundWebhookUpsertInputSchema>;
export type InboundWebhookUpdateInput = z.infer<typeof inboundWebhookUpdateInputSchema>;
