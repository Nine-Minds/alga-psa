import { getSession } from '@alga-psa/auth';
import { capabilityRouteGuard, notFoundResponse } from '@alga-psa/core/capability/server';
import { handleCoManagedPortableExport } from '@ee/lib/co-managed/portableExportHandler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The capability is checked first, with the tenant taken from the session, so a closed
 * capability answers with the exact 404 of a missing record and reads nothing else. */
export async function POST(request: Request) {
  const session = await getSession();
  const tenant = session?.user?.tenant;
  if (!tenant || session.user.user_type !== 'internal') return notFoundResponse();
  const closed = await capabilityRouteGuard('co-managed', tenant, 'serves');
  if (closed) return closed;
  return handleCoManagedPortableExport(request);
}
