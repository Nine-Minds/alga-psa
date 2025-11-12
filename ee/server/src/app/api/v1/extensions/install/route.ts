import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { installExtensionForCurrentTenantV2 } from '@ee/lib/actions/extRegistryV2Actions';
import { withApiKeyAuth } from '@/lib/api/middleware/apiAuthMiddleware';
import {
  ApiRequest,
  createSuccessResponse,
  handleApiError,
  withPermission,
  withValidation,
} from '@/lib/api/middleware/apiMiddleware';

const installRequestSchema = z.object({
  registryId: z.string().min(1, 'registryId is required'),
  version: z.string().min(1, 'version is required'),
});

type InstallRequestBody = z.infer<typeof installRequestSchema>;

const installHandler = withPermission('extension', 'write')(
  withValidation(installRequestSchema)(async (req: ApiRequest, body: InstallRequestBody) => {
    const result = await installExtensionForCurrentTenantV2(body);

    return createSuccessResponse(
      {
        registryId: body.registryId,
        version: body.version,
        installId: result.installId ?? null,
        success: result.success,
        message: 'Extension installation enqueued',
      },
      202,
    );
  }),
);

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const handler = await withApiKeyAuth(installHandler);
    return await handler(request);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
