import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { listWorkflowAuditLogsAction } from 'server/src/lib/actions/workflow-runtime-v2-actions';

export async function GET(req: NextRequest, { params }: { params: { workflowId: string } }) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const result = await listWorkflowAuditLogsAction({
      tableName: 'workflow_definitions',
      recordId: params.workflowId,
      limit: searchParams.get('limit') ?? undefined,
      cursor: searchParams.get('cursor') ?? undefined
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
