import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';

import { createTestDbConnection, createTenant, createUser } from './_dbTestUtils';
import { resolveRunActorUserId } from '../businessOperations/shared';

describe('workflow shared helper actor resolution', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection();
  }, 120000);

  afterAll(async () => {
    await db.destroy();
  });

  it('T017: uses run tenant when joining workflow_definitions and does not resolve cross-tenant created_by', async () => {
    const tenantA = await createTenant(db, 'Tenant A');
    const tenantB = await createTenant(db, 'Tenant B');

    const actorA = await createUser(db, tenantA, { email: 'actor-a@example.com' });
    const actorB = await createUser(db, tenantB, { email: 'actor-b@example.com' });

    const leakingWorkflowId = uuidv4();
    await db('workflow_definitions').insert({
      workflow_id: leakingWorkflowId,
      tenant_id: tenantB,
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

    const crossTenantRunId = uuidv4();
    await db('workflow_runs').insert({
      run_id: crossTenantRunId,
      workflow_id: leakingWorkflowId,
      workflow_version: 1,
      tenant_id: tenantA,
      status: 'running',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const leakedActor = await resolveRunActorUserId(db as any, crossTenantRunId);
    expect(leakedActor).toBeNull();

    const scopedWorkflowId = uuidv4();
    await db('workflow_definitions').insert({
      workflow_id: scopedWorkflowId,
      tenant_id: tenantA,
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
    await db('workflow_runs').insert({
      run_id: scopedRunId,
      workflow_id: scopedWorkflowId,
      workflow_version: 1,
      tenant_id: tenantA,
      status: 'running',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const resolvedActor = await resolveRunActorUserId(db as any, scopedRunId);
    expect(resolvedActor).toBe(actorA);
  });
});
