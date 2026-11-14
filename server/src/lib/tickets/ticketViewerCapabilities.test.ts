import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/capability', () => ({ admits: vi.fn() }));
vi.mock('@/lib/productAccess', () => ({ getCurrentProductPrincipal: vi.fn() }));

import { admits } from '@alga-psa/core/capability';
import { getCurrentProductPrincipal } from '@/lib/productAccess';
import { NATIVE_TICKET_CAPABILITIES, SEAT_TECHNICIAN_TICKET_CAPABILITIES } from '@alga-psa/tickets/lib/ticketDataSource';
import { getViewerTicketCapabilities, resolveTicketViewerCapabilities } from './ticketViewerCapabilities';

describe('resolveTicketViewerCapabilities', () => {
  it('gives a native viewer the full set', () => {
    expect(resolveTicketViewerCapabilities({ surfaceKind: null, seatCapabilityAdmitted: true })).toBe(NATIVE_TICKET_CAPABILITIES);
  });
  it('gives a seat technician the reduced set', () => {
    expect(resolveTicketViewerCapabilities({ surfaceKind: 'co_managed_seat', seatCapabilityAdmitted: true })).toBe(SEAT_TECHNICIAN_TICKET_CAPABILITIES);
  });
  it('gives everyone the native set when the seat capability is off', () => {
    expect(resolveTicketViewerCapabilities({ surfaceKind: 'co_managed_seat', seatCapabilityAdmitted: false })).toBe(NATIVE_TICKET_CAPABILITIES);
  });
  it('gives an unknown principal kind the native set', () => {
    expect(resolveTicketViewerCapabilities({ surfaceKind: 'other', seatCapabilityAdmitted: true })).toBe(NATIVE_TICKET_CAPABILITIES);
  });
});

describe('getViewerTicketCapabilities', () => {
  beforeEach(() => { vi.mocked(admits).mockReset(); });
  it('does not consult the capability gate for an ordinary user', async () => {
    vi.mocked(getCurrentProductPrincipal).mockResolvedValue({ productCode: 'psa' });
    expect(await getViewerTicketCapabilities('t1')).toBe(NATIVE_TICKET_CAPABILITIES);
    expect(admits).not.toHaveBeenCalled();
  });
  it('resolves the seat set for a seat principal when co-managed-seat admits', async () => {
    vi.mocked(getCurrentProductPrincipal).mockResolvedValue({ productCode: 'psa', surfaceKind: 'co_managed_seat' });
    vi.mocked(admits).mockResolvedValue({ admitted: true } as never);
    expect(await getViewerTicketCapabilities('t1')).toBe(SEAT_TECHNICIAN_TICKET_CAPABILITIES);
    expect(admits).toHaveBeenCalledWith('co-managed-seat', 't1');
  });
  it('resolves native for a seat principal when the flag is off', async () => {
    vi.mocked(getCurrentProductPrincipal).mockResolvedValue({ productCode: 'psa', surfaceKind: 'co_managed_seat' });
    vi.mocked(admits).mockResolvedValue({ admitted: false } as never);
    expect(await getViewerTicketCapabilities('t1')).toBe(NATIVE_TICKET_CAPABILITIES);
  });
});
