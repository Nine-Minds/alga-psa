import { NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { getWorkflowEventAction } from '@alga-psa/workflows/actions';

export async function GET(_: Request, { params }: { params: { eventId: string } }) {
  try {
    const event = await getWorkflowEventAction({ eventId: params.eventId });
    return NextResponse.json(event);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
