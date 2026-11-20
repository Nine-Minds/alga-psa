// Community Edition stub: the shared Stripe offer catalog and its billing write paths are platform (EE) only.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_request: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    { success: false, error: 'The billing catalog is only available in Enterprise Edition.' },
    { status: 501 },
  );
}
