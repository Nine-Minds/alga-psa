import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError, runWorkflowV2RouteWithAuth } from 'server/src/lib/api/workflowRuntimeV2Api';
import {
  createWorkflowDefinitionAction,
  listWorkflowDefinitionsAction
} from '@alga-psa/workflows/actions';

export async function GET(req: NextRequest) {
  try {
    const definitions = await runWorkflowV2RouteWithAuth(req, () => listWorkflowDefinitionsAction());
    return NextResponse.json(definitions);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await runWorkflowV2RouteWithAuth(req, () => createWorkflowDefinitionAction(body));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
