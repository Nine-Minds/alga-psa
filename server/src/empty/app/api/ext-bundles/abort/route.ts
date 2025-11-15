// Community Edition stub for extension bundle abort API
// This feature is only available in Enterprise Edition

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'Extension bundle abort is only available in the Enterprise Edition.' },
    { status: 501 }
  );
}
