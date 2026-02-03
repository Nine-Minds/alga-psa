import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { handleApiError, ValidationError } from '@/lib/api/middleware/apiMiddleware';
import { exchangeOttForSession, exchangeOttSchema } from '@/lib/mobileAuth/mobileAuthService';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = exchangeOttSchema.parse(body);
    const result = await exchangeOttForSession(parsed);
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

