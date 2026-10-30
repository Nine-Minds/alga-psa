import { describe, expect, it } from 'vitest';
import { UI_SLOT_SURFACES, isUiSlotSurface } from './uiSlots';

describe('UI slot surfaces', () => {
  it('lists the surfaces later cards may mount into, including the MSP navigation group', () => {
    expect([...UI_SLOT_SURFACES]).toEqual([
      'ticket.details.sidebar',
      'ticket.details.header',
      'project.details.tab',
      'client.details.tab',
      'msp.navigation.group',
    ]);
  });

  it('only accepts listed surfaces', () => {
    expect(isUiSlotSurface('msp.navigation.group')).toBe(true);
    expect(isUiSlotSurface('msp.navigation')).toBe(false);
    expect(isUiSlotSurface(undefined)).toBe(false);
  });
});
