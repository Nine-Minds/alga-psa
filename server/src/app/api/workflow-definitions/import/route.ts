import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { importWorkflowBundleV1Action } from 'server/src/lib/actions/workflow-runtime-v2-actions';

const parseBoolean = (value: string | null): boolean | undefined => {
  if (value === null) return undefined;
  if (value === '1' || value.toLowerCase() === 'true') return true;
  if (value === '0' || value.toLowerCase() === 'false') return false;
  return undefined;
};

export async function POST(req: NextRequest) {
  try {
    const bundle = await req.json();
    const force = parseBoolean(req.nextUrl.searchParams.get('force'));
    const summary = await importWorkflowBundleV1Action({ bundle, force });
    return NextResponse.json(summary, { status: 200 });
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}

