import { NextRequest, NextResponse } from 'next/server';
import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { initializeWorkflowRuntimeV2, WorkflowRuntimeV2 } from '@shared/workflow/runtime';
import WorkflowRunModelV2 from '@shared/workflow/persistence/workflowRunModelV2';

export async function POST(_req: NextRequest, { params }: { params: { runId: string } }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  initializeWorkflowRuntimeV2();
  const { knex } = await createTenantKnex();
  await WorkflowRunModelV2.update(knex, params.runId, { status: 'RUNNING' });

  const runtime = new WorkflowRuntimeV2();
  await runtime.executeRun(knex, params.runId, `admin-${user.user_id}`);

  return NextResponse.json({ ok: true });
}
