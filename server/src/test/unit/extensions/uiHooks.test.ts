import { describe, it, expect } from 'vitest';
import { getUiHooks, type ManifestV2 } from '@ee/lib/extensions/bundles/manifest';

describe('getUiHooks', () => {
  it('returns both appMenu and clientPortalMenu when present', () => {
    const manifest: ManifestV2 = {
      name: 'com.acme.demo',
      publisher: 'acme',
      version: '1.0.0',
      runtime: 'wasm-js@1',
      ui: {
        type: 'iframe',
        entry: 'ui/index.html',
        hooks: {
          appMenu: { label: '  MSP App  ' },
          clientPortalMenu: { label: '  Client App  ' },
        },
      },
    };

    expect(getUiHooks(manifest)).toEqual({
      appMenu: { label: 'MSP App' },
      clientPortalMenu: { label: 'Client App' },
    });
  });

  it('drops empty labels and returns undefined when none remain', () => {
    const manifest: ManifestV2 = {
      name: 'com.acme.demo',
      publisher: 'acme',
      version: '1.0.0',
      runtime: 'wasm-js@1',
      ui: {
        type: 'iframe',
        entry: 'ui/index.html',
        hooks: {
          clientPortalMenu: { label: '   ' },
        },
      },
    };

    expect(getUiHooks(manifest)).toBeUndefined();
  });
});

