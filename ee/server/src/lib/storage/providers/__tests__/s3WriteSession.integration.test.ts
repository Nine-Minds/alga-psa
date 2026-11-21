/**
 * Shared resumable write-session contract against a real S3-compatible service.
 *
 * Runs in the workspace-runtime lane, whose CI job starts a disposable MinIO and exports the
 * STORAGE_S3_* variables below. Missing configuration is a setup failure, never a skipped run.
 *
 * Environment:
 * - STORAGE_S3_ENDPOINT (required; isolated S3-compatible test service)
 * - STORAGE_S3_ACCESS_KEY, STORAGE_S3_SECRET_KEY (required)
 * - STORAGE_S3_REGION (required)
 * - STORAGE_S3_BUCKET (required; created if missing; objects go under write-session-contract/)
 *
 * The provider is constructed through this EE registration seam, so the test also proves the
 * seam still resolves to the single @alga-psa/storage implementation.
 */
import { S3StorageProvider } from '../S3StorageProvider';
import {
  defineWriteSessionContract,
  s3WriteSessionHarness,
  type S3WriteSessionTarget,
} from '@alga-psa/storage/testing/writeSessionContract';

function requiredS3Target(): S3WriteSessionTarget {
  const read = (name: string) => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`S3 write-session integration test requires ${name}`);
    return value;
  };
  return {
    endpoint: read('STORAGE_S3_ENDPOINT'),
    accessKey: read('STORAGE_S3_ACCESS_KEY'),
    secretKey: read('STORAGE_S3_SECRET_KEY'),
    region: read('STORAGE_S3_REGION'),
    bucket: read('STORAGE_S3_BUCKET'),
  };
}

defineWriteSessionContract(s3WriteSessionHarness(requiredS3Target, (config) => new S3StorageProvider(config)));
