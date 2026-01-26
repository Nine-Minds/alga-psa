// Community Edition stub for extension invoicing API
// This feature is only available in Enterprise Edition

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function POST(
  _req: NextRequest,
  _ctx: { params?: unknown }
): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'Extension invoicing is only available in the Enterprise Edition.', code: 'EE_REQUIRED' },
    { status: 501 }
  );
}
