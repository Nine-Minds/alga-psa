import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { exportWorkflowAuditLogsAction } from 'server/src/lib/actions/workflow-runtime-v2-actions';

export async function GET(req: NextRequest, { params }: { params: { runId: string } }) {
  try {
    const format = req.nextUrl.searchParams.get('format') ?? 'json';
    const result = await exportWorkflowAuditLogsAction({
      tableName: 'workflow_runs',
      recordId: params.runId,
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
