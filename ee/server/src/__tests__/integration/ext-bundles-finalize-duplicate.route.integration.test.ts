import { afterEach, describe, expect, it, vi } from 'vitest';

import * as extBundleActions from '@ee/lib/actions/extBundleActions';
import { DUPLICATE_EXTENSION_VERSION_CODE, DuplicateExtensionVersionError } from '@ee/lib/extensions/registry-v2';
import { POST } from '@ee/app/api/ext-bundles/finalize/route';

describe('ext-bundles/finalize duplicate version response', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('T001: returns HTTP 409 and stable duplicate-version code when version already exists', async () => {
    vi.spyOn(extBundleActions, 'extFinalizeUpload').mockRejectedValue(
      new DuplicateExtensionVersionError({ extensionId: 'ext-1', version: '1.2.3' })
    );

    const req = new Request('http://localhost/api/ext-bundles/finalize', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-alga-admin': 'true',
      },
      body: JSON.stringify({ key: 'sha256/staging/test' }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body?.success).toBe(false);
    expect(body?.error?.code).toBe(DUPLICATE_EXTENSION_VERSION_CODE);
  });

  it('T002: duplicate-version payload includes user-friendly message with conflicting version value', async () => {
    vi.spyOn(extBundleActions, 'extFinalizeUpload').mockRejectedValue(
      new DuplicateExtensionVersionError({ extensionId: 'ext-1', version: '9.9.9' })
    );

    const req = new Request('http://localhost/api/ext-bundles/finalize', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-alga-admin': 'true',
      },
      body: JSON.stringify({ key: 'sha256/staging/test' }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(String(body?.error?.message ?? '')).toContain('9.9.9');
    expect(String(body?.error?.message ?? '')).toContain('already exists');
  });

  it('T008: HTTP route uses the same duplicate payload envelope shape as server action result mode', async () => {
    vi.spyOn(extBundleActions, 'extFinalizeUpload').mockRejectedValue(
      new DuplicateExtensionVersionError({ extensionId: 'ext-1', version: '3.0.0' })
    );

    const req = new Request('http://localhost/api/ext-bundles/finalize', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-alga-admin': 'true',
      },
      body: JSON.stringify({ key: 'sha256/staging/test' }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toEqual({
      success: false,
      error: {
        message: 'Version "3.0.0" already exists for this extension. Publish a new version and try again.',
        code: DUPLICATE_EXTENSION_VERSION_CODE,
      },
    });
  });
});
