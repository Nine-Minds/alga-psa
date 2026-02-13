import { describe, expect, it } from 'vitest';
import { getRmmProviderDisplayName } from './rmmProviderDisplay';

describe('getRmmProviderDisplayName', () => {
  it('renders tacticalrmm as Tactical RMM', () => {
    expect(getRmmProviderDisplayName('tacticalrmm')).toBe('Tactical RMM');
  });
});

