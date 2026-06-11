import type { NextRequest } from 'next/server';
import { POST as enterprisePOST } from '@enterprise/app/api/billing/reactivation-token/session/route';

// Config + handler must be defined directly here: Next's webpack production
// build does not register *re-exported* route handlers (`export { POST } from …`),
// only direct exports. The handler delegates to the EE implementation.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  return enterprisePOST(req);
}
