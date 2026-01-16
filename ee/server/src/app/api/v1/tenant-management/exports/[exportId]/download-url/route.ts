import { NextRequest, NextResponse } from 'next/server';

interface RouteContext {
  params: Promise<{ exportId: string }>;
}

/**
 * POST /api/v1/tenant-management/exports/[exportId]/download-url
 *
 * @deprecated Download URLs are no longer generated. Exports should be
 * accessed directly from MinIO using the bucket and s3Key returned by
 * the export workflow.
 */
export async function POST(req: NextRequest, context: RouteContext) {
  const { exportId } = await context.params;

  return NextResponse.json({
    success: false,
    error: 'Download URL generation is no longer supported. Access exports directly from MinIO using the bucket and s3Key provided in the export response.',
    exportId,
  }, { status: 410 }); // 410 Gone
}
