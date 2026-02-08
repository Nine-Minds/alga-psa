import { describe, expect, it } from 'vitest';
import type { BaseEmailParams } from '@alga-psa/email/BaseEmailService';

describe('BaseEmailParams type surface', () => {
  it('accepts entityType', () => {
    const params: BaseEmailParams = {
      to: 'to@example.com',
      entityType: 'ticket',
    };
    expect(params.entityType).toBe('ticket');
  });

  it('accepts entityId', () => {
    const params: BaseEmailParams = {
      to: 'to@example.com',
      entityId: '00000000-0000-0000-0000-000000000000',
    };
    expect(params.entityId).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('accepts contactId', () => {
    const params: BaseEmailParams = {
      to: 'to@example.com',
      contactId: '00000000-0000-0000-0000-000000000000',
    };
    expect(params.contactId).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('accepts notificationSubtypeId', () => {
    const params: BaseEmailParams = {
      to: 'to@example.com',
      notificationSubtypeId: 123,
    };
    expect(params.notificationSubtypeId).toBe(123);
  });
});

