import type { NextRequest } from 'next/server';
import { GET as enterpriseGET } from '@enterprise/app/api/billing/check-tenant/route';

// Config + handler must be defined directly here: Next's webpack production
// build does not register *re-exported* route handlers (`export { GET } from …`),
// only direct exports. The handler delegates to the EE implementation.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return enterpriseGET(req);
}
