import { describe, expect, it } from 'vitest';
import {
  ADD_ONS,
  ADD_ON_DESCRIPTIONS,
  ADD_ON_LABELS,
  tenantHasAddOn,
} from './addOns';

describe('addOns', () => {
  it('defines AI_ASSISTANT with the expected key', () => {
    expect(ADD_ONS.AI_ASSISTANT).toBe('ai_assistant');
  });

  it('defines the AI Assistant label', () => {
    expect(ADD_ON_LABELS[ADD_ONS.AI_ASSISTANT]).toBe('AI Assistant');
  });

  it('defines a non-empty description for the AI Assistant add-on', () => {
    expect(ADD_ON_DESCRIPTIONS[ADD_ONS.AI_ASSISTANT]).toContain('AI');
  });

  it('tenantHasAddOn returns true when the add-on is active', () => {
    expect(tenantHasAddOn([ADD_ONS.AI_ASSISTANT], ADD_ONS.AI_ASSISTANT)).toBe(true);
  });

  it('tenantHasAddOn returns false when the add-on is missing', () => {
    expect(tenantHasAddOn([], ADD_ONS.AI_ASSISTANT)).toBe(false);
  });
});
