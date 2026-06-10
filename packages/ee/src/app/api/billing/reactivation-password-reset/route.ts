import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { error: 'Reactivation is not available in this edition' },
    { status: 400 },
  );
}
