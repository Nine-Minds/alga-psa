import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';
import { getCapabilitiesResponse } from '@/lib/mobileAuth/mobileAuthService';

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(getCapabilitiesResponse());
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

