import { z } from 'zod';
import { MAX_REGEX_PATTERN_LENGTH } from './evaluator';

const CONDITION_VALUE_MAX_LENGTH = 2_000;

const regexPatternSchema = z
  .string()
  .min(1)
  .max(MAX_REGEX_PATTERN_LENGTH)
  .superRefine((pattern, ctx) => {
    try {
      // eslint-disable-next-line no-new
      new RegExp(pattern);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid regular expression' });
    }
  });

export const inboundEmailRuleConditionSchema = z
  .object({
    field: z.enum(['from_address', 'from_domain', 'to_address', 'subject', 'body_text']),
    operator: z.enum(['equals', 'contains', 'starts_with', 'ends_with', 'matches_regex']),
    value: z.string().min(1).max(CONDITION_VALUE_MAX_LENGTH),
  })
  .superRefine((condition, ctx) => {
    if (condition.operator === 'matches_regex') {
      const result = regexPatternSchema.safeParse(condition.value);
      if (!result.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['value'],
          message: result.error.issues[0]?.message ?? 'Invalid regular expression',
        });
      }
    }
  });

const occurrenceSchema = z.enum(['first', 'last']).optional();

export const inboundEmailExtractionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('between'),
    start: z.string().min(1).max(200),
    end: z.string().min(1).max(200),
    occurrence: occurrenceSchema,
  }),
  z.object({
    type: z.literal('after'),
    marker: z.string().min(1).max(200),
    occurrence: occurrenceSchema,
  }),
  z.object({
    type: z.literal('before'),
    marker: z.string().min(1).max(200),
    occurrence: occurrenceSchema,
  }),
  z.object({
    type: z.literal('regex'),
    pattern: regexPatternSchema,
  }),
]);

export const extractAssignClientConfigSchema = z.object({
  source: z.enum(['subject', 'body_text']),
  extraction: inboundEmailExtractionSchema,
});

export const setDestinationConfigSchema = z.object({
  inbound_ticket_defaults_id: z.string().uuid(),
});

export const aiClassifyConfigSchema = z.object({
  instruction: z.string().min(1).max(4_000),
  allowed_outcomes: z.array(z.enum(['skip', 'assign_client'])).min(1),
});

const ACTION_CONFIG_SCHEMAS = {
  skip: z.object({ note: z.string().max(500).optional() }).strict(),
  extract_assign_client: extractAssignClientConfigSchema,
  set_destination: setDestinationConfigSchema,
  ai_classify: aiClassifyConfigSchema,
} as const;

export const inboundEmailRuleInputSchema = z
  .object({
    name: z.string().min(1).max(200),
    is_active: z.boolean().default(true),
    provider_ids: z.array(z.string().uuid()).min(1).nullable().default(null),
    conditions: z.array(inboundEmailRuleConditionSchema).min(1).max(20),
    action_type: z.enum(['skip', 'extract_assign_client', 'set_destination', 'ai_classify']),
    action_config: z.record(z.unknown()).default({}),
    on_no_match: z.enum(['proceed', 'fallback_destination', 'skip']).default('proceed'),
    fallback_inbound_ticket_defaults_id: z.string().uuid().nullable().default(null),
  })
  .superRefine((rule, ctx) => {
    const configSchema = ACTION_CONFIG_SCHEMAS[rule.action_type];
    const result = configSchema.safeParse(rule.action_config);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['action_config', ...issue.path],
          message: issue.message,
        });
      }
    }

    if (rule.on_no_match === 'fallback_destination' && !rule.fallback_inbound_ticket_defaults_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fallback_inbound_ticket_defaults_id'],
        message: 'A fallback destination is required when non-match behavior is "fallback_destination"',
      });
    }
  });

export type InboundEmailRuleInput = z.infer<typeof inboundEmailRuleInputSchema>;

export const clientNameAliasInputSchema = z.object({
  client_id: z.string().uuid(),
  alias: z.string().min(1).max(255),
});

export type ClientNameAliasInput = z.infer<typeof clientNameAliasInputSchema>;

/** Sample email accepted by the rule tester action. */
export const inboundEmailRuleTestSampleSchema = z.object({
  from: z.string().max(320).default(''),
  to: z.string().max(320).optional().default(''),
  subject: z.string().max(1_000).default(''),
  bodyText: z.string().max(100_000).optional().default(''),
});

export type InboundEmailRuleTestSample = z.infer<typeof inboundEmailRuleTestSampleSchema>;
