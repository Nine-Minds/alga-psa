import { describe, expect, it } from 'vitest';
import { ADD_ONS, ADD_ON_DESCRIPTIONS, ADD_ON_LABELS, tenantHasAddOn } from './addOns';

describe('addOns', () => {
  it('exports supported add-on keys', () => {
    expect(ADD_ONS.AI_ASSISTANT).toBe('ai_assistant');
    expect(ADD_ONS.TEAMS).toBe('teams');
    expect(ADD_ONS.ENTERPRISE).toBe('enterprise');
  });

  it('defines labels and descriptions for every add-on', () => {
    for (const addOn of Object.values(ADD_ONS)) {
      expect(ADD_ON_LABELS[addOn]).toBeTruthy();
      expect(ADD_ON_DESCRIPTIONS[addOn]).toBeTruthy();
    }
  });

  it('checks tenant add-on membership', () => {
    expect(tenantHasAddOn([ADD_ONS.TEAMS], ADD_ONS.TEAMS)).toBe(true);
    expect(tenantHasAddOn([ADD_ONS.TEAMS], ADD_ONS.ENTERPRISE)).toBe(false);
  });
});
