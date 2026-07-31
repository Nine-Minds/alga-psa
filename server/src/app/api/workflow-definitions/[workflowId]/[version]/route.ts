import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError, runWorkflowV2RouteWithAuth } from 'server/src/lib/api/workflowRuntimeV2Api';
import {
  getWorkflowDefinitionVersionAction,
  updateWorkflowDefinitionDraftAction
} from '@alga-psa/workflows/actions';

export async function GET(req: NextRequest, { params }: { params: Promise<{ workflowId: string; version: string }> }) {
  try {
    const resolvedParams = await params;
    const record = await runWorkflowV2RouteWithAuth(req, () => getWorkflowDefinitionVersionAction({
      workflowId: resolvedParams.workflowId,
      version: resolvedParams.version
    }));
    return NextResponse.json(record);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ workflowId: string; version: string }> }) {
  try {
    const resolvedParams = await params;
    const body = await req.json();
    const updated = await runWorkflowV2RouteWithAuth(req, () => updateWorkflowDefinitionDraftAction({
      workflowId: resolvedParams.workflowId,
      definition: body?.definition ?? body,
      expectedDraftVersion: body?.expectedDraftVersion
    }));
    return NextResponse.json(updated);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
