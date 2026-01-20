// Community Edition stub for extension uninstall API
// This feature is only available in Enterprise Edition

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'Extension uninstall API is only available in the Enterprise Edition.' },
    { status: 501 }
  );
}
