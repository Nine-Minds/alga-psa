import { NextResponse } from 'next/server';
import { createTenantKnex } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { hasPermission } from '@alga-psa/auth';
import { AmpExportService } from '@/lib/migrations/AmpExportService';

export const runtime = 'nodejs';

/**
 * Alga → AMP export of the v1 entities for the caller's tenant. Downloading a
 * package requires import_export:manage — an export contains the whole book
 * of business, which is more than read access to any one entity implies.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user?.tenant || !(await hasPermission(user, 'import_export', 'manage'))) {
    return NextResponse.json({ error: 'IMPORT_EXPORT_PERMISSION_DENIED' }, { status: 403 });
  }

  const { knex } = await createTenantKnex(user.tenant);
  const exporter = new AmpExportService(knex, user.tenant);
  const { buffer, manifest, rowCounts } = await exporter.exportTenant();

  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/vnd.sqlite3',
      'content-disposition': `attachment; filename="alga-export-${manifest.package_id}.amp"`,
      'x-amp-package-id': manifest.package_id,
      'x-amp-row-counts': JSON.stringify(rowCounts),
    },
  });
}
