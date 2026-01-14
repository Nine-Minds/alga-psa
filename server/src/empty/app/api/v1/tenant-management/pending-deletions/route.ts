// Community Edition stub for pending tenant deletions API
// This feature is only available in Enterprise Edition

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    { success: false, error: 'Tenant management is only available in Enterprise Edition.' },
    { status: 501 }
  );
}
