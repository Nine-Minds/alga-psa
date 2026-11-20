import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  served: vi.fn(),
  arrangement: vi.fn(),
  technicians: vi.fn(),
}));

vi.mock('@alga-psa/core/capability', () => ({ isCapabilityServed: mocks.served }));
vi.mock('@alga-psa/db', () => ({ tenantDb: (_db: unknown, tenant: string) => ({ tenant }), liveSeatArrangement: mocks.arrangement }));
vi.mock('../seatAssigneeAudience', () => ({ seatTechniciansOfClient: mocks.technicians }));

import { keepThisClientsSeatTechnicians, resolveTicketSeatContext } from '../ticketSeatContext';

const staff = { user_id: 'staff-1', user_type: 'internal', seat_reader: false };
/** The tenant's active internal users as the ticket load reads them: staff plus seat technicians. */
const withTechnicians = [
  { user_id: 'staff-1', seat_reader: false },
  { user_id: 'tech-1', seat_reader: true },
  { user_id: 'tech-2', seat_reader: true },
];
const staffOnly = [{ user_id: 'staff-1', seat_reader: false }, { user_id: 'staff-2', seat_reader: false }];

describe('resolveTicketSeatContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.served.mockResolvedValue(true);
    mocks.arrangement.mockResolvedValue({ arrangement_id: 'arr-1' });
    mocks.technicians.mockResolvedValue(['tech-1', 'tech-2']);
  });

  it('is null and reads nothing while the co-managed-seat capability does not serve the tenant', async () => {
    mocks.served.mockResolvedValue(false);
    expect(await resolveTicketSeatContext({} as any, 't1', staff, 'client-1', null, withTechnicians)).toBeNull();
    expect(mocks.served).toHaveBeenCalledWith('co-managed-seat', 't1');
    expect(mocks.arrangement).not.toHaveBeenCalled();
    expect(mocks.technicians).not.toHaveBeenCalled();
  });

  it('in a tenant without seat technicians is null with no statement and no capability probe (hot-path neutrality)', async () => {
    expect(await resolveTicketSeatContext({} as any, 't1', staff, 'client-1', null, staffOnly)).toBeNull();
    expect(await resolveTicketSeatContext({} as any, 't1', staff, 'client-1', null, [])).toBeNull();
    expect(mocks.served).not.toHaveBeenCalled();
    expect(mocks.arrangement).not.toHaveBeenCalled();
    expect(mocks.technicians).not.toHaveBeenCalled();
  });

  it('treats a loaded user without the seat marker as a possible seat technician', async () => {
    expect(await resolveTicketSeatContext({} as any, 't1', staff, 'client-1', null, [{ user_id: 'u-1' }])).toEqual({
      viewer: 'msp', arrangement: true, clientTechnicians: ['tech-1', 'tech-2'],
    });
    expect(mocks.served).toHaveBeenCalledWith('co-managed-seat', 't1');
  });

  it('is null for a client-portal user', async () => {
    expect(await resolveTicketSeatContext({} as any, 't1', { user_id: 'c', user_type: 'client' }, 'client-1', null, withTechnicians)).toBeNull();
    expect(mocks.served).not.toHaveBeenCalled();
  });

  it('gives MSP staff on an arrangement client that client\'s technicians', async () => {
    expect(await resolveTicketSeatContext({} as any, 't1', staff, 'client-1', null, withTechnicians)).toEqual({
      viewer: 'msp', arrangement: true, clientTechnicians: ['tech-1', 'tech-2'],
    });
    expect(mocks.technicians).toHaveBeenCalledWith(expect.anything(), 't1', 'client-1');
  });

  it('gives MSP staff on a client without a live arrangement no technicians and no technician read', async () => {
    mocks.arrangement.mockResolvedValue(undefined);
    expect(await resolveTicketSeatContext({} as any, 't1', staff, 'client-2', null, withTechnicians)).toEqual({
      viewer: 'msp', arrangement: false, clientTechnicians: [],
    });
    expect(mocks.technicians).not.toHaveBeenCalled();
  });

  it('identifies a seat technician from the already-resolved audience, with no technician read', async () => {
    const tech = { user_id: 'tech-1', user_type: 'internal', seat_reader: true };
    expect(await resolveTicketSeatContext({} as any, 't1', tech, 'client-1', ['tech-1', 'tech-2'], staffOnly)).toEqual({
      viewer: 'client_it', arrangement: true, clientTechnicians: ['tech-1', 'tech-2'],
    });
    expect(mocks.technicians).not.toHaveBeenCalled();
  });
});

describe('keepThisClientsSeatTechnicians', () => {
  const rows = [
    { user_id: 'staff-1', seat_reader: false },
    { user_id: 'tech-1', seat_reader: true },
    { user_id: 'tech-other', seat_reader: true },
  ];

  it('leaves the users untouched without a seat context', () => {
    expect(keepThisClientsSeatTechnicians(rows, null)).toBe(rows);
  });

  it('leaves a seat technician\'s own picker to the seat audience', () => {
    expect(keepThisClientsSeatTechnicians(rows, { viewer: 'client_it', clientTechnicians: ['tech-1'] })).toBe(rows);
  });

  it('on a client without technicians keeps only non-seat users', () => {
    expect(keepThisClientsSeatTechnicians(rows, { viewer: 'msp', clientTechnicians: [] }).map((r) => r.user_id))
      .toEqual(['staff-1']);
  });

  it('on an arrangement client keeps non-seat users plus only that client\'s technicians', () => {
    expect(keepThisClientsSeatTechnicians(rows, { viewer: 'msp', clientTechnicians: ['tech-1'] }).map((r) => r.user_id))
      .toEqual(['staff-1', 'tech-1']);
  });
});
