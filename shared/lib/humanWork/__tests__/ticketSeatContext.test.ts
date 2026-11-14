import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  served: vi.fn(),
  arrangement: vi.fn(),
  technicians: vi.fn(),
}));

vi.mock('@alga-psa/core/capability', () => ({ isCapabilityServed: mocks.served }));
vi.mock('@alga-psa/db', () => ({ tenantDb: (_db: unknown, tenant: string) => ({ tenant }), liveSeatArrangement: mocks.arrangement }));
vi.mock('../seatAssigneeAudience', () => ({ seatTechniciansOfClient: mocks.technicians }));

import { resolveTicketSeatContext, restrictToThisClientsSeatTechnicians } from '../ticketSeatContext';

const staff = { user_id: 'staff-1', user_type: 'internal', seat_reader: false };

describe('resolveTicketSeatContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.served.mockResolvedValue(true);
    mocks.arrangement.mockResolvedValue({ arrangement_id: 'arr-1' });
    mocks.technicians.mockResolvedValue(['tech-1', 'tech-2']);
  });

  it('is null and reads nothing while the co-managed-seat capability does not serve the tenant', async () => {
    mocks.served.mockResolvedValue(false);
    expect(await resolveTicketSeatContext({} as any, 't1', staff, 'client-1', null)).toBeNull();
    expect(mocks.served).toHaveBeenCalledWith('co-managed-seat', 't1');
    expect(mocks.arrangement).not.toHaveBeenCalled();
    expect(mocks.technicians).not.toHaveBeenCalled();
  });

  it('is null for a client-portal user', async () => {
    expect(await resolveTicketSeatContext({} as any, 't1', { user_id: 'c', user_type: 'client' }, 'client-1', null)).toBeNull();
    expect(mocks.served).not.toHaveBeenCalled();
  });

  it('gives MSP staff on an arrangement client that client\'s technicians', async () => {
    expect(await resolveTicketSeatContext({} as any, 't1', staff, 'client-1', null)).toEqual({
      viewer: 'msp', arrangement: true, clientTechnicians: ['tech-1', 'tech-2'],
    });
    expect(mocks.technicians).toHaveBeenCalledWith(expect.anything(), 't1', 'client-1');
  });

  it('gives MSP staff on a client without a live arrangement no technicians and no technician read', async () => {
    mocks.arrangement.mockResolvedValue(undefined);
    expect(await resolveTicketSeatContext({} as any, 't1', staff, 'client-2', null)).toEqual({
      viewer: 'msp', arrangement: false, clientTechnicians: [],
    });
    expect(mocks.technicians).not.toHaveBeenCalled();
  });

  it('identifies a seat technician from the already-resolved audience, with no technician read', async () => {
    const tech = { user_id: 'tech-1', user_type: 'internal', seat_reader: true };
    expect(await resolveTicketSeatContext({} as any, 't1', tech, 'client-1', ['tech-1', 'tech-2'])).toEqual({
      viewer: 'client_it', arrangement: true, clientTechnicians: ['tech-1', 'tech-2'],
    });
    expect(mocks.technicians).not.toHaveBeenCalled();
  });
});

describe('restrictToThisClientsSeatTechnicians', () => {
  const run = (seatTicket: Parameters<typeof restrictToThisClientsSeatTechnicians>[1]) => {
    const calls: string[] = [];
    const inner = {
      where: (column: string, value: unknown) => { calls.push(`where ${column} ${String(value)}`); return inner; },
      orWhereIn: (column: string, values: string[]) => { calls.push(`orWhereIn ${column} ${values.join(',')}`); return inner; },
    };
    const query = { where: vi.fn((fn: (q: typeof inner) => void) => { fn(inner); return query; }) };
    const result = restrictToThisClientsSeatTechnicians(query as any, seatTicket);
    return { query, result, calls };
  };

  it('leaves the query untouched while the seat capability is closed (no context)', () => {
    const { query, result } = run(null);
    expect(result).toBe(query);
    expect(query.where).not.toHaveBeenCalled();
  });

  it('leaves a seat technician\'s own picker to the seat audience', () => {
    const { query } = run({ viewer: 'client_it', clientTechnicians: ['tech-1'] });
    expect(query.where).not.toHaveBeenCalled();
  });

  it('on a client without technicians admits only non-seat users', () => {
    const { calls } = run({ viewer: 'msp', clientTechnicians: [] });
    expect(calls).toEqual(['where seat_reader false']);
  });

  it('on an arrangement client admits non-seat users plus only that client\'s technicians', () => {
    const { calls } = run({ viewer: 'msp', clientTechnicians: ['tech-1', 'tech-2'] });
    expect(calls).toEqual(['where seat_reader false', 'orWhereIn user_id tech-1,tech-2']);
  });
});
