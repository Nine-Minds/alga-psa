import { describe, expect, it } from 'vitest';
import { BUNDLE_RULE_RESOURCE_TYPES } from '@alga-psa/authorization/bundles/catalog';
import {
  buildResourceSections,
  humanizeResourceType,
} from '../../../../../ee/server/src/components/settings/policy/policyResourceSections';
import en from '../../../../public/locales/en/msp/admin.json';

describe('policy screen resource sections', () => {
  it('has one section per kernel catalog type, in catalog order', () => {
    expect(buildResourceSections(BUNDLE_RULE_RESOURCE_TYPES).map((s) => s.resourceType)).toEqual([...BUNDLE_RULE_RESOURCE_TYPES]);
  });

  it('gives a type registered later a section without a UI change', () => {
    const [section] = buildResourceSections(['purchase_order']);
    expect(section).toMatchObject({ resourceType: 'purchase_order', fallbackLabel: 'Purchase order' });
    expect(humanizeResourceType('time_entry')).toBe('Time entry');
  });

  it('has an English label for every catalog type', () => {
    for (const section of buildResourceSections(BUNDLE_RULE_RESOURCE_TYPES)) {
      const key = section.labelKey.replace('policyManagement.resourceTypes.', '');
      expect((en.policyManagement.resourceTypes as Record<string, string>)[key]).toBeTruthy();
    }
  });
});
