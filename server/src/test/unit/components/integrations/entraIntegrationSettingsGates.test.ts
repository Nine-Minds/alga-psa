import { describe, expect, it } from 'vitest';

import {
  buildEntraConnectionOptions,
  shouldShowAmbiguousQueue,
  shouldShowFieldSyncControls,
} from '@ee/components/settings/integrations/entraIntegrationSettingsGates';

describe('buildEntraConnectionOptions', () => {
  it('returns only the Direct option when CIPP is disabled', () => {
    const options = buildEntraConnectionOptions(false);

    expect(options.map((option) => option.id)).toEqual(['direct']);
    expect(options.find((option) => option.id === 'cipp')).toBeUndefined();
  });

  it('ignores the CIPP flag and never surfaces CIPP in the UI', () => {
    // CIPP entry point is intentionally removed from the UI. Server plumbing
    // remains, but buildEntraConnectionOptions must not re-expose it.
    const options = buildEntraConnectionOptions(true);

    expect(options.map((option) => option.id)).toEqual(['direct']);
    expect(options.find((option) => option.id === 'cipp')).toBeUndefined();
  });

  it('hides field-sync controls and ambiguous queue when their flags are disabled', () => {
    expect(shouldShowFieldSyncControls(false)).toBe(false);
    expect(shouldShowAmbiguousQueue(false)).toBe(false);
  });
});
