import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { initializeWorkflowRuntimeV2, getSchemaRegistry } from '@shared/workflow/runtime';

export async function GET(_req: NextRequest, { params }: { params: { schemaRef: string } }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  initializeWorkflowRuntimeV2();
  const registry = getSchemaRegistry();
  const ref = decodeURIComponent(params.schemaRef);
  if (!registry.has(ref)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ ref, schema: registry.toJsonSchema(ref) });
}
