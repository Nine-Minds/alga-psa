import { describe, expect, it } from 'vitest';
import { S3StorageProvider as EeSeam } from '@/lib/storage/providers/S3StorageProvider';
import { S3StorageProvider } from '@alga-psa/storage/providers/S3StorageProvider';

// The EE S3 provider path is a thin re-export of the single implementation in @alga-psa/storage.
// Stream/size/no-retry behaviour is covered in packages/storage/tests (s3StorageProvider.*.test.ts
// and writeSession.contract.test.ts).
describe('EE S3StorageProvider registration seam', () => {
  it('resolves to the one real S3 provider implementation', () => {
    expect(EeSeam).toBe(S3StorageProvider);
  });
});
