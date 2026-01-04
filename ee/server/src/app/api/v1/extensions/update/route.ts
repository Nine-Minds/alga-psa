import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { updateExtensionForCurrentTenantV2 } from '@ee/lib/actions/extRegistryV2Actions';
import { ExtensionUpdateBlockedError } from '@ee/lib/actions/extRegistryV2Errors';
import { withApiKeyAuth } from '@/lib/api/middleware/apiAuthMiddleware';
import {
  ApiRequest,
  createSuccessResponse,
  handleApiError,
  withPermission,
  withValidation,
} from '@/lib/api/middleware/apiMiddleware';

const updateRequestSchema = z.object({
  registryId: z.string().min(1, 'registryId is required'),
  version: z.string().min(1, 'version is required'),
  disableMissingSchedules: z.boolean().optional(),
});

type UpdateRequestBody = z.infer<typeof updateRequestSchema>;

const updateHandler = withPermission('extension', 'write')(
  withValidation(updateRequestSchema)(async (_req: ApiRequest, body: UpdateRequestBody) => {
    try {
      const result = await updateExtensionForCurrentTenantV2(body);
      return createSuccessResponse(
        {
          registryId: body.registryId,
          version: body.version,
          success: result.success,
          message: result.message,
        },
        200,
      );
    } catch (e) {
      if (e instanceof ExtensionUpdateBlockedError) {
        return NextResponse.json(
          {
            success: false,
            code: e.code,
            message: e.message,
            missing: e.missing,
          },
          { status: 409 },
        );
      }
      throw e;
    }
  }),
);

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const handler = await withApiKeyAuth(updateHandler);
    return await handler(request);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
