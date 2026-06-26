import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(repoRoot, relativePath), 'utf8');
}

describe('workflow tenant facade roots', () => {
  it('routes workflow quota counters and ledger joins through tenantDb', () => {
    const source = read('shared/workflow/runtime/services/workflowStepQuotaService.ts');

    expect(source).toContain("tenantScopedTable<UsageRow>(knex, tenant, 'workflow_step_usage_periods')");
    expect(source).toContain("tenantScopedTable<UsageRow>(trx, summary.tenant, 'workflow_step_usage_periods')");
    expect(source).toContain("tenantScopedTable<StripeSubscriptionRow>(knex, tenant, 'stripe_subscriptions')");
    expect(source).toMatch(/tenantScopedTable<[\s\S]*>\(knex, tenant, 'stripe_prices'\)/);
    expect(source).toMatch(/tenantScopedTable<[\s\S]*>\(knex, tenant, 'stripe_products'\)/);
    expect(source).toContain("db.table('workflow_run_steps as s')");
    expect(source).toContain("db.tenantJoin(ledgerQuery, 'workflow_runs as r'");
    expect(source).not.toContain("knex<UsageRow>('workflow_step_usage_periods')");
    expect(source).not.toContain("trx<UsageRow>('workflow_step_usage_periods')");
    expect(source).not.toContain("knex('workflow_run_steps as s')");
  });

  it('routes workflow tenant-aware persistence helpers through tenantDb', () => {
    const files = [
      'shared/workflow/persistence/formDefinitionModel.ts',
      'shared/workflow/persistence/formSchemaModel.ts',
      'shared/workflow/persistence/workflowDataStoreModel.ts',
      'shared/workflow/persistence/workflowEntityLinkModel.ts',
      'shared/workflow/persistence/workflowActionInvocationModelV2.ts',
      'shared/workflow/persistence/workflowDefinitionModelV2.ts',
      'shared/workflow/persistence/workflowDefinitionVersionModelV2.ts',
      'shared/workflow/persistence/workflowRunLogModelV2.ts',
      'shared/workflow/persistence/workflowRunModelV2.ts',
      'shared/workflow/persistence/workflowRunSnapshotModelV2.ts',
      'shared/workflow/persistence/workflowRunStepModelV2.ts',
      'shared/workflow/persistence/workflowRunWaitModelV2.ts',
      'shared/workflow/persistence/workflowRuntimeEventModelV2.ts',
      'shared/workflow/persistence/workflowScheduleStateModel.ts',
      'shared/workflow/persistence/workflowTaskModel.ts',
    ];

    for (const file of files) {
      const source = read(file);

      expect(source, file).toContain("import { tenantDb } from '@alga-psa/db'");
      expect(source, file).not.toMatch(/if\s*\(\s*tenant(?:Id)?\s*\)\s+query\.andWhere\(\{\s*tenant\s*\}\)/);
      expect(source, file).not.toMatch(/\.where\(\{\s*tenant:\s*tenant(?:Id)?/);
    }
  });

  it('registers workflow V2 and quota tables in tenant metadata', () => {
    const metadataSource = read('packages/db/src/lib/tenantTableMetadata.ts');

    const expectedEntries = [
      "tenant_workflow_schedule: { scope: 'tenant' }",
      "workflow_action_invocations: { scope: 'tenant' }",
      "workflow_data_store: { scope: 'tenant' }",
      "workflow_definitions: { scope: 'tenant' }",
      "workflow_definition_versions: { scope: 'tenant' }",
      "workflow_entity_links: { scope: 'tenant' }",
      "workflow_run_logs: { scope: 'tenant' }",
      "workflow_run_snapshots: { scope: 'tenant' }",
      "workflow_run_steps: { scope: 'tenant' }",
      "workflow_run_waits: { scope: 'tenant' }",
      "workflow_runtime_events: { scope: 'tenant' }",
      "workflow_step_usage_periods: { scope: 'tenant' }",
      "workflow_task_history: { scope: 'tenant' }",
    ];

    for (const entry of expectedEntries) {
      expect(metadataSource).toContain(entry);
    }
  });

  it('routes workflow integration and scheduling roots through the workflow tenant facade', () => {
    const helperSource = read('ee/packages/workflows/src/lib/workflowTenantDb.ts');
    expect(helperSource).toContain("import { tenantDb } from '@alga-psa/db'");
    expect(helperSource).toContain('tenantDb(conn, tenantId).table<Row>(table)');

    const files = [
      'ee/packages/workflows/src/runtime/integrationModules.ts',
      'ee/packages/workflows/src/runtime/actions/registerTeamsWorkflowActions.ts',
      'ee/packages/workflows/src/runtime/actions/registerTacticalRmmWorkflowActions.ts',
      'ee/packages/workflows/src/runtime/actions/registerHuntressWorkflowActions.ts',
      'ee/packages/workflows/src/runtime/actions/registerNinjaOneWorkflowActions.ts',
      'ee/packages/workflows/src/runtime/actions/registerLevelIoWorkflowActions.ts',
      'ee/packages/workflows/src/lib/workflowBusinessDayScheduling.ts',
      'ee/packages/workflows/src/lib/workflowRunLauncher.ts',
      'ee/packages/workflows/src/lib/workflowScheduleLifecycle.ts',
    ];

    const directRootPattern =
      /\b(?:knex|tx\.trx)\s*(?:<[^>]+>)?\s*\(\s*['`](?:assets|business_hours_entries|business_hours_schedules|holidays|jobs|microsoft_profiles|rmm_alerts|rmm_integrations|teams_conversation_references|teams_integrations|tenant_addons|user_auth_accounts|workflow_runs)['`]\s*\)/;

    for (const file of files) {
      const source = read(file);

      expect(source, file).toMatch(/workflowTenantTable(?:<[^>]+>)?\(/);
      expect(source, file).not.toMatch(directRootPattern);
      expect(source, file).not.toMatch(/\.where\(\{\s*tenant\s*:/);
    }

    const metadataSource = read('packages/db/src/lib/tenantTableMetadata.ts');
    expect(metadataSource).toContain("teams_conversation_references: { scope: 'tenant' }");
  });
});
