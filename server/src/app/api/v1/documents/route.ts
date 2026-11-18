import { NextRequest, NextResponse } from 'next/server';
import { withApiKeyAuth } from '@/lib/api/middleware/apiAuthMiddleware';
import { ApiDocumentController } from 'server/src/lib/api/controllers/ApiDocumentController';

const controller = new ApiDocumentController();

/** POST /api/v1/documents - attach a file (https URL or base64) to a ticket, project task, client, contact or asset. */
export const POST = controller.attach();

export async function GET(request: NextRequest) {
  const handler = await withApiKeyAuth(async () => {
    return NextResponse.json({
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint not implemented',
      },
    }, { status: 404 });
  });

  return handler(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
