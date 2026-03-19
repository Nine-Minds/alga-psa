import { NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { listWorkflowDesignerActionCatalogAction } from '@alga-psa/workflows/actions';

export async function GET() {
  try {
    const catalog = await listWorkflowDesignerActionCatalogAction();
    return NextResponse.json(catalog);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
