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

  it('rejects an invalid regex in messagePattern', () => {
    const parsed = rmmAlertRuleConditionsSchema.safeParse({ messagePattern: '([invalid' });
    expect(parsed.success).toBe(false);
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
    expect(rmmMaintenanceWindowRecurrenceSchema.safeParse({ ...base, timezone: 'Not/AZone' }).success).toBe(false);
  });
});
