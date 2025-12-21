import { NextRequest, NextResponse } from 'next/server';
import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import WorkflowRunModelV2 from '@shared/workflow/persistence/workflowRunModelV2';
import WorkflowRunWaitModelV2 from '@shared/workflow/persistence/workflowRunWaitModelV2';

export async function POST(_req: NextRequest, { params }: { params: { runId: string } }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { knex } = await createTenantKnex();
  await WorkflowRunModelV2.update(knex, params.runId, {
    status: 'CANCELED',
    node_path: null,
    completed_at: new Date().toISOString()
  });

  // Mark waits as canceled
  const waits = await knex('workflow_run_waits').where({ run_id: params.runId, status: 'WAITING' });
  for (const wait of waits) {
    await WorkflowRunWaitModelV2.update(knex, wait.wait_id, { status: 'CANCELED', resolved_at: new Date().toISOString() });
  }

  return NextResponse.json({ ok: true });
}
