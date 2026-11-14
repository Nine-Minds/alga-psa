import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/productAccess', () => ({ getCurrentProductPrincipal: vi.fn() }));

import { getCurrentProductPrincipal } from '@/lib/productAccess';
import { NATIVE_TICKET_CAPABILITIES, SEAT_TECHNICIAN_TICKET_CAPABILITIES } from '@alga-psa/tickets/lib/ticketDataSource';
import { getViewerTicketCapabilities, resolveTicketViewerCapabilities } from './ticketViewerCapabilities';

describe('resolveTicketViewerCapabilities', () => {
  it('gives a native viewer the full set', () => {
    expect(resolveTicketViewerCapabilities({ surfaceKind: null })).toBe(NATIVE_TICKET_CAPABILITIES);
    expect(resolveTicketViewerCapabilities({ surfaceKind: undefined })).toBe(NATIVE_TICKET_CAPABILITIES);
  });
  it('gives a seat technician the reduced set', () => {
    expect(resolveTicketViewerCapabilities({ surfaceKind: 'co_managed_seat' })).toBe(SEAT_TECHNICIAN_TICKET_CAPABILITIES);
  });
  it('gives an unregistered principal kind the native set', () => {
    expect(resolveTicketViewerCapabilities({ surfaceKind: 'other' })).toBe(NATIVE_TICKET_CAPABILITIES);
  });
});

describe('getViewerTicketCapabilities', () => {
  beforeEach(() => { vi.mocked(getCurrentProductPrincipal).mockReset(); });

  it('is native for an ordinary user', async () => {
    vi.mocked(getCurrentProductPrincipal).mockResolvedValue({ productCode: 'psa' });
    expect(await getViewerTicketCapabilities()).toBe(NATIVE_TICKET_CAPABILITIES);
  });
  it('is reduced for a seat principal, whatever the release flag says', async () => {
    vi.mocked(getCurrentProductPrincipal).mockResolvedValue({ productCode: 'psa', surfaceKind: 'co_managed_seat' });
    expect(await getViewerTicketCapabilities()).toBe(SEAT_TECHNICIAN_TICKET_CAPABILITIES);
  });
});

describe('the capability gate is never consulted', () => {
  it('ticketViewerCapabilities does not import the release capability gate', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./ticketViewerCapabilities.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/core\/capability/);
    expect(source).not.toMatch(/\badmits\(/);
  });
});
