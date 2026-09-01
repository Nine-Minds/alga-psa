import { describe, expect, it } from 'vitest';
import {
  STATUS_PILL_CLOSED_HUE,
  STATUS_PILL_HUES,
  statusPillHue,
} from './ticketListPresentation';

describe('ticket list status pill palette', () => {
  it('uses theme tokens for every open-status hue', () => {
    expect(STATUS_PILL_HUES).toHaveLength(7);
    expect(STATUS_PILL_HUES.every((hue) => /^var\(--color-[a-z0-9-]+\)$/.test(hue))).toBe(true);
  });

  it('keeps custom status colors stable by name and closed statuses semantic', () => {
    expect(statusPillHue('Waiting on Vendor', false)).toBe(statusPillHue('Waiting on Vendor', false));
    expect(statusPillHue('Completed', true)).toBe(STATUS_PILL_CLOSED_HUE);
  });
});
