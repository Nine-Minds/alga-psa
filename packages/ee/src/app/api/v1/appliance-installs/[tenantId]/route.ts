// Community Edition stub for appliance installs [tenantId] API
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const eeUnavailable = () => NextResponse.json(
  { success: false, error: 'Appliance console is only available in Enterprise Edition.' },
  { status: 501 }
);

type RouteContext = { params: Promise<{ tenantId: string }> };

export async function GET(_request: NextRequest, _context: RouteContext): Promise<NextResponse> {
  return eeUnavailable();
}
