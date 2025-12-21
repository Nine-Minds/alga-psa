import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { initializeWorkflowRuntimeV2, WorkflowRuntimeV2 } from '@shared/workflow/runtime';
import WorkflowRunWaitModelV2 from '@shared/workflow/persistence/workflowRunWaitModelV2';
import WorkflowRunModelV2 from '@shared/workflow/persistence/workflowRunModelV2';
import WorkflowRuntimeEventModelV2 from '@shared/workflow/persistence/workflowRuntimeEventModelV2';
import WorkflowDefinitionModelV2 from '@shared/workflow/persistence/workflowDefinitionModelV2';
import WorkflowDefinitionVersionModelV2 from '@shared/workflow/persistence/workflowDefinitionVersionModelV2';

const SubmitEventSchema = z.object({
  eventName: z.string(),
  correlationKey: z.string(),
  payload: z.record(z.any()).default({})
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  initializeWorkflowRuntimeV2();
  const body = await req.json();
  const parsed = SubmitEventSchema.parse(body);

  const { knex, tenant } = await createTenantKnex();
  let runId: string | null = null;

  await knex.transaction(async (trx) => {
    await WorkflowRuntimeEventModelV2.create(trx, {
      tenant_id: tenant,
      event_name: parsed.eventName,
      correlation_key: parsed.correlationKey,
      payload: parsed.payload
    });

    const wait = await WorkflowRunWaitModelV2.findEventWait(trx, parsed.eventName, parsed.correlationKey);
    if (!wait) {
      return;
    }

    await WorkflowRunWaitModelV2.update(trx, wait.wait_id, {
      status: 'RESOLVED',
      resolved_at: new Date().toISOString()
    });

    await WorkflowRunModelV2.update(trx, wait.run_id, {
      status: 'RUNNING',
      resume_event_name: parsed.eventName,
      resume_event_payload: parsed.payload
    });

    runId = wait.run_id;
  });

  const runtime = new WorkflowRuntimeV2();
  if (runId) {
    await runtime.executeRun(knex, runId, `event-${Date.now()}`);
  }

  // Start new runs for workflows triggered by this event
  const triggered = await WorkflowDefinitionModelV2.list(knex);
  const matching = triggered.filter((workflow) => workflow.trigger?.eventName === parsed.eventName && workflow.status === 'published');

  const startedRuns: string[] = [];
  for (const workflow of matching) {
    const versions = await WorkflowDefinitionVersionModelV2.listByWorkflow(knex, workflow.workflow_id);
    const latest = versions[0];
    if (!latest) continue;
    const newRunId = await runtime.startRun(knex, {
      workflowId: workflow.workflow_id,
      version: latest.version,
      payload: parsed.payload,
      tenantId: tenant
    });
    startedRuns.push(newRunId);
    await runtime.executeRun(knex, newRunId, `event-${Date.now()}`);
  }

  return NextResponse.json({ status: runId ? 'resumed' : 'no_wait', runId, startedRuns });
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { knex } = await createTenantKnex();
  const events = await WorkflowRuntimeEventModelV2.list(knex);
  return NextResponse.json(events);
}
