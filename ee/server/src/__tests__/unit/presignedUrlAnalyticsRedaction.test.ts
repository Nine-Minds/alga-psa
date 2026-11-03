import { afterEach, describe, expect, it, vi } from 'vitest';
import { redactCaptureResult, redactSecretQueryValues } from '@alga-psa/analytics/lib/redactSecretUrls';

// Presigned document links minted by the storage client are bearer
// credentials until they expire. They must not reach PostHog through
// $current_url or clicked-link properties.
const SAVED_ENV = { ...process.env };

async function mintPresignedGetUrl(env: Record<string, string>): Promise<string> {
  vi.resetModules();
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('STORAGE_S3_') || key.startsWith('AWS_')) delete process.env[key];
  }
  Object.assign(process.env, env);
  const { getPresignedGetUrl } = await import('@ee/lib/storage/s3-client');
  return getPresignedGetUrl('tenants/t1/documents/contract.pdf', 900);
}

// Raw (still percent-encoded) values, exactly as they appear in the link.
function signingValues(url: string): string[] {
  return ['X-Amz-Signature', 'X-Amz-Credential', 'X-Amz-Security-Token']
    .map((name) => new RegExp(`[?&]${name}=([^&#]+)`).exec(url)?.[1])
    .filter((value): value is string => Boolean(value));
}

afterEach(() => {
  process.env = { ...SAVED_ENV };
  vi.resetModules();
});

describe('presigned storage URLs in analytics', () => {
  it('redacts the signature and credential of an S3-compatible (MinIO) presigned link', async () => {
    const url = await mintPresignedGetUrl({
      STORAGE_S3_ENDPOINT: 'http://minio.local:9000',
      STORAGE_S3_BUCKET: 'alga-docs',
      STORAGE_S3_ACCESS_KEY: 'AKIAEXAMPLEACCESS',
      STORAGE_S3_SECRET_KEY: 'example-secret-key',
    });
    const secrets = signingValues(url);
    expect(secrets).toHaveLength(2);

    const redacted = redactSecretQueryValues(url);
    for (const secret of secrets) expect(redacted).not.toContain(secret);
    expect(redacted).toContain('X-Amz-Signature=redacted');
    expect(redacted).toContain('X-Amz-Credential=redacted');
    expect(redacted).toContain('/alga-docs/tenants/t1/documents/contract.pdf');
    expect(redacted).toContain('X-Amz-Expires=900');
  });

  it('redacts the session token of an AWS presigned link signed with temporary credentials', async () => {
    const url = await mintPresignedGetUrl({
      STORAGE_S3_BUCKET: 'alga-docs',
      STORAGE_S3_REGION: 'us-west-2',
      AWS_ACCESS_KEY_ID: 'ASIAEXAMPLETEMP',
      AWS_SECRET_ACCESS_KEY: 'example-temp-secret',
      AWS_SESSION_TOKEN: 'example-session-token-value',
    });
    const secrets = signingValues(url);
    expect(secrets).toHaveLength(3);

    const event = redactCaptureResult({
      properties: {
        $current_url: url,
        $elements: [{ attr__href: url, text: 'Download' }],
        $elements_chain: `a:attr__href="${url}"`,
      },
    });
    const sent = JSON.stringify(event);
    for (const secret of secrets) expect(sent).not.toContain(secret);
    expect(sent).not.toContain('example-session-token-value');
  });
});
