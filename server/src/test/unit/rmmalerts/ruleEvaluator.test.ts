import { describe, it, expect } from 'vitest';
import { evaluateAlertRules, normalizeRmmAlertConditions, rmmAlertRuleConditionsSchema } from '@alga-psa/shared/rmm/alerts';
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

  it('round-trips a legacy regex through editing and still evaluates it as a root condition', () => {
    const loaded = rmmAlertRuleConditionsSchema.parse({ messagePattern: 'Sentinel.*' });
    const edited = { ...loaded, clauses: [...loaded.clauses, { path: 'severity', operator: 'equals' as const, value: 'major' }] };
    const saved = JSON.stringify(edited);
    const reloaded = normalizeRmmAlertConditions(saved);
    expect(reloaded.legacyMessagePattern).toBe('Sentinel.*');
    const existing = rule(reloaded);
    expect(evaluateAlertRules([existing], event({ message: 'Sentinel service stopped' })).rule).toBe(existing);
    expect(evaluateAlertRules([existing], event({ message: 'Disk service stopped' })).rule).toBeNull();
    expect(rmmAlertRuleConditionsSchema.parse(reloaded)).toEqual(reloaded);
  });

  it('keeps regex outside arbitrary OR group semantics', () => {
    const edited = rmmAlertRuleConditionsSchema.parse({
      messagePattern: 'Sentinel.*',
      alertClasses: ['OTHER'],
      keywords: ['disk'],
    });
    const existing = rule(edited);
    expect(evaluateAlertRules([existing], event({ alertClass: 'OTHER', message: 'Sentinel service stopped' })).rule).toBeNull();
    expect(evaluateAlertRules([existing], event({ alertClass: 'OTHER', message: 'Disk Sentinel service stopped' })).rule).toBe(existing);
  });

  it('matches text supplied only in details with the real Level event shape', () => {
    const level = event({
      provider: 'levelio', alertClass: 'Critical Service Crashed', deviceName: 'GLICK-PC7',
      message: 'Critical Service Crashed: Event ID 7031 occured 5 times within 1 hour',
      details: 'The Sentinel Agent service terminated unexpectedly. It has done this 532 time(s)',
    });
    const sentinel = rule({ join: 'and', clauses: [
      { path: 'alertClass', operator: 'equals', value: 'Critical Service Crashed' },
      { path: 'text', operator: 'contains_ci', value: 'Sentinel Agent service terminated' },
      { path: 'deviceName', operator: 'equals', value: 'GLICK-PC7' },
    ] });
    expect(evaluateAlertRules([sentinel], level).rule).toBe(sentinel);
    expect(evaluateAlertRules([sentinel], { ...level, details: null }).rule).toBeNull();
  });

  it('lets an exclusion veto its rule and falls through to the catch-all', () => {
    const excluded = rule({ join: 'and', clauses: [
      { path: 'alertClass', operator: 'equals', value: 'Critical Service Crashed' },
      { path: 'text', operator: 'not_contains_ci', value: 'Sentinel Agent' },
    ] });
    const catchAll = rule({ join: 'and', clauses: [] });
    const result = evaluateAlertRules([excluded, catchAll], event({ details: 'Sentinel Agent service terminated' }));
    expect(result.rule).toBe(catchAll);
    expect(catchAll.actions.createTicket).toBe(true);
  });

  it('scopes rules by device name and external device ID', () => {
    const scoped = rule({ join: 'and', clauses: [
      { path: 'deviceName', operator: 'equals', value: 'GLICK-PC7' },
      { path: 'externalDeviceId', operator: 'equals', value: 'device-7' },
    ] });
    expect(evaluateAlertRules([scoped], event({ deviceName: 'GLICK-PC7', externalDeviceId: 'device-7' })).rule).toBe(scoped);
    expect(evaluateAlertRules([scoped], event({ deviceName: 'OTHER-PC', externalDeviceId: 'device-7' })).rule).toBeNull();
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
