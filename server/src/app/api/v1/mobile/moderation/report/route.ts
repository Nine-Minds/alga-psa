import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { handleApiError, ValidationError } from '@/lib/api/middleware/apiMiddleware';
import { authenticateApiKeyRequest } from '@/lib/api/middleware/apiAuthMiddleware';
import { appendRateLimitHeaders } from '@/lib/api/rateLimit/responseHeaders';
import { getConnection } from '@/lib/db/db';

/**
 * POST /api/v1/mobile/moderation/report
 *
 * App Store guideline 1.2 — lets any authenticated user flag comment/description
 * content as objectionable. Records the report in `content_reports`; surfacing
 * + triage happens out-of-band (email/Slack to abuse@).
 *
 * Deliberately low-friction: a `reason` note is optional so the reporter isn't
 * blocked by a form. The existence of the report is the signal.
 */

const reportSchema = z.object({
  contentType: z.enum(['ticket_comment', 'ticket_description']),
  contentId: z.string().min(1).max(200).optional(),
  contentAuthorUserId: z.string().uuid().optional(),
  reason: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const apiRequest = await authenticateApiKeyRequest(req, { allowBearerToken: true });
    const { tenant, userId } = apiRequest.context!;
    const body = await req.json().catch(() => ({}));
    const parsed = reportSchema.parse(body);

    const knex = await getConnection(null);
    await knex('content_reports').insert({
      tenant,
      reporter_user_id: userId,
      content_type: parsed.contentType,
      content_id: parsed.contentId ?? null,
      content_author_user_id: parsed.contentAuthorUserId ?? null,
      reason: parsed.reason ?? null,
    });

    return appendRateLimitHeaders(NextResponse.json({ ok: true }), apiRequest);
  } catch (error) {
    if (error instanceof ZodError) {
      return handleApiError(new ValidationError('Validation failed', error.errors));
    }
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
