import { NextRequest, NextResponse } from 'next/server';
import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import WorkflowRunStepModelV2 from '@shared/workflow/persistence/workflowRunStepModelV2';
import WorkflowRunSnapshotModelV2 from '@shared/workflow/persistence/workflowRunSnapshotModelV2';

export async function GET(_req: NextRequest, { params }: { params: { runId: string } }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { knex } = await createTenantKnex();
  const steps = await WorkflowRunStepModelV2.listByRun(knex, params.runId);
  const snapshots = await WorkflowRunSnapshotModelV2.listByRun(knex, params.runId);
  return NextResponse.json({ steps, snapshots });
}
