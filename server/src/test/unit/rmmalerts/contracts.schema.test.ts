import { describe, it, expect } from 'vitest';
import {
  rmmAlertRuleConditionsSchema,
  rmmAlertRuleActionsSchema,
  rmmMaintenanceWindowRecurrenceSchema,
} from '@alga-psa/shared/rmm/alerts';

describe('rule conditions schema', () => {
  it('accepts a full valid shape', () => {
    const parsed = rmmAlertRuleConditionsSchema.safeParse({
      severities: ['critical', 'major'],
      activityTypes: ['CONDITION'],
      alertClasses: ['DISK_SPACE'],
      sourceTypes: ['condition'],
      organizationIds: ['42'],
      messagePattern: 'disk.*full',
      keywords: ['disk'],
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts an empty object (catch-all)', () => {
    expect(rmmAlertRuleConditionsSchema.safeParse({}).success).toBe(true);
  });

  it('migrates legacy lists and keywords into a validated predicate group', () => {
    const result = rmmAlertRuleConditionsSchema.parse({ severities: ['critical'], keywords: ['Sentinel Agent'] });
    expect(result).toEqual({ join: 'and', clauses: [
      { path: 'severity', operator: 'in', value: ['critical'] },
      { join: 'or', clauses: [{ path: 'text', operator: 'contains_ci', value: 'Sentinel Agent' }] },
    ] });
  });

  it('persists and reloads legacy regex as an isolated sidecar', async () => {
    const { normalizeRmmAlertConditions } = await import('@alga-psa/shared/rmm/alerts');
    const original = rmmAlertRuleConditionsSchema.parse({ messagePattern: 'Sentinel.*' });
    const stored = JSON.stringify(original);
    const reloaded = normalizeRmmAlertConditions(stored);
    expect(reloaded).toEqual(original);
    expect(rmmAlertRuleConditionsSchema.parse(reloaded)).toEqual(original);
  });

  it('normalizes string-encoded conditions returned by JSONB drivers', () => {
    const parsed = rmmAlertRuleConditionsSchema.parse(JSON.stringify({ keywords: ['Sentinel'] }));
    expect(parsed.clauses).toMatchObject([{ join: 'or', clauses: [{ operator: 'contains_ci', value: 'Sentinel' }] }]);
  });

  it('rejects a predicate with an unknown field or field-incompatible operator', () => {
    expect(rmmAlertRuleConditionsSchema.safeParse({ join: 'and', clauses: [{ path: 'assetId', operator: 'equals', value: 'x' }] }).success).toBe(false);
    expect(rmmAlertRuleConditionsSchema.safeParse({ join: 'and', clauses: [{ path: 'severity', operator: 'contains_ci', value: 'critical' }] }).success).toBe(false);
  });

  it.each([
    undefined, null, false, 0, [],
    { join: 'invalid', clauses: [] },
    { join: 'and', clauses: null },
    { join: 'and', clauses: {} },
    { join: 'and', clauses: [null] },
    { join: 'and', clauses: [{ join: 'invalid', clauses: [] }] },
    { join: 'and', clauses: [{ join: 'or', clauses: null }] },
    { join: 'and', clauses: [{ path: 'text', operator: 'contains_ci' }] },
    { join: 'and', clauses: [], extra: true },
    { join: 'and', clauses: [], legacyMessagePattern: 'Sentinel.*', extra: true },
    { join: 'and', clauses: [{ path: 'text', operator: 'contains_ci', value: 'Sentinel', extra: true }] },
    { join: 'and', clauses: [{ join: 'or', clauses: [], extra: true }] },
  ])('rejects malformed predicate input without throwing: %j', (input) => {
    expect(rmmAlertRuleConditionsSchema.safeParse(input).success).toBe(false);
    expect(rmmAlertRuleConditionsSchema.safeParse(JSON.stringify(input)).success).toBe(false);
  });

  it('rejects unknown stored keys during normalization rather than silently discarding them', async () => {
    const { normalizeRmmAlertConditions } = await import('@alga-psa/shared/rmm/alerts');
    expect(() => normalizeRmmAlertConditions({
      join: 'and', clauses: [], legacyMessagePattern: 'Sentinel.*', extra: true,
    })).toThrow('Invalid stored RMM alert conditions');
  });

  it('rejects an invalid regex in messagePattern', () => {
    const parsed = rmmAlertRuleConditionsSchema.safeParse({ messagePattern: '([invalid' });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]).toEqual(expect.objectContaining({
      params: {
        messageKey: 'msp/integrations:errors.rmm.validation.messagePatternInvalid',
      },
    }));
  });

  it('rejects unknown severities and unknown keys', () => {
    expect(rmmAlertRuleConditionsSchema.safeParse({ severities: ['fatal'] }).success).toBe(false);
    expect(rmmAlertRuleConditionsSchema.safeParse({ nonsense: true }).success).toBe(false);
  });
});

describe('rule actions schema', () => {
  it('applies defaults', () => {
    const parsed = rmmAlertRuleActionsSchema.parse({});
    expect(parsed.createTicket).toBe(true);
    expect(parsed.autoResolveTicket).toBe(false);
    expect(parsed.resetAlertOnTicketClose).toBe(true);
  });

  it('rejects non-uuid ids and unknown keys', () => {
    expect(rmmAlertRuleActionsSchema.safeParse({ boardId: 'not-a-uuid' }).success).toBe(false);
    expect(rmmAlertRuleActionsSchema.safeParse({ surprise: 1 }).success).toBe(false);
  });

  it('accepts a full valid shape', () => {
    const parsed = rmmAlertRuleActionsSchema.safeParse({
      createTicket: true,
      boardId: '00000000-0000-0000-0000-000000000001',
      priorityOverride: '00000000-0000-0000-0000-000000000002',
      assignToUserId: '00000000-0000-0000-0000-000000000003',
      ticketTemplate: { titleTemplate: '{{device}} down', descriptionTemplate: '{{message}}' },
      autoResolveTicket: true,
      autoResolveStatusId: '00000000-0000-0000-0000-000000000004',
      resetAlertOnTicketClose: false,
      notifyUserIds: ['00000000-0000-0000-0000-000000000005'],
    });
    expect(parsed.success).toBe(true);
  });
});

describe('maintenance window recurrence schema', () => {
  it('accepts a valid weekly recurrence', () => {
    const parsed = rmmMaintenanceWindowRecurrenceSchema.safeParse({
      type: 'weekly',
      days: [0, 6],
      startTime: '22:00',
      endTime: '02:00',
      timezone: 'America/New_York',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects bad times, identical start/end, bad days, unknown timezone', () => {
    const base = { type: 'weekly', days: [1], startTime: '10:00', endTime: '11:00', timezone: 'UTC' };
    expect(rmmMaintenanceWindowRecurrenceSchema.safeParse({ ...base, startTime: '25:00' }).success).toBe(false);
    expect(rmmMaintenanceWindowRecurrenceSchema.safeParse({ ...base, endTime: '10:00' }).success).toBe(false);
    expect(rmmMaintenanceWindowRecurrenceSchema.safeParse({ ...base, days: [7] }).success).toBe(false);
    const unknownTimezone = rmmMaintenanceWindowRecurrenceSchema.safeParse({ ...base, timezone: 'Not/AZone' });
    expect(unknownTimezone.success).toBe(false);
    expect(unknownTimezone.error?.issues[0]).toEqual(expect.objectContaining({
      params: {
        messageKey: 'msp/integrations:errors.rmm.validation.unknownTimezone',
        messageParams: { timezone: 'Not/AZone' },
      },
    }));
  });
});
