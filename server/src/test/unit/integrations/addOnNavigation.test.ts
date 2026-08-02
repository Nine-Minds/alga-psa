import { describe, expect, it } from 'vitest';
import { ADD_ONS } from '@alga-psa/types';
import { getAddOnDestination } from '@alga-psa/integrations/lib/addOnNavigation';

describe('getAddOnDestination', () => {
  it('builds the canonical deep link for an add-on', () => {
    expect(getAddOnDestination(ADD_ONS.TEAMS)).toBe('/msp/add-ons?addon=teams');
  });
});
