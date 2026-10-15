import WorkflowDefinitionModelV2 from './workflowDefinitionModelV2';
import WorkflowDefinitionVersionModelV2 from './workflowDefinitionVersionModelV2';
import type { Knex } from 'knex';

export async function listPublishedWorkflowDefinitions(knex: Knex, tenantId: string) {
  const workflows = await WorkflowDefinitionModelV2.list(knex, tenantId);
  const published = workflows.filter((workflow) => workflow.status === 'published');
  const results = await Promise.all(published.map(async (workflow) => {
    const versions = await WorkflowDefinitionVersionModelV2.listByWorkflow(knex, workflow.workflow_id);
    const latestVersion = versions[0] ?? null;
    return latestVersion ? { workflow, latestVersion, definition: latestVersion.definition_json as Record<string, unknown> | null } : null;
  }));
  return results.filter((result): result is NonNullable<typeof result> => result !== null);
}
