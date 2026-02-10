// Community Edition stub for platform feature flags single flag API
// This feature is only available in Enterprise Edition

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ flagId: string }>;
}

const eeUnavailable = () => NextResponse.json(
  { success: false, error: 'Feature flag management is only available in Enterprise Edition.' },
  { status: 501 }
);

export async function GET(_request: NextRequest, _context: RouteContext): Promise<NextResponse> {
  return eeUnavailable();
}

export async function POST(_request: NextRequest, _context: RouteContext): Promise<NextResponse> {
  return eeUnavailable();
}

export async function PATCH(_request: NextRequest, _context: RouteContext): Promise<NextResponse> {
  return eeUnavailable();
}

export async function DELETE(_request: NextRequest, _context: RouteContext): Promise<NextResponse> {
  return eeUnavailable();
}
