import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { duplicateServiceRequestDefinition } from '../../lib/service-requests/definitionManagement';
import {
  publishServiceRequestDefinitionWithValidation,
  validateServiceRequestDefinitionForPublish,
} from '../../lib/service-requests/definitionValidation';
import { ServiceRequestDefinitionBusinessError } from '../../lib/service-requests/definitionErrors';
import {
  SERVICE_REQUEST_STORE_ONLY_FEATURE_FLAG,
  storeOnlyAuthoringDisabledMessage,
} from '../../lib/service-requests/storeOnlyAuthoringGate';

/**
 * Behavioral coverage for the `service-request-store-only` feature flag gate.
 *
 * The MSP actions in app/msp/service-requests/actions.ts evaluate the flag per
 * request and forward it as `storeOnlyAuthoringEnabled` into these lib entry
 * points (the lib layer never evaluates flags itself). These tests drive those
 * entry points with both flag values, so they cover the exact decision the
 * actions delegate: while the flag is off, no authoring act may newly adopt
 * the store-only execution provider, and everything that already exists keeps
 * working.
 */

const VALID_FORM_SCHEMA = {
  fields: [{ key: 'request_title', type: 'short-text', label: 'Request Title', required: true }],
};

describe('service request store-only feature flag gate', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  async function createTenant(): Promise<string> {
    const tenant = uuidv4();
    await db('tenants').insert({
      tenant,
      client_name: `Tenant ${tenant.slice(0, 8)}`,
      email: `tenant-${tenant.slice(0, 8)}@example.com`,
    });
    return tenant;
  }

  async function insertDefinition(args: {
    tenant: string;
    executionProvider: 'store-only' | 'ticket-only';
    lifecycleState?: 'draft' | 'published';
    name?: string;
  }): Promise<string> {
    const definitionId = uuidv4();
    await tenantDb(db, args.tenant).table('service_request_definitions').insert({
      tenant: args.tenant,
      definition_id: definitionId,
      name: args.name ?? 'Store Only Questionnaire',
      form_schema: VALID_FORM_SCHEMA,
      execution_provider: args.executionProvider,
      execution_config: {},
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {},
      lifecycle_state: args.lifecycleState ?? 'draft',
    });
    return definitionId;
  }

  async function insertPublishedVersion(tenant: string, definitionId: string): Promise<void> {
    await tenantDb(db, tenant).table('service_request_definition_versions').insert({
      tenant,
      version_id: uuidv4(),
      definition_id: definitionId,
      version_number: 1,
      name: 'Store Only Questionnaire',
      form_schema_snapshot: VALID_FORM_SCHEMA,
      execution_provider: 'store-only',
      execution_config: {},
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {},
    });
  }

  async function countDefinitions(tenant: string): Promise<number> {
    const [row] = await tenantDb(db, tenant)
      .table('service_request_definitions')
      .count<{ count: string }[]>('* as count');
    return Number(row.count);
  }

  async function listVersionNumbers(tenant: string, definitionId: string): Promise<number[]> {
    const rows = (await tenantDb(db, tenant)
      .table('service_request_definition_versions')
      .where({ definition_id: definitionId })
      .orderBy('version_number', 'asc')
      .select('version_number')) as { version_number: number }[];
    return rows.map((row) => Number(row.version_number));
  }

  async function getLifecycleState(tenant: string, definitionId: string): Promise<string | undefined> {
    const row = await tenantDb(db, tenant)
      .table('service_request_definitions')
      .where({ definition_id: definitionId })
      .select('lifecycle_state')
      .first<{ lifecycle_state: string }>();
    return row?.lifecycle_state;
  }

  it('duplicate refuses a store-only source while the flag is off, persists nothing, and succeeds once the flag is on', async () => {
    const tenant = await createTenant();
    const actor = uuidv4();
    const sourceDefinitionId = await insertDefinition({ tenant, executionProvider: 'store-only' });

    const blockedDuplicate = duplicateServiceRequestDefinition({
      knex: db,
      tenant,
      sourceDefinitionId,
      createdBy: actor,
      storeOnlyAuthoringEnabled: false,
    });

    await expect(blockedDuplicate).rejects.toThrowError(ServiceRequestDefinitionBusinessError);
    await expect(blockedDuplicate).rejects.toMatchObject({
      code: 'STORE_ONLY_AUTHORING_DISABLED',
      message: expect.stringContaining(SERVICE_REQUEST_STORE_ONLY_FEATURE_FLAG),
    });
    // The refusal must leave no partially-created copy behind.
    expect(await countDefinitions(tenant)).toBe(1);

    const copy = await duplicateServiceRequestDefinition({
      knex: db,
      tenant,
      sourceDefinitionId,
      createdBy: actor,
      storeOnlyAuthoringEnabled: true,
    });

    expect(copy.name).toBe('Store Only Questionnaire (Copy)');
    expect(copy.lifecycle_state).toBe('draft');
    expect(await countDefinitions(tenant)).toBe(2);
  });

  it('duplicate keeps working for non-store-only sources while the flag is off', async () => {
    const tenant = await createTenant();
    const sourceDefinitionId = await insertDefinition({
      tenant,
      executionProvider: 'ticket-only',
      name: 'Ticket Only Questionnaire',
    });

    const copy = await duplicateServiceRequestDefinition({
      knex: db,
      tenant,
      sourceDefinitionId,
      storeOnlyAuthoringEnabled: false,
    });

    expect(copy.name).toBe('Ticket Only Questionnaire (Copy)');
    expect(await countDefinitions(tenant)).toBe(2);
  });

  it('publish validation reports exactly the flag block while the flag is off and nothing once it is on', async () => {
    const tenant = await createTenant();
    const definitionId = await insertDefinition({ tenant, executionProvider: 'store-only' });

    const blockedValidation = await validateServiceRequestDefinitionForPublish(db, tenant, definitionId, {
      storeOnlyAuthoringEnabled: false,
    });

    expect(blockedValidation.isValid).toBe(false);
    // The flag block is the sole error: the definition is otherwise
    // publishable, so nothing else may be hiding behind the gate.
    expect(blockedValidation.errors).toEqual([
      `Execution: ${storeOnlyAuthoringDisabledMessage('Publishing a store-only service request definition')}`,
    ]);

    const allowedValidation = await validateServiceRequestDefinitionForPublish(db, tenant, definitionId, {
      storeOnlyAuthoringEnabled: true,
    });

    expect(allowedValidation.isValid).toBe(true);
    expect(allowedValidation.errors).toHaveLength(0);
  });

  it('publish refuses a store-only draft while the flag is off, keeps it a draft, and publishes once the flag is on', async () => {
    const tenant = await createTenant();
    const actor = uuidv4();
    const definitionId = await insertDefinition({ tenant, executionProvider: 'store-only' });

    await expect(
      publishServiceRequestDefinitionWithValidation({
        knex: db,
        tenant,
        definitionId,
        publishedBy: actor,
        storeOnlyAuthoringEnabled: false,
      })
    ).rejects.toThrowError(new RegExp(`Publish validation failed.*${SERVICE_REQUEST_STORE_ONLY_FEATURE_FLAG}`));

    expect(await getLifecycleState(tenant, definitionId)).toBe('draft');
    expect(await listVersionNumbers(tenant, definitionId)).toEqual([]);

    const published = await publishServiceRequestDefinitionWithValidation({
      knex: db,
      tenant,
      definitionId,
      publishedBy: actor,
      storeOnlyAuthoringEnabled: true,
    });

    expect(published.version_number).toBe(1);
    expect(published.execution_provider).toBe('store-only');
    expect(await getLifecycleState(tenant, definitionId)).toBe('published');
  });

  it('republish of an already-published store-only definition is refused while the flag is off and its published surface stays intact', async () => {
    const tenant = await createTenant();
    const actor = uuidv4();
    const definitionId = await insertDefinition({
      tenant,
      executionProvider: 'store-only',
      lifecycleState: 'published',
    });
    await insertPublishedVersion(tenant, definitionId);

    // Republishing would create a new store-only version — a new authoring
    // act — so the gate refuses it like any other store-only publish. The
    // already-published version is untouched: the definition stays published
    // and version 1 remains the live catalog/execution surface, exactly the
    // "existing definitions keep working" half of the design scope.
    await expect(
      publishServiceRequestDefinitionWithValidation({
        knex: db,
        tenant,
        definitionId,
        publishedBy: actor,
        storeOnlyAuthoringEnabled: false,
      })
    ).rejects.toThrowError(/Publish validation failed/);

    expect(await getLifecycleState(tenant, definitionId)).toBe('published');
    expect(await listVersionNumbers(tenant, definitionId)).toEqual([1]);

    const republished = await publishServiceRequestDefinitionWithValidation({
      knex: db,
      tenant,
      definitionId,
      publishedBy: actor,
      storeOnlyAuthoringEnabled: true,
    });

    expect(republished.version_number).toBe(2);
    expect(await listVersionNumbers(tenant, definitionId)).toEqual([1, 2]);
    expect(await getLifecycleState(tenant, definitionId)).toBe('published');
  });
});
