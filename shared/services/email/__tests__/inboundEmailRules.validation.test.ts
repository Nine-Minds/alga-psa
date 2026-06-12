import { describe, expect, it } from 'vitest';
import {
  clientNameAliasInputSchema,
  inboundEmailRuleInputSchema,
} from '../inboundEmailRules/validation';

const VALID_UUID = '6f9619ff-8b86-4d01-b42d-00cf4fc964ff';

function baseRule(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Huntress routing',
    is_active: true,
    provider_ids: null,
    conditions: [{ field: 'from_address', operator: 'contains', value: '@huntress.com' }],
    action_type: 'skip',
    action_config: {},
    on_no_match: 'proceed',
    fallback_inbound_ticket_defaults_id: null,
    ...overrides,
  };
}

describe('inboundEmailRuleInputSchema', () => {
  it('accepts a minimal skip rule', () => {
    expect(inboundEmailRuleInputSchema.safeParse(baseRule()).success).toBe(true);
  });

  it('rejects unknown condition fields and operators', () => {
    expect(
      inboundEmailRuleInputSchema.safeParse(
        baseRule({ conditions: [{ field: 'header_x', operator: 'contains', value: 'x' }] })
      ).success
    ).toBe(false);
    expect(
      inboundEmailRuleInputSchema.safeParse(
        baseRule({ conditions: [{ field: 'subject', operator: 'fuzzy', value: 'x' }] })
      ).success
    ).toBe(false);
  });

  it('rejects an empty condition list', () => {
    expect(inboundEmailRuleInputSchema.safeParse(baseRule({ conditions: [] })).success).toBe(false);
  });

  it('rejects invalid regex condition values', () => {
    expect(
      inboundEmailRuleInputSchema.safeParse(
        baseRule({ conditions: [{ field: 'subject', operator: 'matches_regex', value: '([unclosed' }] })
      ).success
    ).toBe(false);
  });

  it('rejects action_config that does not match the action_type', () => {
    expect(
      inboundEmailRuleInputSchema.safeParse(
        baseRule({ action_type: 'extract_assign_client', action_config: {} })
      ).success
    ).toBe(false);
    expect(
      inboundEmailRuleInputSchema.safeParse(
        baseRule({ action_type: 'set_destination', action_config: { inbound_ticket_defaults_id: 'not-a-uuid' } })
      ).success
    ).toBe(false);
  });

  it('accepts a complete extract_assign_client rule', () => {
    const result = inboundEmailRuleInputSchema.safeParse(
      baseRule({
        action_type: 'extract_assign_client',
        action_config: {
          source: 'subject',
          extraction: { type: 'between', start: '(', end: ')', occurrence: 'first' },
        },
      })
    );
    expect(result.success).toBe(true);
  });

  it('rejects over-length extraction regex patterns', () => {
    expect(
      inboundEmailRuleInputSchema.safeParse(
        baseRule({
          action_type: 'extract_assign_client',
          action_config: {
            source: 'subject',
            extraction: { type: 'regex', pattern: 'a'.repeat(600) },
          },
        })
      ).success
    ).toBe(false);
  });

  it('requires a fallback destination id when on_no_match is fallback_destination', () => {
    expect(
      inboundEmailRuleInputSchema.safeParse(
        baseRule({ on_no_match: 'fallback_destination', fallback_inbound_ticket_defaults_id: null })
      ).success
    ).toBe(false);
    expect(
      inboundEmailRuleInputSchema.safeParse(
        baseRule({ on_no_match: 'fallback_destination', fallback_inbound_ticket_defaults_id: VALID_UUID })
      ).success
    ).toBe(true);
  });

  it('requires at least one allowed outcome for ai_classify', () => {
    expect(
      inboundEmailRuleInputSchema.safeParse(
        baseRule({ action_type: 'ai_classify', action_config: { instruction: 'classify', allowed_outcomes: [] } })
      ).success
    ).toBe(false);
    expect(
      inboundEmailRuleInputSchema.safeParse(
        baseRule({
          action_type: 'ai_classify',
          action_config: { instruction: 'classify', allowed_outcomes: ['skip'] },
        })
      ).success
    ).toBe(true);
  });
});

describe('clientNameAliasInputSchema', () => {
  it('accepts a valid alias', () => {
    expect(
      clientNameAliasInputSchema.safeParse({ client_id: VALID_UUID, alias: 'ACME Corp' }).success
    ).toBe(true);
  });

  it('rejects empty aliases and invalid client ids', () => {
    expect(clientNameAliasInputSchema.safeParse({ client_id: VALID_UUID, alias: '' }).success).toBe(false);
    expect(clientNameAliasInputSchema.safeParse({ client_id: 'nope', alias: 'x' }).success).toBe(false);
  });
});
