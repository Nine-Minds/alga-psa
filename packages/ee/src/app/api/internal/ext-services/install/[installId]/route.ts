// Community Edition stub for extension service read API
// This feature is only available in Enterprise Edition

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function POST(
  _req: NextRequest,
  _ctx: { params?: unknown }
): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'Extension service reads are only available in the Enterprise Edition.', code: 'EE_REQUIRED' },
    { status: 501 }
  );
}
