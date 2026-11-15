/** @vitest-environment jsdom */

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useFormatters } from './client';

vi.unmock('@alga-psa/ui/lib/i18n/client');

// Intl separates symbol from digits with NBSP/NNBSP depending on locale.
const stripSpaces = (value: string) => value.replace(/[\u00a0\u202f]/g, ' ');

/**
 * Every money figure threaded through `useFormatters` (contract detail, the
 * simulator's totals and timeline, the wizard's Estimated Monthly Total) must
 * show the glyph the currency picker offered — en-US Intl names ZAR "ZAR",
 * which read as "ZAR 0.00" on screen.
 */
describe('useFormatters formatCurrency', () => {
  const format = (value: number, currency: string, options?: Intl.NumberFormatOptions) => {
    const { result } = renderHook(() => useFormatters());
    return stripSpaces(result.current.formatCurrency(value, currency, options));
  };

  it('shows the product symbol for a picker currency', () => {
    expect(format(0, 'ZAR')).toBe('R 0.00');
    expect(format(1234.5, 'ZAR')).toBe('R 1,234.50');
    expect(format(1234.5, 'ZAR')).not.toContain('ZAR');
  });

  it('leaves other currencies and pass-through options alone', () => {
    expect(format(1234.5, 'USD')).toBe('$1,234.50');
    expect(format(1234, 'JPY')).toBe('¥1,234');
    expect(format(1234, 'ZAR', { maximumFractionDigits: 0 })).toBe('R 1,234');
  });
});
