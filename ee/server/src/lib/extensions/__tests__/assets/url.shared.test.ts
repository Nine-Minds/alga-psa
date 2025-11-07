import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { buildExtUiSrc } from 'server/src/lib/extensions/assets/url.shared';

const HASH = 'sha256:' + 'a'.repeat(64);
const ENCODED_HASH = encodeURIComponent(HASH);

function resetEnv() {
  delete process.env.RUNNER_PUBLIC_BASE;
  delete process.env.EXT_UI_HOST_MODE;
}

describe('buildExtUiSrc', () => {
  beforeEach(() => {
    resetEnv();
    process.env.EXT_UI_HOST_MODE = 'rust';
  });

  afterEach(() => {
    resetEnv();
  });

  it('falls back to /runner when no public base is set', () => {
    const src = buildExtUiSrc('ext-1', HASH, '/');
    expect(src).toBe(`/runner/ext-ui/ext-1/${ENCODED_HASH}/index.html?path=%2F&extensionId=ext-1`);
  });

  it('uses absolute public base when provided', () => {
    process.env.RUNNER_PUBLIC_BASE = 'https://runner.dev/alga';
    const src = buildExtUiSrc('ext-1', HASH, '/settings');
    expect(src).toBe(`https://runner.dev/alga/ext-ui/ext-1/${ENCODED_HASH}/index.html?path=%2Fsettings&extensionId=ext-1`);
  });

  it('supports relative public base for gateway proxy', () => {
    process.env.RUNNER_PUBLIC_BASE = '/runner';
    const src = buildExtUiSrc('ext-1', HASH, '/');
    expect(src).toBe(`/runner/ext-ui/ext-1/${ENCODED_HASH}/index.html?path=%2F&extensionId=ext-1`);
  });

  it('appends tenant when provided', () => {
    const src = buildExtUiSrc('ext-1', HASH, '/', { tenantId: 'tenant-123' });
    expect(src).toBe(`/runner/ext-ui/ext-1/${ENCODED_HASH}/index.html?path=%2F&tenant=tenant-123&extensionId=ext-1`);
  });

  it('honors public base override', () => {
    const src = buildExtUiSrc('ext-1', HASH, '/', {
      tenantId: 'tenant-123',
      publicBaseOverride: 'http://localhost:8085',
    });
    expect(src).toBe(
      `http://localhost:8085/ext-ui/ext-1/${ENCODED_HASH}/index.html?path=%2F&tenant=tenant-123&extensionId=ext-1`
    );
  });
});
