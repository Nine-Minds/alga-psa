import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { handleApiError, ValidationError } from '@/lib/api/middleware/apiMiddleware';
import { refreshMobileSession, refreshSessionSchema } from '@/lib/mobileAuth/mobileAuthService';
import { enforceMobileRefreshLimit } from '@/lib/security/mobileAuthRateLimiting';

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip')?.trim() ||
    'unknown'
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await enforceMobileRefreshLimit(getClientIp(req));
    const body = await req.json().catch(() => ({}));
    const parsed = refreshSessionSchema.parse(body);
    const result = await refreshMobileSession(parsed);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return handleApiError(new ValidationError('Validation failed', error.errors));
    }
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
