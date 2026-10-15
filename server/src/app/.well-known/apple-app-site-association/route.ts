import { NextResponse } from 'next/server';
import { buildAppleAppSiteAssociation } from '@/lib/mobileAppLinks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Apple fetches this on app install; it must be unauthenticated JSON without a redirect.
export async function GET(): Promise<NextResponse> {
  const body = buildAppleAppSiteAssociation();
  if (!body) return new NextResponse(null, { status: 404 });
  return NextResponse.json(body, {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
  });
}
