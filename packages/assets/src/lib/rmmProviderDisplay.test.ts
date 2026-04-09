import { describe, expect, it } from 'vitest';
import { getRmmProviderDisplayName } from './rmmProviderDisplay';

describe('getRmmProviderDisplayName', () => {
  it('renders tacticalrmm as Tactical RMM', () => {
    expect(getRmmProviderDisplayName('tacticalrmm')).toBe('Tactical RMM');
  });

  it('renders tanium as Tanium', () => {
    expect(getRmmProviderDisplayName('tanium')).toBe('Tanium');
  });
});
