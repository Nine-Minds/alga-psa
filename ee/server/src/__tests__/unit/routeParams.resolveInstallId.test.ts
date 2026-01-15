import { describe, expect, it } from 'vitest';

import { resolveInstallIdFromParamsOrUrl } from '@ee/lib/next/routeParams';

describe('resolveInstallIdFromParamsOrUrl', () => {
  it('prefers installId from resolved params', async () => {
    const id = await resolveInstallIdFromParamsOrUrl(
      Promise.resolve({ installId: 'install-from-params' }),
      'http://localhost/api/internal/ext-storage/install/install-from-url'
    );
    expect(id).toBe('install-from-params');
  });

  it('falls back to parsing the request URL pathname', async () => {
    const id = await resolveInstallIdFromParamsOrUrl(
      undefined,
      'http://localhost/api/internal/ext-storage/install/install-from-url'
    );
    expect(id).toBe('install-from-url');
  });

  it('falls back when params is an unexpected value', async () => {
    const id = await resolveInstallIdFromParamsOrUrl(
      () => ({ installId: 'ignored' }),
      'http://localhost/api/internal/ext-storage/install/install-from-url'
    );
    expect(id).toBe('install-from-url');
  });
});

