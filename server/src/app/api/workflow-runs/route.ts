import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { initializeWorkflowRuntimeV2, WorkflowRuntimeV2 } from '@shared/workflow/runtime';
import WorkflowRunModelV2 from '@shared/workflow/persistence/workflowRunModelV2';

const StartRunSchema = z.object({
  workflowId: z.string(),
  workflowVersion: z.number().int().positive(),
  payload: z.record(z.any()).default({})
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  initializeWorkflowRuntimeV2();
  const body = await req.json();
  const parsed = StartRunSchema.parse(body);

  const { knex, tenant } = await createTenantKnex();
  const runtime = new WorkflowRuntimeV2();

  const runId = await runtime.startRun(knex, {
    workflowId: parsed.workflowId,
    version: parsed.workflowVersion,
    payload: parsed.payload,
    tenantId: tenant
  });

  await runtime.executeRun(knex, runId, `api-${Date.now()}`);

  const run = await WorkflowRunModelV2.getById(knex, runId);
  return NextResponse.json({ runId, status: run?.status });
}
