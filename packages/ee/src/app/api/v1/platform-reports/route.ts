// Community Edition stub for platform reports API
// This feature is only available in Enterprise Edition

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const eeUnavailable = () => NextResponse.json(
  { success: false, error: 'Platform reports are only available in Enterprise Edition.' },
  { status: 501 }
);

export async function GET(_request: NextRequest): Promise<NextResponse> {
  return eeUnavailable();
}

export async function POST(_request: NextRequest): Promise<NextResponse> {
  return eeUnavailable();
}
