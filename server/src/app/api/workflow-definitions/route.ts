import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { initializeWorkflowRuntimeV2, workflowDefinitionSchema } from '@shared/workflow/runtime';
import WorkflowDefinitionModelV2 from '@shared/workflow/persistence/workflowDefinitionModelV2';
import { v4 as uuidv4 } from 'uuid';

const CreateWorkflowDefinitionSchema = z.object({
  definition: workflowDefinitionSchema
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { knex } = await createTenantKnex();
  const definitions = await WorkflowDefinitionModelV2.list(knex);
  return NextResponse.json(definitions);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  initializeWorkflowRuntimeV2();
  const body = await req.json();
  const parsed = CreateWorkflowDefinitionSchema.parse(body);

  const { knex } = await createTenantKnex();
  const workflowId = uuidv4();
  const definition = { ...parsed.definition, id: workflowId };

  const record = await WorkflowDefinitionModelV2.create(knex, {
    workflow_id: workflowId,
    name: definition.name,
    description: definition.description ?? null,
    payload_schema_ref: definition.payloadSchemaRef,
    trigger: definition.trigger ?? null,
    draft_definition: definition,
    draft_version: definition.version,
    status: 'draft',
    created_by: user.user_id,
    updated_by: user.user_id
  });

  return NextResponse.json({ workflowId: record.workflow_id }, { status: 201 });
}
