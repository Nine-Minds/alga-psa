// Community Edition stub for extension bundle upload-proxy API
// This feature is only available in Enterprise Edition

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'Extension bundle upload-proxy is only available in the Enterprise Edition.' },
    { status: 501 }
  );
}
