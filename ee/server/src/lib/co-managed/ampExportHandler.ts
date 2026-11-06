import { authorizeAmpWorkspaceExport } from 'server/src/lib/co-managed/ampExportAuthorization';
import { isCoManagedSharedWorkError } from '@alga-psa/co-managed/sharedWorkIdentity';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { createTenantKnex } from '@alga-psa/db';
import { withCoManagedExportAdmin } from '@alga-psa/co-managed/exportAuthorization';
import { AmpExportService } from 'server/src/lib/migrations/AmpExportService';
import { coManagedBrowserActor } from 'server/src/lib/co-managed/browserActor';

const headers = {
  'Cache-Control': 'no-store, private',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "sandbox; default-src 'none'",
};
export const ampWorkspaceExportAvailability = Object.freeze({ available: true as boolean });

/** Produce the same standards-based AMP package as the core export service.
 * The browser identity and local customer-admin capability are checked before
 * any workspace rows are read. */
export async function handleCoManagedAmpExport(): Promise<Response> {
  try {
    const user = await getCurrentUser();
    if (!user?.tenant || user.user_type !== 'internal') return new Response(null, { status: 404, headers });
    const { knex } = await createTenantKnex(user.tenant);
    const actor = await coManagedBrowserActor(user, user.tenant);
    const result = await withCoManagedExportAdmin(knex, actor, async (_retained, verified, subject) =>
      new AmpExportService(knex, verified.tenant).exportWorkspace((snapshot, rows) => authorizeAmpWorkspaceExport(snapshot, verified, subject, rows)));
    return new Response(new Uint8Array(result.buffer), {
      headers: {
        ...headers,
        'Content-Type': 'application/vnd.alga.amp+zip',
        'Content-Disposition': `attachment; filename="workspace-${result.manifest.package_id}.amp"`,
        'X-AMP-Package-Id': result.manifest.package_id,
      },
    });
  } catch (error) {
    if (isCoManagedSharedWorkError(error)) return new Response(null, { status: 404, headers });
    return Response.json({ error: 'WORKSPACE_EXPORT_FAILED' }, { status: 500, headers });
  }
}
