import { describe, expect, it, vi } from 'vitest';
import { runGatedPreloads, gatedPreload } from '../ticketPreloads';
import {
  NATIVE_TICKET_CAPABILITIES,
  SEAT_TECHNICIAN_TICKET_CAPABILITIES,
  type TicketCapabilityKey,
} from '../ticketDataSource';

const GATED_OFF: TicketCapabilityKey[] = [
  'billing', 'quickInvoice', 'materials', 'credentials', 'bundles', 'delete', 'duplicate',
  'emailLogs', 'survey', 'scheduling', 'createTemplate', 'createWorkflow', 'categoryCreate',
];

describe('SEAT_TECHNICIAN_TICKET_CAPABILITIES (F047)', () => {
  it('turns off exactly the gated capabilities and keeps the rest native', () => {
    for (const key of Object.keys(NATIVE_TICKET_CAPABILITIES) as TicketCapabilityKey[]) {
      expect(SEAT_TECHNICIAN_TICKET_CAPABILITIES[key]).toBe(GATED_OFF.includes(key) ? false : NATIVE_TICKET_CAPABILITIES[key]);
    }
  });
});

describe('runGatedPreloads (F048)', () => {
  it('never calls the loader of a capability that is off, and resolves its skipped value', async () => {
    const billing = vi.fn(async () => 'rollup');
    const materials = vi.fn(async () => ['m']);
    const interactions = vi.fn(async () => ['i']);
    const out = runGatedPreloads(SEAT_TECHNICIAN_TICKET_CAPABILITIES, {
      billing: gatedPreload<string | null>('billing', billing, null),
      materials: gatedPreload<string[]>('materials', materials, []),
      interactions: gatedPreload<string[]>(null, interactions, []),
    });
    await expect(out.billing).resolves.toBeNull();
    await expect(out.materials).resolves.toEqual([]);
    await expect(out.interactions).resolves.toEqual(['i']);
    expect(billing).not.toHaveBeenCalled();
    expect(materials).not.toHaveBeenCalled();
    expect(interactions).toHaveBeenCalledTimes(1);
  });

  it('calls every loader once for the native set', async () => {
    const billing = vi.fn(async () => 'rollup');
    const out = runGatedPreloads(NATIVE_TICKET_CAPABILITIES, { billing: gatedPreload<string | null>('billing', billing, null) });
    await expect(out.billing).resolves.toBe('rollup');
    expect(billing).toHaveBeenCalledTimes(1);
  });
});
