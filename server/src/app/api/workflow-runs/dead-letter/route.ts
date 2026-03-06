import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { listWorkflowDeadLetterRunsAction } from '@alga-psa/workflows/actions';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const result = await listWorkflowDeadLetterRunsAction({
      limit: searchParams.get('limit') ?? undefined,
      cursor: searchParams.get('cursor') ?? undefined,
      minRetries: searchParams.get('minRetries') ?? undefined
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
