import { afterEach, describe, expect, it } from 'vitest';
import { clearUiSlots, registerUiSlot, resolveUiSlots } from './uiSlotRegistry';

describe('uiSlotRegistry', () => {
  afterEach(() => clearUiSlots());

  it('returns nothing when the capability is not served', () => {
    registerUiSlot('ticket.details.sidebar', { id: 'a', capability: 'co-managed', order: 1 });
    expect(resolveUiSlots('ticket.details.sidebar', new Set())).toEqual([]);
  });

  it('returns served contributions in order and supports unregister', () => {
    const off = registerUiSlot('project.details.tab', { id: 'b', capability: 'co-managed', order: 2 });
    registerUiSlot('project.details.tab', { id: 'a', capability: 'co-managed', order: 1 });
    expect(resolveUiSlots('project.details.tab', new Set(['co-managed'])).map((c) => c.id)).toEqual(['a', 'b']);
    off();
    expect(resolveUiSlots('project.details.tab', new Set(['co-managed'])).map((c) => c.id)).toEqual(['a']);
    expect(resolveUiSlots('client.details.tab', new Set(['co-managed']))).toEqual([]);
  });
});
