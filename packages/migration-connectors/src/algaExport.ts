import { randomUUID } from 'node:crypto';
import type { AmpManifest, AmpPackageRows } from '@alga-psa/migration-spec';
import { AMP_FORMAT_VERSION } from '@alga-psa/migration-spec';
import { AmpPackageBuilder } from '@alga-psa/migration-sdk';

/**
 * Write canonical, already tenant-filtered Alga records as an AMP package.
 * This is intentionally a producer seam: it performs no server/database work.
 */
export function writeAlgaExport(
  path: string,
  records: AmpPackageRows,
  sourceInstanceId: string
): AmpManifest {
  return new AmpPackageBuilder(path).write(
    {
      format_version: AMP_FORMAT_VERSION,
      package_id: randomUUID(),
      created_at: new Date().toISOString(),
      producer_name: 'alga-export',
      producer_version: '1.0.0',
      source_system: 'alga-psa',
      source_instance_id: sourceInstanceId,
    },
    records
  );
}
