import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { uninstallExtensionV2 } from '@ee/lib/actions/extRegistryV2Actions';
import { withApiKeyAuth } from '@/lib/api/middleware/apiAuthMiddleware';
import {
  ApiRequest,
  createSuccessResponse,
  handleApiError,
  withPermission,
  withValidation,
} from '@/lib/api/middleware/apiMiddleware';

const uninstallRequestSchema = z.object({
  registryId: z.string().min(1, 'registryId is required'),
});

type UninstallRequestBody = z.infer<typeof uninstallRequestSchema>;

const uninstallHandler = withPermission('extension', 'write')(
  withValidation(uninstallRequestSchema)(async (req: ApiRequest, body: UninstallRequestBody) => {
    const result = await uninstallExtensionV2(body.registryId);

    return createSuccessResponse(
      {
        registryId: body.registryId,
        success: result.success,
        message: result.message,
      },
      200,
    );
  }),
);

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const handler = await withApiKeyAuth(uninstallHandler);
    return await handler(request);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
