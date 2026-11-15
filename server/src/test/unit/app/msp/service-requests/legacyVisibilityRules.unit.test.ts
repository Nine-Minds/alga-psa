import { describe, expect, it } from 'vitest';
import { adoptLegacyVisibilityRules } from '../../../../../app/msp/service-requests/form-builder/legacyVisibilityRules';
import type { BasicFormField } from '../../../../../lib/service-requests/formSchema';

const elements = (): BasicFormField[] => [
  { key: 'needs_vpn', type: 'checkbox', label: 'Needs VPN' },
  { key: 'vpn_reason', type: 'short-text', label: 'VPN reason' },
  { key: 'hardware', type: 'section', label: 'Hardware' },
];

describe('adoptLegacyVisibilityRules', () => {
  it('leaves a definition without legacy rules untouched', () => {
    const result = adoptLegacyVisibilityRules(elements(), {});
    expect(result.remainingConfig).toBeNull();
    expect(result.unadoptedRules).toEqual([]);
    expect(result.elements.every((element) => element.visibleWhen === undefined)).toBe(true);
  });

  it('moves a rule onto the element it governs and drops it from the config', () => {
    const result = adoptLegacyVisibilityRules(elements(), {
      contextDefaults: { dept: '{{clientId}}' },
      visibilityRules: [{ fieldKey: 'vpn_reason', source: 'needs_vpn', operator: 'is-true' }],
    });

    expect(result.elements[1].visibleWhen).toEqual([
      { source: 'needs_vpn', operator: 'is-true' },
    ]);
    // Everything else in the config survives; only the adopted rules go.
    expect(result.remainingConfig).toEqual({ contextDefaults: { dept: '{{clientId}}' } });
    expect(result.unadoptedRules).toEqual([]);
  });

  it('adopts a section rule as well, since a section can be hidden', () => {
    const result = adoptLegacyVisibilityRules(elements(), {
      visibilityRules: [{ fieldKey: 'hardware', source: 'needs_vpn', operator: 'is-true' }],
    });
    expect(result.elements[2].visibleWhen).toEqual([
      { source: 'needs_vpn', operator: 'is-true' },
    ]);
  });

  it('keeps a rule no element can express, and reports it', () => {
    const result = adoptLegacyVisibilityRules(elements(), {
      visibilityRules: [{ fieldKey: 'long_gone', source: 'needs_vpn', operator: 'is-true' }],
    });

    expect(result.remainingConfig).toBeNull();
    expect(result.unadoptedRules).toEqual([
      { fieldKey: 'long_gone', source: 'needs_vpn', operator: 'is-true', value: undefined },
    ]);
    expect(result.elements.every((element) => element.visibleWhen === undefined)).toBe(true);
  });

  it('handles a definition that mixes both kinds', () => {
    const withOwnRule = elements();
    withOwnRule[1] = {
      ...withOwnRule[1],
      visibleWhen: [{ source: 'needs_vpn', operator: 'is-true' }],
    };

    const result = adoptLegacyVisibilityRules(withOwnRule, {
      contextDefaults: {},
      visibilityRules: [
        // Already said on the element: adopted without being duplicated.
        { fieldKey: 'vpn_reason', source: 'needs_vpn', operator: 'is-true' },
        // New to the element: appended, so both must hold.
        { fieldKey: 'vpn_reason', source: 'context.clientId', operator: 'has-value' },
        // No element of this key: stays in the config and keeps being evaluated.
        { fieldKey: 'long_gone', source: 'needs_vpn', operator: 'is-true' },
      ],
    });

    expect(result.elements[1].visibleWhen).toEqual([
      { source: 'needs_vpn', operator: 'is-true' },
      { source: 'context.clientId', operator: 'has-value', value: undefined },
    ]);
    expect(result.remainingConfig).toEqual({
      contextDefaults: {},
      visibilityRules: [
        { fieldKey: 'long_gone', source: 'needs_vpn', operator: 'is-true', value: undefined },
      ],
    });
    expect(result.unadoptedRules).toHaveLength(1);
  });
});
