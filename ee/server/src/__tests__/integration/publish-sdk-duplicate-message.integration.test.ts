import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { publishExtension } from '../../../../../sdk/alga-client-sdk/src/lib/publish';

describe('CLI publish duplicate-version messaging', () => {
  it('T010: publish SDK surfaces duplicate-version response message from finalize path', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'alga-sdk-publish-'));
    const bundlePath = path.join(tempDir, 'bundle.tar.zst');
    const manifestPath = path.join(tempDir, 'manifest.json');

    writeFileSync(bundlePath, Buffer.from([1, 2, 3, 4]));
    writeFileSync(
      manifestPath,
      JSON.stringify({
        name: 'sdk-duplicate-test',
        publisher: 'vitest',
        version: '1.2.3',
        runtime: 'node@1',
      })
    );

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            upload: { key: 'sha256/staging/test' },
            filename: 'bundle.tar.zst',
            size: 4,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            error: {
              code: 'EXTENSION_VERSION_ALREADY_EXISTS',
              message: 'Version "1.2.3" already exists for this extension. Publish a new version and try again.',
            },
          }),
          { status: 409, headers: { 'content-type': 'application/json' } }
        )
      );

    try {
      const result = await publishExtension({
        projectPath: bundlePath,
        apiKey: 'test-api-key',
        tenantId: 'test-tenant',
        install: false,
        fetchImpl,
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
        },
      });

      expect(result.success).toBe(false);
      expect(String(result.error ?? '')).toContain('Version "1.2.3" already exists');
      expect(String(result.error ?? '')).toContain('EXTENSION_VERSION_ALREADY_EXISTS');
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
