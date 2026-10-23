import { NextResponse } from 'next/server';
import { buildAndroidAssetLinks } from '@/lib/mobileAppLinks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Android verifies this on app install; it must be unauthenticated JSON without a redirect.
export async function GET(): Promise<NextResponse> {
  const body = buildAndroidAssetLinks();
  if (!body) return new NextResponse(null, { status: 404 });
  return NextResponse.json(body, {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
  });
}
