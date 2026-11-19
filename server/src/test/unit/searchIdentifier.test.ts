import { describe, expect, it } from 'vitest';
import { deriveSearchIdentifierMatch } from '@alga-psa/shared/ticketClients/searchIdentifier';

describe('T001 deriveSearchIdentifierMatch', () => {
  it('uses the whole hyphenated number as exact and gives no prefix', () => {
    expect(deriveSearchIdentifierMatch('ALGA-2026-0002826')).toEqual({ exact: 'alga-2026-0002826', prefix: null, isFullNumber: true });
  });

  it('gives a prefix for a single number-shaped token', () => {
    expect(deriveSearchIdentifierMatch('TIC0002826')).toEqual({ exact: 'tic0002826', prefix: 'tic0002826', isFullNumber: false });
    expect(deriveSearchIdentifierMatch('ALGA-2026')).toEqual({ exact: 'alga-2026', prefix: 'alga-2026', isFullNumber: false });
    expect(deriveSearchIdentifierMatch('TIC123')).toEqual({ exact: 'tic123', prefix: 'tic123', isFullNumber: false });
  });

  it('strips a leading # and surrounding whitespace', () => {
    const expected = { exact: 'alga-2026-0002826', prefix: null, isFullNumber: true };
    expect(deriveSearchIdentifierMatch('#ALGA-2026-0002826')).toEqual(expected);
    expect(deriveSearchIdentifierMatch('  ALGA-2026-0002826 ')).toEqual(expected);
    expect(deriveSearchIdentifierMatch('##ALGA-2026-0002826')).toEqual(expected);
  });

  it('returns nulls for empty input and a lone #', () => {
    expect(deriveSearchIdentifierMatch('')).toEqual({ exact: null, prefix: null, isFullNumber: false });
    expect(deriveSearchIdentifierMatch('   ')).toEqual({ exact: null, prefix: null, isFullNumber: false });
    expect(deriveSearchIdentifierMatch('#')).toEqual({ exact: null, prefix: null, isFullNumber: false });
    expect(deriveSearchIdentifierMatch(null)).toEqual({ exact: null, prefix: null, isFullNumber: false });
  });

  it('gives no prefix for multi-word text', () => {
    expect(deriveSearchIdentifierMatch('printer TIC123')).toEqual({ exact: 'printer tic123', prefix: null, isFullNumber: false });
    expect(deriveSearchIdentifierMatch('ALGA-2026 0002826').prefix).toBeNull();
  });
});
