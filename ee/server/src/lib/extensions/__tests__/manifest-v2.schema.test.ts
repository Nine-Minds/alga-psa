import { describe, it, expect } from 'vitest';
import { manifestV2Schema, validateManifestV2 } from '../../extensions/schemas/manifest-v2.schema';

describe('Manifest V2 Schema', () => {
  const validExample = {
    name: 'com.alga.softwareone',
    publisher: 'SoftwareOne',
    version: '1.2.3',
    runtime: 'wasm-js@1',
    capabilities: ['http.fetch', 'storage.kv', 'secrets.get'],
    ui: {
      type: 'iframe',
      entry: 'ui/index.html',
      // Extra fields not in schema should be allowed/stripped by Zod default behavior
      routes: [{ path: '/agreements', iframePath: 'ui/index.html' }],
    },
    // Extra fields should not cause validation failure
    events: [{ topic: 'billing.statement.created', handler: 'dist/handlers/statement.wasm#handle' }],
    entry: 'dist/main.wasm#handle',
    precompiled: {
      'x86_64-linux-gnu': 'artifacts/cwasm/x86_64-linux-gnu/main.cwasm',
      'aarch64-linux-gnu': 'artifacts/cwasm/aarch64-linux-gnu/main.cwasm',
    },
    api: {
      endpoints: [
        { method: 'GET', path: '/agreements', handler: 'dist/handlers/http/list_agreements#handle' },
        { method: 'POST', path: '/agreements/sync', handler: 'dist/handlers/http/sync#handle' },
      ],
    },
    assets: ['ui/**/*'],
    sbom: 'sbom.spdx.json',
  };

  it('accepts a valid manifest example (from docs)', () => {
    const res = validateManifestV2(validExample);
    expect(res.valid).toBe(true);
    expect(res.data).toBeDefined();
    expect(res.data?.name).toBe('com.alga.softwareone');
  });

  it('fails when ui.entry is missing', () => {
    const invalid = {
      ...validExample,
      ui: { type: 'iframe' as const }, // missing entry
    };
    const res = validateManifestV2(invalid);
    expect(res.valid).toBe(false);
    expect(res.errors?.some((m) => m.includes('ui.entry'))).toBe(true);
  });

  it('fails when api endpoint method is invalid', () => {
    const invalid = {
      ...validExample,
      api: {
        endpoints: [
          { method: 'GET', path: '/ok', handler: 'handler#ok' },
          { method: 'FOO' as any, path: '/bad', handler: 'handler#bad' },
        ],
      },
    };
    const res = validateManifestV2(invalid);
    expect(res.valid).toBe(false);
    // Expect path to include api.endpoints.1.method
    expect(res.errors?.some((m) => m.includes('api.endpoints.1.method'))).toBe(true);
  });

  it('fails when version is not valid semver', () => {
    const invalid = {
      ...validExample,
      version: '1.0', // invalid semver
    };
    const res = validateManifestV2(invalid);
    expect(res.valid).toBe(false);
    expect(res.errors?.some((m) => m.includes('version'))).toBe(true);
  });
});

describe('manifestV2Schema direct parsing', () => {
  it('strips unknown keys but keeps required fields', () => {
    const parsed = manifestV2Schema.parse({
      name: 'com.example.app',
      publisher: 'Example Inc.',
      version: '0.1.0',
      runtime: 'wasm-js@1',
      capabilities: [],
      ui: { type: 'iframe', entry: 'ui/index.html' },
      api: { endpoints: [{ method: 'GET', path: '/ping', handler: 'dist/ping#handle' }] },
      unknownKey: 'should-be-ignored',
    } as any);

    expect(parsed.name).toBe('com.example.app');
    // unknownKey should not exist on parsed type
    expect((parsed as any).unknownKey).toBeUndefined();
  });
});