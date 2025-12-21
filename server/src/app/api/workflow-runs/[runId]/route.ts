import { NextRequest, NextResponse } from 'next/server';
import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import WorkflowRunModelV2 from '@shared/workflow/persistence/workflowRunModelV2';

export async function GET(_req: NextRequest, { params }: { params: { runId: string } }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { knex } = await createTenantKnex();
  const run = await WorkflowRunModelV2.getById(knex, params.runId);
  if (!run) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(run);
}
