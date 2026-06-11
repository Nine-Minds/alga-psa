import { describe, expect, it, vi } from 'vitest';
import { evaluateInboundEmailRules } from '../inboundEmailRules/engine';
import type {
  InboundEmailRule,
  InboundEmailRuleEngineDeps,
} from '../inboundEmailRules';

const TENANT = 'tenant-1';
const PROVIDER = 'provider-1';

function makeEmailData(overrides: Record<string, unknown> = {}) {
  return {
    id: 'email-1',
    from: { email: 'alerts@huntress.com' },
    to: [{ email: 'support@msp.com' }],
    subject: 'Critical Alert (Acme Corp) - EDR detection',
    body: { text: 'Incident details follow.' },
    ...overrides,
  };
}

function makeRule(overrides: Partial<InboundEmailRule> = {}): InboundEmailRule {
  return {
    tenant: TENANT,
    id: 'rule-1',
    name: 'Test rule',
    is_active: true,
    position: 1,
    provider_ids: null,
    conditions: [{ field: 'from_address', operator: 'contains', value: '@huntress.com' }],
    action_type: 'skip',
    action_config: {},
    on_no_match: 'proceed',
    fallback_inbound_ticket_defaults_id: null,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<InboundEmailRuleEngineDeps> = {}): InboundEmailRuleEngineDeps {
  return {
    loadRules: vi.fn(async () => []),
    matchClientByName: vi.fn(async () => null),
    resolveDefaultsById: vi.fn(async () => null),
    classifyWithAi: vi.fn(async () => ({ decision: 'no_decision' as const })),
    ...overrides,
  };
}

describe('inboundEmailRules engine: rule selection', () => {
  it('returns none when the tenant has no rules', async () => {
    const result = await evaluateInboundEmailRules({
      tenantId: TENANT,
      providerId: PROVIDER,
      emailData: makeEmailData(),
      deps: makeDeps(),
    });
    expect(result.outcome).toEqual({ kind: 'none' });
  });

  it('applies rules with provider_ids = null to all providers', async () => {
    const deps = makeDeps({ loadRules: vi.fn(async () => [makeRule({ provider_ids: null })]) });
    const result = await evaluateInboundEmailRules({
      tenantId: TENANT,
      providerId: PROVIDER,
      emailData: makeEmailData(),
      deps,
    });
    expect(result.outcome.kind).toBe('skip');
  });

  it('skips rules scoped to a different provider', async () => {
    const deps = makeDeps({
      loadRules: vi.fn(async () => [makeRule({ provider_ids: ['other-provider'] })]),
    });
    const result = await evaluateInboundEmailRules({
      tenantId: TENANT,
      providerId: PROVIDER,
      emailData: makeEmailData(),
      deps,
    });
    expect(result.outcome).toEqual({ kind: 'none' });
    expect(result.trace[0].resolution).toBe('provider_filtered');
  });

  it('executes rules scoped to the receiving provider', async () => {
    const deps = makeDeps({
      loadRules: vi.fn(async () => [makeRule({ provider_ids: ['other-provider', PROVIDER] })]),
    });
    const result = await evaluateInboundEmailRules({
      tenantId: TENANT,
      providerId: PROVIDER,
      emailData: makeEmailData(),
      deps,
    });
    expect(result.outcome.kind).toBe('skip');
  });

  it('first matching rule wins; later matching rules are not executed', async () => {
    const deps = makeDeps({
      loadRules: vi.fn(async () => [
        makeRule({ id: 'rule-1', name: 'First' }),
        makeRule({ id: 'rule-2', name: 'Second' }),
      ]),
    });
    const result = await evaluateInboundEmailRules({
      tenantId: TENANT,
      providerId: PROVIDER,
      emailData: makeEmailData(),
      deps,
    });
    expect(result.outcome).toMatchObject({ kind: 'skip', ruleId: 'rule-1' });
    expect(result.trace).toHaveLength(1);
  });

  it('rules whose conditions do not match are passed over', async () => {
    const deps = makeDeps({
      loadRules: vi.fn(async () => [
        makeRule({
          id: 'rule-1',
          conditions: [{ field: 'subject', operator: 'contains', value: 'no-such-text' }],
        }),
        makeRule({ id: 'rule-2' }),
      ]),
    });
    const result = await evaluateInboundEmailRules({
      tenantId: TENANT,
      providerId: PROVIDER,
      emailData: makeEmailData(),
      deps,
    });
    expect(result.outcome).toMatchObject({ kind: 'skip', ruleId: 'rule-2' });
    expect(result.trace[0].resolution).toBe('conditions_not_matched');
  });
});

describe('inboundEmailRules engine: extract_assign_client', () => {
  const extractRule = makeRule({
    id: 'extract-rule',
    action_type: 'extract_assign_client',
    action_config: {
      source: 'subject',
      extraction: { type: 'between', start: '(', end: ')' },
    },
  });

  it('assigns the client when extraction and matching succeed', async () => {
    const matchClientByName = vi.fn(async () => ({ clientId: 'client-acme', matchedBy: 'client_name' as const }));
    const deps = makeDeps({
      loadRules: vi.fn(async () => [extractRule]),
      matchClientByName,
    });

    const result = await evaluateInboundEmailRules({
      tenantId: TENANT,
      providerId: PROVIDER,
      emailData: makeEmailData(),
      deps,
    });

    expect(matchClientByName).toHaveBeenCalledWith(TENANT, 'acme corp');
    expect(result.outcome).toMatchObject({
      kind: 'assign_client',
      clientId: 'client-acme',
      extractedValue: 'acme corp',
      matchSource: 'rule_extraction',
    });
  });

  it('on_no_match=proceed continues to later rules when no client matches', async () => {
    const deps = makeDeps({
      loadRules: vi.fn(async () => [
        { ...extractRule, on_no_match: 'proceed' as const },
        makeRule({ id: 'catch-all', name: 'Catch-all skip' }),
      ]),
      matchClientByName: vi.fn(async () => null),
    });

    const result = await evaluateInboundEmailRules({
      tenantId: TENANT,
      providerId: PROVIDER,
      emailData: makeEmailData(),
      deps,
    });

    expect(result.trace[0].resolution).toBe('no_match_proceed');
    expect(result.outcome).toMatchObject({ kind: 'skip', ruleId: 'catch-all' });
  });

  it('on_no_match=proceed with no later match returns none', async () => {
    const deps = makeDeps({
      loadRules: vi.fn(async () => [extractRule]),
      matchClientByName: vi.fn(async () => null),
    });
    const result = await evaluateInboundEmailRules({
      tenantId: TENANT,
      providerId: PROVIDER,
      emailData: makeEmailData(),
      deps,
    });
    expect(result.outcome).toEqual({ kind: 'none' });
  });

  it('on_no_match=skip stops and skips the email', async () => {
    const deps = makeDeps({
      loadRules: vi.fn(async () => [{ ...extractRule, on_no_match: 'skip' as const }]),
      matchClientByName: vi.fn(async () => null),
    });
    const result = await evaluateInboundEmailRules({
      tenantId: TENANT,
      providerId: PROVIDER,
      emailData: makeEmailData(),
      deps,
    });
    expect(result.outcome).toMatchObject({ kind: 'skip', via: 'on_no_match' });
  });

  it('on_no_match=fallback_destination resolves the fallback defaults set', async () => {
    const fallbackDefaults = { board_id: 'triage-board', status_id: 's', priority_id: 'p' };
    const resolveDefaultsById = vi.fn(async () => fallbackDefaults);
    const deps = makeDeps({
      loadRules: vi.fn(async () => [
        {
          ...extractRule,
          on_no_match: 'fallback_destination' as const,
          fallback_inbound_ticket_defaults_id: 'defaults-triage',
        },
      ]),
      matchClientByName: vi.fn(async () => null),
      resolveDefaultsById,
    });

    const result = await evaluateInboundEmailRules({
      tenantId: TENANT,
      providerId: PROVIDER,
      emailData: makeEmailData(),
      deps,
    });

    expect(resolveDefaultsById).toHaveBeenCalledWith(TENANT, 'defaults-triage');
    expect(result.outcome).toMatchObject({ kind: 'fallback_destination', defaults: fallbackDefaults });
  });

  it('a dangling fallback destination degrades to proceed', async () => {
    const deps = makeDeps({
      loadRules: vi.fn(async () => [
        {
          ...extractRule,
          on_no_match: 'fallback_destination' as const,
          fallback_inbound_ticket_defaults_id: 'deleted-defaults',
        },
      ]),
      matchClientByName: vi.fn(async () => null),
      resolveDefaultsById: vi.fn(async () => null),
    });

    const result = await evaluateInboundEmailRules({
      tenantId: TENANT,
      providerId: PROVIDER,
      emailData: makeEmailData(),
      deps,
    });

    expect(result.outcome).toEqual({ kind: 'none' });
    expect(result.trace[0].resolution).toBe('dangling_reference');
  });

  it('malformed action_config degrades to proceed', async () => {
    const deps = makeDeps({
      loadRules: vi.fn(async () => [
        makeRule({ id: 'bad', action_type: 'extract_assign_client', action_config: {} }),
      ]),
    });
    const result = await evaluateInboundEmailRules({
      tenantId: TENANT,
      providerId: PROVIDER,
      emailData: makeEmailData(),
      deps,
    });
    expect(result.outcome).toEqual({ kind: 'none' });
    expect(result.trace[0].resolution).toBe('dangling_reference');
  });
});

describe('inboundEmailRules engine: set_destination', () => {
  it('returns the referenced defaults set', async () => {
    const defaults = { board_id: 'security-board' };
    const deps = makeDeps({
      loadRules: vi.fn(async () => [
        makeRule({
          action_type: 'set_destination',
          action_config: { inbound_ticket_defaults_id: 'defaults-security' },
        }),
      ]),
      resolveDefaultsById: vi.fn(async () => defaults),
    });
    const result = await evaluateInboundEmailRules({
      tenantId: TENANT,
      providerId: PROVIDER,
      emailData: makeEmailData(),
      deps,
    });
    expect(result.outcome).toMatchObject({ kind: 'set_destination', defaults });
  });

  it('a dangling destination reference degrades to proceed', async () => {
    const deps = makeDeps({
      loadRules: vi.fn(async () => [
        makeRule({
          action_type: 'set_destination',
          action_config: { inbound_ticket_defaults_id: 'deleted' },
        }),
      ]),
      resolveDefaultsById: vi.fn(async () => null),
    });
    const result = await evaluateInboundEmailRules({
      tenantId: TENANT,
      providerId: PROVIDER,
      emailData: makeEmailData(),
      deps,
    });
    expect(result.outcome).toEqual({ kind: 'none' });
    expect(result.trace[0].resolution).toBe('dangling_reference');
  });
});

describe('inboundEmailRules engine: ai_classify', () => {
  const aiRule = makeRule({
    id: 'ai-rule',
    action_type: 'ai_classify',
    action_config: {
      instruction: 'Determine which customer this alert concerns.',
      allowed_outcomes: ['skip', 'assign_client'],
    },
  });

  it('honors a skip decision when allowed', async () => {
    const deps = makeDeps({
      loadRules: vi.fn(async () => [aiRule]),
      classifyWithAi: vi.fn(async () => ({ decision: 'skip' as const })),
    });
    const result = await evaluateInboundEmailRules({
      tenantId: TENANT,
      providerId: PROVIDER,
      emailData: makeEmailData(),
      deps,
    });
    expect(result.outcome).toMatchObject({ kind: 'skip', ruleId: 'ai-rule', via: 'action' });
  });

  it('treats a decision outside allowed_outcomes as no_decision', async () => {
    const deps = makeDeps({
      loadRules: vi.fn(async () => [
        { ...aiRule, action_config: { instruction: 'x', allowed_outcomes: ['assign_client'] } },
      ]),
      classifyWithAi: vi.fn(async () => ({ decision: 'skip' as const })),
    });
    const result = await evaluateInboundEmailRules({
      tenantId: TENANT,
      providerId: PROVIDER,
      emailData: makeEmailData(),
      deps,
    });
    expect(result.outcome).toEqual({ kind: 'none' });
    expect(result.trace[0].aiDecision).toBe('no_decision');
  });

  it('resolves assign_client decisions through the deterministic matcher', async () => {
    const matchClientByName = vi.fn(async () => ({ clientId: 'client-acme', matchedBy: 'alias' as const }));
    const deps = makeDeps({
      loadRules: vi.fn(async () => [aiRule]),
      classifyWithAi: vi.fn(async () => ({
        decision: 'assign_client' as const,
        extractedClientName: '  Acme   Corp ',
      })),
      matchClientByName,
    });
    const result = await evaluateInboundEmailRules({
      tenantId: TENANT,
      providerId: PROVIDER,
      emailData: makeEmailData(),
      deps,
    });
    expect(matchClientByName).toHaveBeenCalledWith(TENANT, 'acme corp');
    expect(result.outcome).toMatchObject({
      kind: 'assign_client',
      clientId: 'client-acme',
      matchSource: 'rule_ai',
    });
  });

  it('routes an unmatched AI client name to on_no_match', async () => {
    const deps = makeDeps({
      loadRules: vi.fn(async () => [{ ...aiRule, on_no_match: 'skip' as const }]),
      classifyWithAi: vi.fn(async () => ({
        decision: 'assign_client' as const,
        extractedClientName: 'Unknown Co',
      })),
      matchClientByName: vi.fn(async () => null),
    });
    const result = await evaluateInboundEmailRules({
      tenantId: TENANT,
      providerId: PROVIDER,
      emailData: makeEmailData(),
      deps,
    });
    expect(result.outcome).toMatchObject({ kind: 'skip', via: 'on_no_match' });
  });

  it('treats AI errors as non-match without blocking', async () => {
    const deps = makeDeps({
      loadRules: vi.fn(async () => [aiRule]),
      classifyWithAi: vi.fn(async () => {
        throw new Error('ai timeout');
      }),
    });
    const result = await evaluateInboundEmailRules({
      tenantId: TENANT,
      providerId: PROVIDER,
      emailData: makeEmailData(),
      deps,
    });
    expect(result.outcome).toEqual({ kind: 'none' });
    expect(result.trace[0].resolution).toBe('no_match_proceed');
  });

  it('treats a no_decision result as non-match (OSS stub behavior)', async () => {
    const deps = makeDeps({
      loadRules: vi.fn(async () => [aiRule]),
      classifyWithAi: vi.fn(async () => ({ decision: 'no_decision' as const })),
    });
    const result = await evaluateInboundEmailRules({
      tenantId: TENANT,
      providerId: PROVIDER,
      emailData: makeEmailData(),
      deps,
    });
    expect(result.outcome).toEqual({ kind: 'none' });
  });
});

describe('inboundEmailRules engine: error isolation', () => {
  it('degrades to none when rule loading fails', async () => {
    const deps = makeDeps({
      loadRules: vi.fn(async () => {
        throw new Error('db unavailable');
      }),
    });
    const result = await evaluateInboundEmailRules({
      tenantId: TENANT,
      providerId: PROVIDER,
      emailData: makeEmailData(),
      deps,
    });
    expect(result.outcome).toEqual({ kind: 'none' });
    expect(result.trace.at(-1)?.resolution).toBe('error');
  });

  it('degrades to none when the matcher throws mid-walk', async () => {
    const deps = makeDeps({
      loadRules: vi.fn(async () => [
        makeRule({
          action_type: 'extract_assign_client',
          action_config: { source: 'subject', extraction: { type: 'between', start: '(', end: ')' } },
        }),
      ]),
      matchClientByName: vi.fn(async () => {
        throw new Error('query failed');
      }),
    });
    const result = await evaluateInboundEmailRules({
      tenantId: TENANT,
      providerId: PROVIDER,
      emailData: makeEmailData(),
      deps,
    });
    expect(result.outcome).toEqual({ kind: 'none' });
  });
});
