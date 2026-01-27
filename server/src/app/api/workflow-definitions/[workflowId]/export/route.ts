import { NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { exportWorkflowBundleV1Action } from 'server/src/lib/actions/workflow-runtime-v2-actions';
import { stringifyCanonicalJson } from '@shared/workflow/bundle/canonicalJson';

export async function GET(_: Request, { params }: { params: Promise<{ workflowId: string }> }) {
  try {
    const resolvedParams = await params;
    const bundle = await exportWorkflowBundleV1Action({ workflowId: resolvedParams.workflowId });
    const body = stringifyCanonicalJson(bundle);
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="workflow-bundle.json"'
      }
    });
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
