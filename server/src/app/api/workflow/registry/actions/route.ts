import { NextResponse } from 'next/server';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { initializeWorkflowRuntimeV2, getActionRegistryV2 } from '@shared/workflow/runtime';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  initializeWorkflowRuntimeV2();
  const registry = getActionRegistryV2();
  const actions = registry.list().map((action) => ({
    id: action.id,
    version: action.version,
    sideEffectful: action.sideEffectful,
    retryHint: action.retryHint ?? null,
    idempotency: action.idempotency,
    ui: action.ui,
    inputSchema: zodToJsonSchema(action.inputSchema, { name: `${action.id}@${action.version}.input` }),
    outputSchema: zodToJsonSchema(action.outputSchema, { name: `${action.id}@${action.version}.output` }),
    examples: action.examples ?? null
  }));

  return NextResponse.json(actions);
}
