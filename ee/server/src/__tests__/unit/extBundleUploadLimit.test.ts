import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/index', () => ({ createTenantKnex: vi.fn(async () => ({ tenant: 't1', knex: {} })) }));
vi.mock('../../lib/storage/s3-client', () => ({ getS3Client: () => ({ send: vi.fn() }), getBundleBucket: () => 'b' }));
vi.mock('../../lib/storage/bundles/s3-bundle-store', () => ({ createS3BundleStore: () => ({ putObject: vi.fn() }) }));

import { extGetUploadLimit, extUploadProxy } from '../../lib/actions/extBundleActions';

afterEach(() => vi.unstubAllEnvs());

const form = (size: number, fileBytes = size) => {
  const fd = new FormData();
  fd.set('filename', 'b.tar.zst');
  fd.set('size', String(size));
  fd.set('file', new File([new Uint8Array(fileBytes)], 'b.tar.zst'));
  return fd;
};

describe('extension bundle upload limit (buffered through a server action)', () => {
  it('is the server-action file limit, never the 200 MiB bundle cap when the body cap is lower', async () => {
    vi.stubEnv('SERVER_ACTIONS_BODY_LIMIT', '26mb');
    expect((await extGetUploadLimit()).maxBytes).toBe(26 * 1024 * 1024 - 64 * 1024);
  });

  it('is clamped to the 200 MiB bundle cap when the body cap is higher', async () => {
    vi.stubEnv('SERVER_ACTIONS_BODY_LIMIT', '1gb');
    // The proxy cap (100mb) still bounds the server-action limit below the bundle cap.
    expect((await extGetUploadLimit()).maxBytes).toBe(100 * 1024 * 1024 - 64 * 1024);
  });

  it('refuses a declared size over the limit with the named UploadSizeLimitError (413)', async () => {
    vi.stubEnv('SERVER_ACTIONS_BODY_LIMIT', '2mb');
    const limit = 2 * 1024 * 1024 - 64 * 1024;
    await expect(extUploadProxy(form(limit + 1, 10))).rejects.toMatchObject({
      name: 'UploadSizeLimitError', status: 413, code: 'UPLOAD_SIZE_LIMIT_EXCEEDED', limit,
    });
  });

  it('refuses a file larger than its declared size too', async () => {
    vi.stubEnv('SERVER_ACTIONS_BODY_LIMIT', '2mb');
    const limit = 2 * 1024 * 1024 - 64 * 1024;
    await expect(extUploadProxy(form(10, limit + 1))).rejects.toMatchObject({ name: 'UploadSizeLimitError', status: 413 });
  });
});
