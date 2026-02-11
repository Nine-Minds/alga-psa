import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const originalEnv = { ...process.env };

describe('s3-client getBundleBucket', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses STORAGE_S3_BUNDLE_BUCKET when provided', async () => {
    process.env.STORAGE_S3_REGION = 'us-east-1';
    process.env.STORAGE_S3_BUCKET = 'default-bucket';
    process.env.STORAGE_S3_BUNDLE_BUCKET = 'bundles-bucket';

    const { getBundleBucket } = await import('../../lib/storage/s3-client');
    expect(getBundleBucket()).toBe('bundles-bucket');
  });

  it('falls back to STORAGE_S3_BUCKET when bundle bucket override is not set', async () => {
    process.env.STORAGE_S3_REGION = 'us-east-1';
    process.env.STORAGE_S3_BUCKET = 'default-bucket';
    delete process.env.STORAGE_S3_BUNDLE_BUCKET;

    const { getBundleBucket } = await import('../../lib/storage/s3-client');
    expect(getBundleBucket()).toBe('default-bucket');
  });
});

describe('s3-client getS3Config region resolution', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('defaults region to us-east-1 for MinIO/custom endpoint when STORAGE_S3_REGION is unset', async () => {
    process.env.STORAGE_S3_ENDPOINT = 'http://localhost:9000';
    process.env.STORAGE_S3_BUCKET = 'default-bucket';
    process.env.STORAGE_S3_ACCESS_KEY = 'minio';
    process.env.STORAGE_S3_SECRET_KEY = 'miniosecret';
    delete process.env.STORAGE_S3_REGION;

    const { getS3Config } = await import('../../lib/storage/s3-client');
    expect(getS3Config().region).toBe('us-east-1');
  });

  it('uses AWS_REGION fallback when STORAGE_S3_REGION is unset', async () => {
    process.env.STORAGE_S3_BUCKET = 'default-bucket';
    process.env.AWS_REGION = 'us-west-2';
    delete process.env.STORAGE_S3_REGION;

    const { getS3Config } = await import('../../lib/storage/s3-client');
    expect(getS3Config().region).toBe('us-west-2');
  });
});
