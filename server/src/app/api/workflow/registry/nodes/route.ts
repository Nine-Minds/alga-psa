import { NextResponse } from 'next/server';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { initializeWorkflowRuntimeV2, getNodeTypeRegistry } from '@shared/workflow/runtime';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  initializeWorkflowRuntimeV2();
  const registry = getNodeTypeRegistry();
  const nodes = registry.list().map((node) => ({
    id: node.id,
    ui: node.ui,
    configSchema: zodToJsonSchema(node.configSchema, { name: node.id }),
    examples: node.examples ?? null,
    defaultRetry: node.defaultRetry ?? null
  }));

  return NextResponse.json(nodes);
}
