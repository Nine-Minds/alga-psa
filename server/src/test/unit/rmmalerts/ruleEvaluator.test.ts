import { describe, it, expect } from 'vitest';
import { evaluateAlertRules } from '@alga-psa/shared/rmm/alerts';
import type { NormalizedRmmAlertEvent, RmmAlertRuleRow } from '@alga-psa/shared/rmm/alerts';

const TENANT = '00000000-0000-0000-0000-000000000001';
const INTEGRATION = '00000000-0000-0000-0000-000000000002';

function event(overrides: Partial<NormalizedRmmAlertEvent> = {}): NormalizedRmmAlertEvent {
  return {
    tenantId: TENANT,
    integrationId: INTEGRATION,
    provider: 'ninjaone',
    kind: 'triggered',
    externalAlertId: 'a-1',
    externalDeviceId: 'dev-1',
    conditionIdentity: 'DISK_SPACE',
    activityType: 'CONDITION',
    alertClass: 'DISK_SPACE',
    sourceType: 'condition',
    severity: 'major',
    message: 'Disk C: is at 95% capacity',
    deviceName: 'SERVER-01',
    externalOrganizationId: 'org-9',
    occurredAt: '2026-06-12T10:00:00.000Z',
    raw: {},
    ...overrides,
  };
}

let ruleCounter = 0;
function rule(
  conditions: RmmAlertRuleRow['conditions'],
  overrides: Partial<RmmAlertRuleRow> = {}
): RmmAlertRuleRow {
  ruleCounter += 1;
  return {
    tenant: TENANT,
    rule_id: `00000000-0000-0000-0000-0000000000${String(10 + ruleCounter)}`,
    integration_id: INTEGRATION,
    name: `rule-${ruleCounter}`,
    is_active: true,
    priority_order: ruleCounter,
    conditions,
    actions: { createTicket: true, autoResolveTicket: false, resetAlertOnTicketClose: true },
    ...overrides,
  };
}

describe('evaluateAlertRules condition matrix', () => {
  it('matches and mismatches severities', () => {
    expect(evaluateAlertRules([rule({ severities: ['major', 'critical'] })], event()).rule).not.toBeNull();
    expect(evaluateAlertRules([rule({ severities: ['minor'] })], event()).rule).toBeNull();
  });

  it('matches and mismatches activityTypes', () => {
    expect(evaluateAlertRules([rule({ activityTypes: ['CONDITION'] })], event()).rule).not.toBeNull();
    expect(evaluateAlertRules([rule({ activityTypes: ['OTHER'] })], event()).rule).toBeNull();
  });

  it('matches and mismatches alertClasses and sourceTypes', () => {
    expect(evaluateAlertRules([rule({ alertClasses: ['DISK_SPACE'] })], event()).rule).not.toBeNull();
    expect(evaluateAlertRules([rule({ alertClasses: ['CPU'] })], event()).rule).toBeNull();
    expect(evaluateAlertRules([rule({ sourceTypes: ['condition'] })], event()).rule).not.toBeNull();
    expect(evaluateAlertRules([rule({ sourceTypes: ['script'] })], event()).rule).toBeNull();
  });

  it('matches and mismatches organizationIds', () => {
    expect(evaluateAlertRules([rule({ organizationIds: ['org-9'] })], event()).rule).not.toBeNull();
    expect(evaluateAlertRules([rule({ organizationIds: ['org-1'] })], event()).rule).toBeNull();
    // Alert without an org never matches an org-filtered rule.
    expect(
      evaluateAlertRules([rule({ organizationIds: ['org-9'] })], event({ externalOrganizationId: null })).rule
    ).toBeNull();
  });

  it('keywords do case-insensitive substring matching on the message', () => {
    expect(evaluateAlertRules([rule({ keywords: ['disk c:'] })], event()).rule).not.toBeNull();
    expect(evaluateAlertRules([rule({ keywords: ['memory'] })], event()).rule).toBeNull();
  });

  it('messagePattern matches as a regex', () => {
    expect(evaluateAlertRules([rule({ messagePattern: 'at 9[0-9]% capacity' })], event()).rule).not.toBeNull();
    expect(evaluateAlertRules([rule({ messagePattern: '^Memory' })], event()).rule).toBeNull();
  });

  it('requires every present condition field to match', () => {
    const both = rule({ severities: ['major'], keywords: ['memory'] });
    expect(evaluateAlertRules([both], event()).rule).toBeNull();
    const aligned = rule({ severities: ['major'], keywords: ['disk'] });
    expect(evaluateAlertRules([aligned], event()).rule).not.toBeNull();
  });

  it('treats an empty conditions object as a catch-all', () => {
    expect(evaluateAlertRules([rule({})], event()).rule).not.toBeNull();
  });
});

describe('evaluateAlertRules selection', () => {
  it('first match by the provided order wins', () => {
    const first = rule({ severities: ['major'] });
    const second = rule({});
    const result = evaluateAlertRules([first, second], event());
    expect(result.rule?.rule_id).toBe(first.rule_id);
  });

  it('an invalid stored regex is skipped with a warning and the next rule evaluates', () => {
    const bad = rule({ messagePattern: '([invalid' });
    const fallback = rule({});
    const result = evaluateAlertRules([bad, fallback], event());
    expect(result.rule?.rule_id).toBe(fallback.rule_id);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(bad.rule_id);
  });

  it('parses string-encoded conditions (raw JSONB from some drivers)', () => {
    const stringRule = rule({} as never);
    (stringRule as { conditions: unknown }).conditions = JSON.stringify({ severities: ['major'] });
    expect(evaluateAlertRules([stringRule], event()).rule).not.toBeNull();
  });
});
