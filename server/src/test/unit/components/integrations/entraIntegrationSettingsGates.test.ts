import { describe, expect, it } from 'vitest';

import {
  buildEntraConnectionOptions,
  shouldShowAmbiguousQueue,
  shouldShowFieldSyncControls,
} from '@ee/components/settings/integrations/entraIntegrationSettingsGates';

describe('buildEntraConnectionOptions', () => {
  it('hides the CIPP connection option when entra-integration-cipp is disabled', () => {
    const options = buildEntraConnectionOptions(false);

    expect(options.map((option) => option.id)).toEqual(['direct']);
    expect(options.find((option) => option.id === 'cipp')).toBeUndefined();
  });

  it('includes the CIPP connection option when entra-integration-cipp is enabled', () => {
    const options = buildEntraConnectionOptions(true);

    expect(options.map((option) => option.id)).toEqual(['direct', 'cipp']);
  });

  it('hides field-sync controls and ambiguous queue when their flags are disabled', () => {
    expect(shouldShowFieldSyncControls(false)).toBe(false);
    expect(shouldShowAmbiguousQueue(false)).toBe(false);
  });
});
