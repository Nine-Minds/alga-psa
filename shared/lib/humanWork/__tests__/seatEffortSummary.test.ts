import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ admitted: false, tableCalls: 0 }));
vi.mock('@alga-psa/core/capability', () => ({ admits: async () => ({ admitted: h.admitted }) }));
vi.mock('@alga-psa/db', () => ({ tenantDb: () => ({ table: () => { h.tableCalls += 1; throw new Error('no statement expected'); } }) }));

import { SEAT_MSP_EFFORT_VISIBLE_SETTING, mspEffortVisibleToTechnicians, resolveSeatEffortSummary } from '../seatEffortSummary';

describe('MSP effort visibility setting', () => {
  it('is off unless the setting is exactly boolean true', () => {
    expect(SEAT_MSP_EFFORT_VISIBLE_SETTING).toBe('mspEffortVisibleToTechnicians');
    for (const settings of [undefined, null, {}, [], 'true', 1, { [SEAT_MSP_EFFORT_VISIBLE_SETTING]: false }, { [SEAT_MSP_EFFORT_VISIBLE_SETTING]: 'true' }, { [SEAT_MSP_EFFORT_VISIBLE_SETTING]: 1 }]) {
      expect(mspEffortVisibleToTechnicians(settings)).toBe(false);
    }
    expect(mspEffortVisibleToTechnicians({ [SEAT_MSP_EFFORT_VISIBLE_SETTING]: true })).toBe(true);
  });
});

describe('seat effort summary neutrality', () => {
  const input = (seatTicket: any) => ({ seatTicket, userId: 'u', ticketId: 't', clientId: 'c' });

  it('costs no statement without a seat context or an arrangement', async () => {
    h.admitted = true;
    expect(await resolveSeatEffortSummary({} as any, 'tenant', input(null))).toBeNull();
    expect(await resolveSeatEffortSummary({} as any, 'tenant', input({ viewer: 'msp', arrangement: false, clientTechnicians: [] }))).toBeNull();
    expect(h.tableCalls).toBe(0);
  });

  it('is null, at no statement, while the co-managed-seat capability does not admit the tenant (release flag off)', async () => {
    h.admitted = false;
    expect(await resolveSeatEffortSummary({} as any, 'tenant', input({ viewer: 'client_it', arrangement: true, clientTechnicians: ['u'] }))).toBeNull();
    expect(await resolveSeatEffortSummary({} as any, 'tenant', input({ viewer: 'msp', arrangement: true, clientTechnicians: ['u'] }))).toBeNull();
    expect(h.tableCalls).toBe(0);
  });
});
