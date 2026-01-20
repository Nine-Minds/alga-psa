// Community Edition stub for platform reports single report API
// This feature is only available in Enterprise Edition

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ reportId: string }>;
}

const eeUnavailable = () => NextResponse.json(
  { success: false, error: 'Platform reports are only available in Enterprise Edition.' },
  { status: 501 }
);

export async function GET(_request: NextRequest, _context: RouteContext): Promise<NextResponse> {
  return eeUnavailable();
}

export async function PUT(_request: NextRequest, _context: RouteContext): Promise<NextResponse> {
  return eeUnavailable();
}

export async function DELETE(_request: NextRequest, _context: RouteContext): Promise<NextResponse> {
  return eeUnavailable();
}
