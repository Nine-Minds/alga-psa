import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { handleApiError, ValidationError } from '@/lib/api/middleware/apiMiddleware';
import { refreshMobileSession, refreshSessionSchema } from '@/lib/mobileAuth/mobileAuthService';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
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

