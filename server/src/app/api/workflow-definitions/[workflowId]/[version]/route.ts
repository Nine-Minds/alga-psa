import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { initializeWorkflowRuntimeV2, workflowDefinitionSchema } from '@shared/workflow/runtime';
import WorkflowDefinitionModelV2 from '@shared/workflow/persistence/workflowDefinitionModelV2';
import WorkflowDefinitionVersionModelV2 from '@shared/workflow/persistence/workflowDefinitionVersionModelV2';

const UpdateWorkflowSchema = z.object({
  definition: workflowDefinitionSchema
});

export async function GET(_req: NextRequest, { params }: { params: { workflowId: string; version: string } }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { knex } = await createTenantKnex();
  const version = Number(params.version);
  const record = await WorkflowDefinitionVersionModelV2.getByWorkflowAndVersion(knex, params.workflowId, version);
  if (!record) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json(record);
}

export async function PUT(req: NextRequest, { params }: { params: { workflowId: string; version: string } }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  initializeWorkflowRuntimeV2();
  const body = await req.json();
  const parsed = UpdateWorkflowSchema.parse(body);

  const { knex } = await createTenantKnex();
  const definition = { ...parsed.definition, id: params.workflowId };

  const updated = await WorkflowDefinitionModelV2.update(knex, params.workflowId, {
    draft_definition: definition,
    draft_version: definition.version,
    updated_by: user.user_id,
    name: definition.name,
    description: definition.description ?? null,
    payload_schema_ref: definition.payloadSchemaRef,
    trigger: definition.trigger ?? null
  });

  return NextResponse.json(updated);
}
