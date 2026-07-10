import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { workflowDefinitionSchema } from '@alga-psa/workflows/runtime';
import { simulateWorkflowDefinition } from 'shared/workflow/runtime/simulation/simulator';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const definition = workflowDefinitionSchema.parse(body.definition);
    const result = await simulateWorkflowDefinition({
      definition,
      payload: body.payload
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
