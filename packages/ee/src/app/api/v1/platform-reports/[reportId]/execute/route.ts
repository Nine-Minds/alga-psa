// Community Edition stub for platform reports execute API
// This feature is only available in Enterprise Edition

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ reportId: string }>;
}

export async function POST(_request: NextRequest, _context: RouteContext): Promise<NextResponse> {
  return NextResponse.json(
    { success: false, error: 'Platform reports are only available in Enterprise Edition.' },
    { status: 501 }
  );
}
