import { NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { getWorkflowAuthoringGuideAction } from '@alga-psa/workflows/actions';

export async function GET() {
  try {
    const result = await getWorkflowAuthoringGuideAction();
    return NextResponse.json(result);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
