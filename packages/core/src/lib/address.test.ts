import { describe, expect, it } from 'vitest';
import { formatLocationAddress, formatPostalAddress } from './address';

describe('formatPostalAddress', () => {
  it('skips null, undefined, empty and whitespace-only parts', () => {
    expect(formatPostalAddress(['A', null, undefined, '', '   ', '\t\n', 'B'])).toBe('A, B');
  });

  it('trims kept parts', () => {
    expect(formatPostalAddress(['  A ', ' B'])).toBe('A, B');
  });

  it('returns an empty string for an all-empty address', () => {
    expect(formatPostalAddress([null, undefined, '', '  '])).toBe('');
    expect(formatPostalAddress([])).toBe('');
  });

  it('does not leave a ", ," gap for an empty address_line2', () => {
    expect(formatPostalAddress(['2315 W Ayleen St', '', 'Tampa'])).toBe('2315 W Ayleen St, Tampa');
  });

  it('supports a custom separator', () => {
    expect(formatPostalAddress(['A', '', 'B'], { separator: '\n' })).toBe('A\nB');
  });
});

describe('formatLocationAddress', () => {
  it('skips empty components and storage placeholders', () => {
    expect(
      formatLocationAddress({
        address_line1: '2315 W Ayleen St',
        address_line2: '  ',
        city: 'Tampa',
        state_province: null,
        postal_code: '33607',
        country_name: 'Unknown',
      }),
    ).toBe('2315 W Ayleen St, Tampa, 33607');
  });

  it('returns empty for null', () => {
    expect(formatLocationAddress(null)).toBe('');
  });
});
