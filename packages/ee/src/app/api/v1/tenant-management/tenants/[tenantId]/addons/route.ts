// Community Edition stub for tenant add-on management API
// This feature is only available in Enterprise Edition

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

export async function POST(_request: NextRequest, _context: RouteContext): Promise<NextResponse> {
  return NextResponse.json(
    { success: false, error: 'Tenant management is only available in Enterprise Edition.' },
    { status: 501 }
  );
}
