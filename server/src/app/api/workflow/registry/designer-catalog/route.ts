import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError, runWorkflowV2RouteWithAuth } from 'server/src/lib/api/workflowRuntimeV2Api';
import { listWorkflowDesignerActionCatalogAction } from '@alga-psa/workflows/actions';

export async function GET(req: NextRequest) {
  try {
    const catalog = await runWorkflowV2RouteWithAuth(req, () => listWorkflowDesignerActionCatalogAction());
    return NextResponse.json(catalog);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
