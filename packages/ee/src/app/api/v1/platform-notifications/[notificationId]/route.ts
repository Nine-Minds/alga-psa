// Community Edition stub for platform notifications [notificationId] API
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const eeUnavailable = () => NextResponse.json(
  { success: false, error: 'Platform notifications are only available in Enterprise Edition.' },
  { status: 501 }
);

type RouteContext = { params: Promise<{ notificationId: string }> };

export async function GET(_request: NextRequest, _context: RouteContext): Promise<NextResponse> {
  return eeUnavailable();
}

export async function POST(_request: NextRequest, _context: RouteContext): Promise<NextResponse> {
  return eeUnavailable();
}

export async function PUT(_request: NextRequest, _context: RouteContext): Promise<NextResponse> {
  return eeUnavailable();
}

export async function DELETE(_request: NextRequest, _context: RouteContext): Promise<NextResponse> {
  return eeUnavailable();
}
