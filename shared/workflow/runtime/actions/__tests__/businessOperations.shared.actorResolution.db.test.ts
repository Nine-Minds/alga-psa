import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection, createTenant, createUser } from './_dbTestUtils';
import { resolveRunContext } from '../businessOperations/shared';

function tenantTable(db: Knex, tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

describe('workflow shared helper actor resolution', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection();
  }, 120000);

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('T017: uses run tenant when resolving created_by/published_by actors', async () => {
    const tenantA = await createTenant(db, 'Tenant A');
    const tenantB = await createTenant(db, 'Tenant B');

    const actorA = await createUser(db, tenantA, { email: 'actor-a@example.com' });
    const actorB = await createUser(db, tenantB, { email: 'actor-b@example.com' });

    const leakingWorkflowId = uuidv4();
    await tenantTable(db, tenantB, 'workflow_definitions').insert({
      workflow_id: leakingWorkflowId,
      tenant: tenantB,
      name: 'Cross Tenant Definition',
      description: null,
      payload_schema_ref: 'schema://test',
      trigger: {},
      draft_definition: { id: leakingWorkflowId },
      draft_version: 1,
      status: 'draft',
      created_by: actorB,
      updated_by: actorB,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await tenantTable(db, tenantB, 'workflow_definition_versions').insert({
      version_id: uuidv4(),
      workflow_id: leakingWorkflowId,
      tenant: tenantB,
      version: 1,
      definition_json: { id: leakingWorkflowId },
      payload_schema_json: {},
      published_by: actorB,
      published_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const crossTenantRunId = uuidv4();
    await tenantTable(db, tenantA, 'workflow_runs').insert({
      run_id: crossTenantRunId,
      workflow_id: leakingWorkflowId,
      workflow_version: 1,
      tenant: tenantA,
      status: 'running',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const leakedActor = await resolveRunContext(db as any, tenantA, crossTenantRunId);
    expect(leakedActor).toBeNull();

    const scopedWorkflowId = uuidv4();
    await tenantTable(db, tenantA, 'workflow_definitions').insert({
      workflow_id: scopedWorkflowId,
      tenant: tenantA,
      name: 'Tenant Scoped Definition',
      description: null,
      payload_schema_ref: 'schema://test',
      trigger: {},
      draft_definition: { id: scopedWorkflowId },
      draft_version: 1,
      status: 'draft',
      created_by: actorA,
      updated_by: actorA,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const scopedRunId = uuidv4();
    await tenantTable(db, tenantA, 'workflow_runs').insert({
      run_id: scopedRunId,
      workflow_id: scopedWorkflowId,
      workflow_version: 1,
      tenant: tenantA,
      status: 'running',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const resolvedActor = await resolveRunContext(db as any, tenantA, scopedRunId);
    expect(resolvedActor).toEqual({ actorUserId: actorA, workflowId: scopedWorkflowId, lineage: [] });
  });

  it('N5: resolves the actor from the workflow version the run executed, not any published version', async () => {
    const tenant = await createTenant(db, 'Tenant Versions');
    const creator = await createUser(db, tenant, { email: 'creator@example.com' });
    const publisherV1 = await createUser(db, tenant, { email: 'publisher-v1@example.com' });
    const publisherV2 = await createUser(db, tenant, { email: 'publisher-v2@example.com' });

    const workflowId = uuidv4();
    const now = new Date().toISOString();
    await tenantTable(db, tenant, 'workflow_definitions').insert({
      workflow_id: workflowId,
      tenant,
      name: 'Versioned Definition',
      description: null,
      payload_schema_ref: 'schema://test',
      trigger: {},
      draft_definition: { id: workflowId },
      draft_version: 2,
      status: 'published',
      created_by: creator,
      updated_by: creator,
      created_at: now,
      updated_at: now,
    });
    for (const [version, publisher] of [[1, publisherV1], [2, publisherV2]] as const) {
      await tenantTable(db, tenant, 'workflow_definition_versions').insert({
        version_id: uuidv4(),
        workflow_id: workflowId,
        tenant,
        version,
        definition_json: { id: workflowId },
        payload_schema_json: {},
        published_by: publisher,
        published_at: now,
        created_at: now,
        updated_at: now,
      });
    }

    const runOn = async (version: number) => {
      const runId = uuidv4();
      await tenantTable(db, tenant, 'workflow_runs').insert({
        run_id: runId,
        workflow_id: workflowId,
        workflow_version: version,
        tenant,
        status: 'running',
        started_at: now,
        updated_at: now,
      });
      return resolveRunContext(db as any, tenant, runId);
    };

    expect((await runOn(1))?.actorUserId).toBe(publisherV1);
    expect((await runOn(2))?.actorUserId).toBe(publisherV2);
  });
});
