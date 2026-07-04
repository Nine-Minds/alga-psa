// Community Edition stub for appliance installs access logging API
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const eeUnavailable = () => NextResponse.json(
  { success: false, error: 'Appliance console is only available in Enterprise Edition.' },
  { status: 501 }
);

export async function POST(_request: NextRequest): Promise<NextResponse> {
  return eeUnavailable();
}
