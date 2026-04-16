import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { handleApiError, ValidationError } from '@/lib/api/middleware/apiMiddleware';
import { emailHasExistingTenant } from '@/lib/iap/checkEmailExists';

/**
 * POST /api/v1/mobile/iap/check-email
 *
 * Pre-purchase email availability check called by the iOS app before kicking
 * off a StoreKit subscription. The mobile client uses the result to refuse
 * the purchase upfront if the email is already in use, so users don't get
 * charged by Apple and then fail to provision.
 *
 * Returns { exists: boolean }. We deliberately do NOT return tenantId or
 * tenantName — this endpoint is unauthenticated by design (the caller has no
 * account yet) and we don't want it to leak existing-customer info to anyone
 * who can hit it.
 *
 * Body: { email: string }
 * Response: 200 { exists: boolean } | 400 validation error
 */

const checkEmailSchema = z.object({
  email: z.string().email(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => ({}));
    const { email } = checkEmailSchema.parse(body);

    const exists = await emailHasExistingTenant(email);
    return NextResponse.json({ exists });
  } catch (error) {
    if (error instanceof ZodError) {
      return handleApiError(new ValidationError('Validation failed', error.errors));
    }
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
