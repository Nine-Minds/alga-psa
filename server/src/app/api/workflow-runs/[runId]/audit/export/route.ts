import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { exportWorkflowAuditLogsAction } from '@alga-psa/workflows/actions';

export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const resolvedParams = await params;
    const format = req.nextUrl.searchParams.get('format') ?? 'json';
    const result = await exportWorkflowAuditLogsAction({
      tableName: 'workflow_runs',
      recordId: resolvedParams.runId,
      format
    });
    return new NextResponse(result.body, {
      headers: {
        'Content-Type': result.contentType,
        'Content-Disposition': `attachment; filename=${result.filename}`
      }
    });
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
