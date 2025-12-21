import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { initializeWorkflowRuntimeV2, validateWorkflowDefinition, getSchemaRegistry } from '@shared/workflow/runtime';
import WorkflowDefinitionModelV2 from '@shared/workflow/persistence/workflowDefinitionModelV2';
import WorkflowDefinitionVersionModelV2 from '@shared/workflow/persistence/workflowDefinitionVersionModelV2';

const PublishSchema = z.object({
  definition: z.record(z.any()).optional()
});

export async function POST(req: NextRequest, { params }: { params: { workflowId: string; version: string } }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  initializeWorkflowRuntimeV2();
  const body = await req.json().catch(() => ({}));
  const parsed = PublishSchema.parse(body ?? {});

  const { knex } = await createTenantKnex();
  const workflow = await WorkflowDefinitionModelV2.getById(knex, params.workflowId);
  if (!workflow) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const definition = { ...(parsed.definition as any ?? workflow.draft_definition), id: params.workflowId };
  if (!definition) {
    return NextResponse.json({ error: 'No definition to publish' }, { status: 400 });
  }

  const schemaRegistry = getSchemaRegistry();
  if (!schemaRegistry.has(definition.payloadSchemaRef)) {
    return NextResponse.json({
      ok: false,
      errors: [{ severity: 'error', stepPath: 'root', code: 'UNKNOWN_SCHEMA', message: `Unknown schema ref ${definition.payloadSchemaRef}` }]
    }, { status: 400 });
  }
  const payloadSchemaJson = schemaRegistry.toJsonSchema(definition.payloadSchemaRef);

  const validation = validateWorkflowDefinition(definition, payloadSchemaJson as Record<string, unknown>);
  if (!validation.ok) {
    return NextResponse.json({ ok: false, errors: validation.errors, warnings: validation.warnings });
  }

  const version = Number(params.version || definition.version);
  const record = await WorkflowDefinitionVersionModelV2.create(knex, {
    workflow_id: params.workflowId,
    version,
    definition_json: definition,
    payload_schema_json: payloadSchemaJson as Record<string, unknown>,
    published_by: user.user_id,
    published_at: new Date().toISOString()
  });

  await WorkflowDefinitionModelV2.update(knex, params.workflowId, {
    status: 'published',
    updated_by: user.user_id
  });

  return NextResponse.json({ ok: true, publishedVersion: record.version, errors: [], warnings: validation.warnings });
}
