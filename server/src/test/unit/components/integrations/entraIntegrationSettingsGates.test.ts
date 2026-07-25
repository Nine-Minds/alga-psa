import { describe, expect, it } from 'vitest';

import {
  buildEntraConnectionOptions,
  buildEntraStatusHeaderAction,
  shouldShowAmbiguousQueue,
  shouldShowFieldSyncControls,
} from '@ee/components/settings/integrations/entraIntegrationSettingsGates';

describe('buildEntraConnectionOptions', () => {
  it('returns only the Direct option when CIPP is disabled', () => {
    const options = buildEntraConnectionOptions(false);

    expect(options.map((option) => option.id)).toEqual(['direct']);
    expect(options.find((option) => option.id === 'cipp')).toBeUndefined();
  });

  it('returns Direct and CIPP options when CIPP is enabled', () => {
    const options = buildEntraConnectionOptions(true);

    expect(options.map((option) => option.id)).toEqual(['direct', 'cipp']);
    expect(options.find((option) => option.id === 'cipp')).toBeDefined();
  });

  it('hides field-sync controls and ambiguous queue when their flags are disabled', () => {
    expect(shouldShowFieldSyncControls(false)).toBe(false);
    expect(shouldShowAmbiguousQueue(false)).toBe(false);
  });
});

describe('buildEntraStatusHeaderAction', () => {
  it('offers no action on a never-connected tenant', () => {
    expect(buildEntraStatusHeaderAction({ status: 'not_connected', connectionType: null })).toEqual({
      disconnect: false,
      reconnect: null,
    });
  });

  it('offers Disconnect while connected', () => {
    expect(buildEntraStatusHeaderAction({ status: 'connected', connectionType: 'cipp' })).toEqual({
      disconnect: true,
      reconnect: null,
    });
  });

  it('reconnects the stored connection type rather than assuming direct', () => {
    expect(buildEntraStatusHeaderAction({ status: 'validation_failed', connectionType: 'cipp' })).toEqual({
      disconnect: false,
      reconnect: 'cipp',
    });
    expect(buildEntraStatusHeaderAction({ status: 'validation_failed', connectionType: 'direct' })).toEqual({
      disconnect: false,
      reconnect: 'direct',
    });
  });
});
