import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import type { IUser } from '@alga-psa/types';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  addAnswerMappingRule,
  applyAnswerMapping,
  previewAnswerMapping,
  publishAnswerMapping,
  removeAnswerMappingRules,
  type ServiceRequestAnswerMappingRuleInput,
} from '../../lib/service-requests/mapping';

// The global test setup stubs hasPermission to always allow. Permission denial
// is a behavior under test here, so restore the real RBAC check against the
// roles/permissions rows each scenario seeds.
vi.mock('@alga-psa/auth', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/auth')>('@alga-psa/auth');
  return { ...actual, hasPermission: actual.hasPermission };
});

/**
 * Behavioral coverage for questionnaire answer → account/asset mapping
 * (docs/plans/2026-09-20-questionnaire-answer-mapping-plan.md §9). Every
 * assertion is against persisted rows or returned outcomes — never source.
 */

const FORM_FIELDS = [
  { key: 'account_name', label: 'Account name', type: 'short-text' },
  { key: 'billing_cycle', label: 'Billing cycle', type: 'short-text' },
  { key: 'inactive', label: 'Inactive?', type: 'checkbox' },
  { key: 'industry', label: 'Industry', type: 'short-text' },
  { key: 'credit_limit', label: 'Credit limit', type: 'short-text' },
  { key: 'notes', label: 'Notes', type: 'long-text' },
  { key: 'device_serial', label: 'Device serial', type: 'short-text' },
  { key: 'device_tag', label: 'New asset tag', type: 'short-text' },
  { key: 'warranty_end', label: 'Warranty end', type: 'date' },
  { key: 'rack_position', label: 'Rack position', type: 'short-text' },
  { key: 'device_ref', label: 'Device', type: 'select' },
];

describe('service request answer mapping', () => {
  let db: Knex;
  const createdTenants: string[] = [];

  function table(tenant: string, name: string) {
    return tenantDb(db, tenant).table(name);
  }

  async function createTenant(): Promise<string> {
    const tenant = uuidv4();
    await tenantDb(db, '__test_tenant_fixture__')
      .unscoped('tenants', 'test fixture creates and removes tenant rows')
      .insert({
        tenant,
        client_name: `Tenant ${tenant.slice(0, 8)}`,
        email: `tenant-${tenant.slice(0, 8)}@example.com`,
      });
    createdTenants.push(tenant);
    return tenant;
  }

  async function createUser(tenant: string, username: string): Promise<IUser> {
    const userId = uuidv4();
    await table(tenant, 'users').insert({
      tenant,
      user_id: userId,
      username: `${username}.${userId.slice(0, 8)}`,
      hashed_password: 'not-used',
      email: `${username}.${userId.slice(0, 8)}@example.com`,
      first_name: username,
      last_name: 'Admin',
      user_type: 'internal',
    });
    return { user_id: userId, tenant, user_type: 'internal' } as unknown as IUser;
  }

  async function grant(
    tenant: string,
    userId: string,
    permissions: Array<{ resource: string; action: string }>
  ): Promise<void> {
    const roleId = uuidv4();
    await table(tenant, 'roles').insert({
      tenant,
      role_id: roleId,
      role_name: `Mapping role ${roleId.slice(0, 8)}`,
      description: 'answer mapping test role',
      msp: true,
      client: false,
      created_at: new Date(),
      updated_at: new Date(),
    });
    for (const { resource, action } of permissions) {
      const existing = await table(tenant, 'permissions')
        .where({ resource, action })
        .first<{ permission_id: string }>('permission_id');
      const permissionId = existing?.permission_id ?? uuidv4();
      if (!existing) {
        await table(tenant, 'permissions').insert({
          tenant,
          permission_id: permissionId,
          resource,
          action,
          msp: true,
          client: false,
          created_at: new Date(),
        });
      }
      await table(tenant, 'role_permissions').insert({
        tenant,
        role_id: roleId,
        permission_id: permissionId,
        created_at: new Date(),
      });
    }
    await table(tenant, 'user_roles').insert({ tenant, user_id: userId, role_id: roleId, created_at: new Date() });
  }

  async function createFullAdmin(tenant: string): Promise<IUser> {
    const user = await createUser(tenant, 'mapper');
    await grant(tenant, user.user_id, [
      { resource: 'client', action: 'update' },
      { resource: 'asset', action: 'update' },
    ]);
    return user;
  }

  async function createClient(
    tenant: string,
    clientName: string,
    extra: Record<string, unknown> = {}
  ): Promise<string> {
    const clientId = uuidv4();
    await table(tenant, 'clients').insert({ tenant, client_id: clientId, client_name: clientName, ...extra });
    return clientId;
  }

  async function createAsset(
    tenant: string,
    clientId: string,
    fields: { name: string; asset_tag: string; serial_number?: string | null; asset_type?: string; attributes?: unknown }
  ): Promise<string> {
    const assetId = uuidv4();
    await table(tenant, 'assets').insert({
      tenant,
      asset_id: assetId,
      client_id: clientId,
      name: fields.name,
      asset_tag: fields.asset_tag,
      serial_number: fields.serial_number ?? null,
      status: 'active',
      asset_type: fields.asset_type ?? 'workstation',
      attributes: fields.attributes === undefined ? null : JSON.stringify(fields.attributes),
    });
    return assetId;
  }

  async function createDefinition(tenant: string): Promise<{ definitionId: string; versionId: string }> {
    const definitionId = uuidv4();
    const versionId = uuidv4();
    const shared = {
      execution_provider: 'store-only',
      execution_config: {},
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {},
    };
    await table(tenant, 'service_request_definitions').insert({
      tenant,
      definition_id: definitionId,
      name: 'Site survey',
      form_schema: { fields: FORM_FIELDS },
      lifecycle_state: 'published',
      ...shared,
    });
    await table(tenant, 'service_request_definition_versions').insert({
      tenant,
      version_id: versionId,
      definition_id: definitionId,
      version_number: 1,
      name: 'Site survey',
      form_schema_snapshot: { fields: FORM_FIELDS },
      ...shared,
    });
    return { definitionId, versionId };
  }

  async function createSubmission(
    tenant: string,
    definition: { definitionId: string; versionId: string },
    clientId: string,
    payload: Record<string, unknown>
  ): Promise<string> {
    const submissionId = uuidv4();
    await table(tenant, 'service_request_submissions').insert({
      tenant,
      submission_id: submissionId,
      definition_id: definition.definitionId,
      definition_version_id: definition.versionId,
      client_id: clientId,
      request_name: 'Site survey',
      submitted_payload: payload,
      execution_status: 'succeeded',
    });
    return submissionId;
  }

  async function publishRules(
    tenant: string,
    definitionId: string,
    rules: ServiceRequestAnswerMappingRuleInput[]
  ): Promise<string> {
    for (const rule of rules) {
      await addAnswerMappingRule({ knex: db, tenant, definitionId, rule });
    }
    const version = await publishAnswerMapping({ knex: db, tenant, definitionId });
    return version.version_id;
  }

  const serialRule = (targetFieldKey: string, questionKey: string): ServiceRequestAnswerMappingRuleInput => ({
    questionKey,
    destinationKind: 'asset',
    targetFieldKey,
    assetSelector: { strategy: 'match-attribute', matchAttribute: 'serial_number', matchQuestionKey: 'device_serial' },
  });

  const accountRule = (targetFieldKey: string, questionKey: string): ServiceRequestAnswerMappingRuleInput => ({
    questionKey,
    destinationKind: 'account',
    targetFieldKey,
  });

  it('removes selected draft rules together without changing the published version', async () => {
    const tenant = await createTenant();
    const definition = await createDefinition(tenant);
    const versionId = await publishRules(tenant, definition.definitionId, [
      accountRule('client_name', 'account_name'),
      accountRule('billing_cycle', 'billing_cycle'),
      accountRule('properties.industry', 'industry'),
    ]);
    const before = await table(tenant, 'service_request_answer_mappings')
      .where({ definition_id: definition.definitionId })
      .first<{ rules: { rules: Array<{ ruleId: string; questionKey: string }> } }>('rules');
    const ruleIds = before!.rules.rules.map((rule) => rule.ruleId);

    const updated = await removeAnswerMappingRules({
      knex: db,
      tenant,
      definitionId: definition.definitionId,
      ruleIds: [ruleIds[0], ruleIds[2]],
    });

    expect(updated.rules.rules.map((rule) => rule.questionKey)).toEqual(['billing_cycle']);
    const published = await table(tenant, 'service_request_answer_mapping_versions')
      .where({ version_id: versionId })
      .first<{ rules_snapshot: { rules: Array<{ questionKey: string }> } }>('rules_snapshot');
    expect(published!.rules_snapshot.rules.map((rule) => rule.questionKey)).toEqual([
      'account_name', 'billing_cycle', 'industry',
    ]);
  });

  async function loadPayload(tenant: string, submissionId: string) {
    return table(tenant, 'service_request_submissions')
      .where({ submission_id: submissionId })
      .first<{ submitted_payload: Record<string, unknown>; updated_at: Date }>('submitted_payload', 'updated_at');
  }

  function byField(results: Array<{ target_field_key: string; status: string; before_value: unknown; after_value: unknown; error_detail: string | null; resolved_target_display: string | null }>) {
    return new Map(results.map((result) => [result.target_field_key, result] as const));
  }

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
  });

  afterAll(async () => {
    if (db) {
      const cleanupOrder = [
        'service_request_submission_application_results',
        'service_request_submission_applications',
        'service_request_answer_mapping_versions',
        'service_request_answer_mappings',
        'service_request_submissions',
        'service_request_definition_versions',
        'service_request_definitions',
        'audit_logs',
        'asset_history',
        'assets',
        'asset_type_registry',
        'clients',
        'user_roles',
        'role_permissions',
        'roles',
        'permissions',
        'users',
      ];
      for (const tenant of createdTenants) {
        for (const name of cleanupOrder) {
          await table(tenant, name).delete();
        }
        await tenantDb(db, '__test_tenant_fixture__')
          .unscoped('tenants', 'test fixture creates and removes tenant rows')
          .where({ tenant })
          .delete();
      }
      await db.destroy();
    }
  });

  it('maps representative account field types and merges JSONB properties', async () => {
    const tenant = await createTenant();
    const actor = await createFullAdmin(tenant);
    const clientId = await createClient(tenant, 'Old Name', {
      properties: JSON.stringify({ company_size: '50', website: 'https://old.example' }),
    });
    const definition = await createDefinition(tenant);
    const submissionId = await createSubmission(tenant, definition, clientId, {
      account_name: 'Emerald City Ltd',
      billing_cycle: 'quarterly',
      inactive: 'yes',
      industry: 'Healthcare',
    });
    const versionId = await publishRules(tenant, definition.definitionId, [
      accountRule('client_name', 'account_name'),
      accountRule('billing_cycle', 'billing_cycle'),
      accountRule('is_inactive', 'inactive'),
      accountRule('properties.industry', 'industry'),
    ]);

    const run = await applyAnswerMapping({
      knex: db,
      tenant,
      submissionId,
      actorUserId: actor.user_id,
      actorUser: actor,
    });

    expect(run.status).toBe('applied');
    expect(run.mapping_version_id).toBe(versionId);
    const results = byField(run.results);
    expect(results.get('client_name')).toMatchObject({ status: 'applied', before_value: 'Old Name', after_value: 'Emerald City Ltd' });
    expect(results.get('billing_cycle')?.status).toBe('applied');
    expect(results.get('is_inactive')).toMatchObject({ status: 'applied', after_value: true });
    expect(results.get('properties.industry')).toMatchObject({ status: 'applied', before_value: null, after_value: 'Healthcare' });

    const client = await table(tenant, 'clients').where({ client_id: clientId }).first();
    expect(client.client_name).toBe('Emerald City Ltd');
    expect(client.billing_cycle).toBe('quarterly');
    expect(client.is_inactive).toBe(true);
    const properties = typeof client.properties === 'string' ? JSON.parse(client.properties) : client.properties;
    expect(properties).toMatchObject({ company_size: '50', website: 'https://old.example', industry: 'Healthcare' });

    const auditOps = await table(tenant, 'audit_logs')
      .where({ table_name: 'service_request_submissions', record_id: submissionId })
      .pluck('operation');
    expect(auditOps.filter((op: string) => op === 'service_request_submission_mapping_field_applied')).toHaveLength(4);
    expect(auditOps).toContain('service_request_submission_mapping_applied');
  });

  it('maps representative asset field types against an unambiguously resolved asset', async () => {
    const tenant = await createTenant();
    const actor = await createFullAdmin(tenant);
    const clientId = await createClient(tenant, 'Acme');
    await table(tenant, 'asset_type_registry').insert({
      tenant,
      type_id: uuidv4(),
      slug: 'kiosk',
      name: 'Kiosk',
      fields_schema: JSON.stringify([{ key: 'rack_position', label: 'Rack position', kind: 'text' }]),
      is_builtin: false,
      display_order: 99,
    });
    const assetId = await createAsset(tenant, clientId, {
      name: 'Lobby kiosk',
      asset_tag: 'OLD-1',
      serial_number: 'SN-100',
      asset_type: 'kiosk',
      attributes: { hudu_fields: { keep: true } },
    });
    await createAsset(tenant, clientId, { name: 'Other', asset_tag: 'OTHER', serial_number: 'SN-999' });
    const definition = await createDefinition(tenant);
    const submissionId = await createSubmission(tenant, definition, clientId, {
      device_serial: 'SN-100',
      device_tag: 'KIOSK-42',
      warranty_end: '2027-03-01',
      rack_position: 'R2-U7',
    });
    await publishRules(tenant, definition.definitionId, [
      serialRule('asset_tag', 'device_tag'),
      serialRule('warranty_end_date', 'warranty_end'),
      serialRule('attributes.rack_position', 'rack_position'),
    ]);

    const run = await applyAnswerMapping({ knex: db, tenant, submissionId, actorUserId: actor.user_id, actorUser: actor });

    expect(run.status).toBe('applied');
    const results = byField(run.results);
    expect(results.get('asset_tag')).toMatchObject({ status: 'applied', before_value: 'OLD-1', after_value: 'KIOSK-42', resolved_target_display: 'Lobby kiosk' });
    expect(results.get('warranty_end_date')?.status).toBe('applied');
    expect(results.get('attributes.rack_position')).toMatchObject({ status: 'applied', after_value: 'R2-U7' });

    const asset = await table(tenant, 'assets').where({ asset_id: assetId }).first();
    expect(asset.asset_tag).toBe('KIOSK-42');
    expect(new Date(asset.warranty_end_date).toISOString().slice(0, 10)).toBe('2027-03-01');
    const attributes = typeof asset.attributes === 'string' ? JSON.parse(asset.attributes) : asset.attributes;
    expect(attributes).toMatchObject({ rack_position: 'R2-U7', hudu_fields: { keep: true } });

    const other = await table(tenant, 'assets').where({ asset_tag: 'OTHER' }).first();
    expect(other.warranty_end_date).toBeNull();
  });

  it('reports missing asset context per field while account fields in the same run still apply', async () => {
    const tenant = await createTenant();
    const actor = await createFullAdmin(tenant);
    const clientId = await createClient(tenant, 'Acme');
    await createAsset(tenant, clientId, { name: 'Printer', asset_tag: 'PR-1', serial_number: 'SN-1' });
    const definition = await createDefinition(tenant);
    const submissionId = await createSubmission(tenant, definition, clientId, {
      device_serial: 'SN-DOES-NOT-EXIST',
      device_tag: 'NEW-TAG',
      account_name: 'Acme Renamed',
    });
    await publishRules(tenant, definition.definitionId, [
      serialRule('asset_tag', 'device_tag'),
      accountRule('client_name', 'account_name'),
    ]);

    const run = await applyAnswerMapping({ knex: db, tenant, submissionId, actorUserId: actor.user_id, actorUser: actor });

    expect(run.status).toBe('partially_applied');
    const results = byField(run.results);
    expect(results.get('asset_tag')?.status).toBe('failed_asset_unresolved');
    expect(results.get('client_name')?.status).toBe('applied');
    const asset = await table(tenant, 'assets').where({ client_id: clientId }).first();
    expect(asset.asset_tag).toBe('PR-1');
    const client = await table(tenant, 'clients').where({ client_id: clientId }).first();
    expect(client.client_name).toBe('Acme Renamed');
  });

  it('never guesses between multiple matching assets', async () => {
    const tenant = await createTenant();
    const actor = await createFullAdmin(tenant);
    const clientId = await createClient(tenant, 'Acme');
    await createAsset(tenant, clientId, { name: 'Laptop A', asset_tag: 'A', serial_number: 'DUP' });
    await createAsset(tenant, clientId, { name: 'Laptop B', asset_tag: 'B', serial_number: 'DUP' });
    const definition = await createDefinition(tenant);
    const submissionId = await createSubmission(tenant, definition, clientId, { device_serial: 'DUP', device_tag: 'CHANGED' });
    await publishRules(tenant, definition.definitionId, [serialRule('asset_tag', 'device_tag')]);

    const run = await applyAnswerMapping({ knex: db, tenant, submissionId, actorUserId: actor.user_id, actorUser: actor });

    expect(run.status).toBe('failed');
    expect(run.results[0]).toMatchObject({ status: 'failed_asset_ambiguous', resolved_target_ref: null });
    const tags = await table(tenant, 'assets').where({ client_id: clientId }).orderBy('asset_tag').pluck('asset_tag');
    expect(tags).toEqual(['A', 'B']);
  });

  it('records validation and type-conversion failures per field and keeps the raw submission intact', async () => {
    const tenant = await createTenant();
    const actor = await createFullAdmin(tenant);
    const clientId = await createClient(tenant, 'Acme');
    const definition = await createDefinition(tenant);
    const payload = { billing_cycle: 'fortnightly', credit_limit: 'lots', account_name: 'Acme Corp' };
    const submissionId = await createSubmission(tenant, definition, clientId, payload);
    const before = await loadPayload(tenant, submissionId);
    const clientBefore = await table(tenant, 'clients').where({ client_id: clientId }).first();
    await publishRules(tenant, definition.definitionId, [
      accountRule('billing_cycle', 'billing_cycle'),
      accountRule('credit_limit', 'credit_limit'),
      accountRule('client_name', 'account_name'),
      accountRule('notes', 'notes'),
    ]);

    const run = await applyAnswerMapping({ knex: db, tenant, submissionId, actorUserId: actor.user_id, actorUser: actor });

    expect(run.status).toBe('partially_applied');
    const results = byField(run.results);
    expect(results.get('billing_cycle')?.status).toBe('failed_validation');
    expect(results.get('credit_limit')?.status).toBe('failed_type_conversion');
    expect(results.get('notes')?.status).toBe('skipped_answer_absent');
    expect(results.get('client_name')?.status).toBe('applied');

    const client = await table(tenant, 'clients').where({ client_id: clientId }).first();
    expect(client.client_name).toBe('Acme Corp');
    expect(client.billing_cycle).toBe(clientBefore.billing_cycle);
    expect(client.credit_limit).toBe(clientBefore.credit_limit);

    const after = await loadPayload(tenant, submissionId);
    expect(after?.submitted_payload).toEqual(before?.submitted_payload);
    expect(after?.submitted_payload).toEqual(payload);
    expect(new Date(after!.updated_at).getTime()).toBe(new Date(before!.updated_at).getTime());

    const failedAudit = await table(tenant, 'audit_logs')
      .where({ table_name: 'service_request_submissions', record_id: submissionId, operation: 'service_request_submission_mapping_field_failed' })
      .count<{ count: string }[]>('* as count');
    expect(Number(failedAudit[0].count)).toBe(2);
  });

  it('denies asset writes per field for a user without asset:update while account fields apply', async () => {
    const tenant = await createTenant();
    const actor = await createUser(tenant, 'clientonly');
    await grant(tenant, actor.user_id, [{ resource: 'client', action: 'update' }]);
    const clientId = await createClient(tenant, 'Acme');
    await createAsset(tenant, clientId, { name: 'Switch', asset_tag: 'SW-1', serial_number: 'SN-1' });
    const definition = await createDefinition(tenant);
    const submissionId = await createSubmission(tenant, definition, clientId, {
      device_serial: 'SN-1',
      device_tag: 'SW-2',
      account_name: 'Acme Updated',
    });
    await publishRules(tenant, definition.definitionId, [
      serialRule('asset_tag', 'device_tag'),
      accountRule('client_name', 'account_name'),
    ]);

    const run = await applyAnswerMapping({ knex: db, tenant, submissionId, actorUserId: actor.user_id, actorUser: actor });

    const results = byField(run.results);
    expect(results.get('asset_tag')?.status).toBe('failed_permission');
    expect(results.get('client_name')?.status).toBe('applied');
    const asset = await table(tenant, 'assets').where({ client_id: clientId }).first();
    expect(asset.asset_tag).toBe('SW-1');
    const client = await table(tenant, 'clients').where({ client_id: clientId }).first();
    expect(client.client_name).toBe('Acme Updated');
  });

  it('records the mapping version used and leaves earlier applications reproducible after a new publish', async () => {
    const tenant = await createTenant();
    const actor = await createFullAdmin(tenant);
    const clientId = await createClient(tenant, 'Acme');
    const definition = await createDefinition(tenant);
    const submissionOne = await createSubmission(tenant, definition, clientId, { account_name: 'Acme v1', notes: 'first' });
    const submissionTwo = await createSubmission(tenant, definition, clientId, { account_name: 'Acme v2', notes: 'second' });

    const v1 = await publishRules(tenant, definition.definitionId, [accountRule('client_name', 'account_name')]);
    const runOne = await applyAnswerMapping({ knex: db, tenant, submissionId: submissionOne, actorUserId: actor.user_id, actorUser: actor });
    expect(runOne.mapping_version_id).toBe(v1);
    expect(runOne.results.map((result) => result.target_field_key)).toEqual(['client_name']);

    const v2 = await publishRules(tenant, definition.definitionId, [accountRule('notes', 'notes')]);
    expect(v2).not.toBe(v1);
    const versions = await table(tenant, 'service_request_answer_mapping_versions')
      .where({ definition_id: definition.definitionId })
      .orderBy('version_number')
      .select('version_id', 'version_number', 'rules_snapshot');
    expect(versions.map((version: { version_number: number }) => version.version_number)).toEqual([1, 2]);
    expect(versions[0].rules_snapshot.rules).toHaveLength(1);
    expect(versions[1].rules_snapshot.rules).toHaveLength(2);

    const runTwo = await applyAnswerMapping({ knex: db, tenant, submissionId: submissionTwo, actorUserId: actor.user_id, actorUser: actor });
    expect(runTwo.mapping_version_id).toBe(v2);
    expect(byField(runTwo.results).get('notes')).toMatchObject({ status: 'applied', after_value: 'second' });

    const storedRunOne = await table(tenant, 'service_request_submission_applications')
      .where({ submission_id: submissionOne })
      .select('application_id', 'mapping_version_id', 'status');
    expect(storedRunOne).toHaveLength(1);
    expect(storedRunOne[0]).toMatchObject({ application_id: runOne.application_id, mapping_version_id: v1, status: 'applied' });

    // Replaying run one explicitly under v1 converges without touching notes.
    const replay = await applyAnswerMapping({ knex: db, tenant, submissionId: submissionOne, mappingVersionId: v1, actorUserId: actor.user_id, actorUser: actor });
    expect(replay.application_id).toBe(runOne.application_id);
    expect(replay.results.map((result) => result.target_field_key)).toEqual(['client_name']);
  });

  it('is idempotent: sequential and concurrent retries converge to one application row without double-writing', async () => {
    const tenant = await createTenant();
    const actor = await createFullAdmin(tenant);
    const clientId = await createClient(tenant, 'Acme');
    const definition = await createDefinition(tenant);
    const submissionId = await createSubmission(tenant, definition, clientId, { account_name: 'Acme Once', industry: 'Retail' });
    await publishRules(tenant, definition.definitionId, [
      accountRule('client_name', 'account_name'),
      accountRule('properties.industry', 'industry'),
    ]);

    const first = await applyAnswerMapping({ knex: db, tenant, submissionId, actorUserId: actor.user_id, actorUser: actor });
    expect(first.results.every((result) => result.status === 'applied')).toBe(true);

    const second = await applyAnswerMapping({ knex: db, tenant, submissionId, actorUserId: actor.user_id, actorUser: actor });
    expect(second.application_id).toBe(first.application_id);
    expect(second.results.every((result) => result.status === 'skipped_no_change')).toBe(true);
    expect(second.status).toBe('no_op');

    const rows = await table(tenant, 'service_request_submission_applications').where({ submission_id: submissionId });
    expect(rows).toHaveLength(1);

    const concurrentSubmission = await createSubmission(tenant, definition, clientId, { account_name: 'Acme Twice', industry: 'Retail' });
    const [left, right] = await Promise.all([
      applyAnswerMapping({ knex: db, tenant, submissionId: concurrentSubmission, actorUserId: actor.user_id, actorUser: actor }),
      applyAnswerMapping({ knex: db, tenant, submissionId: concurrentSubmission, actorUserId: actor.user_id, actorUser: actor }),
    ]);
    expect(left.application_id).toBe(right.application_id);
    const concurrentRows = await table(tenant, 'service_request_submission_applications').where({ submission_id: concurrentSubmission });
    expect(concurrentRows).toHaveLength(1);
    const client = await table(tenant, 'clients').where({ client_id: clientId }).first();
    expect(client.client_name).toBe('Acme Twice');
    const appliedCount = await table(tenant, 'service_request_submission_application_results')
      .where({ application_id: left.application_id })
      .count<{ count: string }[]>('* as count');
    expect(Number(appliedCount[0].count)).toBe(2);
  });

  it('cannot resolve an asset belonging to another account even when the serial matches', async () => {
    const tenant = await createTenant();
    const actor = await createFullAdmin(tenant);
    const clientA = await createClient(tenant, 'Account A');
    const clientB = await createClient(tenant, 'Account B');
    const foreignAsset = await createAsset(tenant, clientB, { name: 'B laptop', asset_tag: 'B-1', serial_number: 'SHARED' });
    const definition = await createDefinition(tenant);
    const submissionId = await createSubmission(tenant, definition, clientA, { device_serial: 'SHARED', device_tag: 'HIJACK' });
    await publishRules(tenant, definition.definitionId, [serialRule('asset_tag', 'device_tag')]);

    const run = await applyAnswerMapping({ knex: db, tenant, submissionId, actorUserId: actor.user_id, actorUser: actor });

    expect(run.results[0].status).toBe('failed_asset_unresolved');
    const untouched = await table(tenant, 'assets').where({ asset_id: foreignAsset }).first();
    expect(untouched.asset_tag).toBe('B-1');

    // answer-asset-ref with a foreign asset id is rejected the same way.
    const refDefinition = await createDefinition(tenant);
    const refSubmission = await createSubmission(tenant, refDefinition, clientA, { device_ref: foreignAsset, device_tag: 'HIJACK' });
    await publishRules(tenant, refDefinition.definitionId, [
      {
        questionKey: 'device_tag',
        destinationKind: 'asset',
        targetFieldKey: 'asset_tag',
        assetSelector: { strategy: 'answer-asset-ref', assetRefQuestionKey: 'device_ref' },
      },
    ]);
    const refRun = await applyAnswerMapping({ knex: db, tenant, submissionId: refSubmission, actorUserId: actor.user_id, actorUser: actor });
    expect(refRun.results[0].status).toBe('failed_asset_unresolved');
  });

  it('previews without writing and reports the same per-field outcomes', async () => {
    const tenant = await createTenant();
    const actor = await createFullAdmin(tenant);
    const clientId = await createClient(tenant, 'Acme');
    await createAsset(tenant, clientId, { name: 'Router', asset_tag: 'RT-1', serial_number: 'SN-1' });
    const definition = await createDefinition(tenant);
    const submissionId = await createSubmission(tenant, definition, clientId, {
      account_name: 'Acme Previewed',
      device_serial: 'SN-1',
      device_tag: 'RT-2',
      billing_cycle: 'never',
    });
    await publishRules(tenant, definition.definitionId, [
      accountRule('client_name', 'account_name'),
      serialRule('asset_tag', 'device_tag'),
      accountRule('billing_cycle', 'billing_cycle'),
    ]);

    const preview = await previewAnswerMapping({ knex: db, tenant, submissionId, actorUserId: actor.user_id, actorUser: actor });

    const statuses = new Map(preview.results.map((result) => [result.targetFieldKey, result] as const));
    expect(statuses.get('client_name')).toMatchObject({ status: 'applied', beforeValue: 'Acme', afterValue: 'Acme Previewed', resolvedTargetDisplay: 'Acme' });
    expect(statuses.get('asset_tag')).toMatchObject({ status: 'applied', resolvedTargetDisplay: 'Router' });
    expect(statuses.get('billing_cycle')?.status).toBe('failed_validation');

    const client = await table(tenant, 'clients').where({ client_id: clientId }).first();
    expect(client.client_name).toBe('Acme');
    const asset = await table(tenant, 'assets').where({ client_id: clientId }).first();
    expect(asset.asset_tag).toBe('RT-1');
    const applications = await table(tenant, 'service_request_submission_applications').where({ submission_id: submissionId });
    expect(applications).toHaveLength(0);
  });

  it('isolates a destination SQL rejection to one field and still finishes the run', async () => {
    const tenant = await createTenant();
    const actor = await createFullAdmin(tenant);
    const clientId = await createClient(tenant, 'SQL Account', { credit_limit: 500 });
    await createAsset(tenant, clientId, { name: 'SQL asset', asset_tag: 'SQL-1', serial_number: 'SN-SQL' });
    const definition = await createDefinition(tenant);
    // `tax_id_number` is varchar(255); a 300-char answer passes coercion and
    // model validation, then is rejected by Postgres (22001). That is a genuine
    // SQL-level rejection, which must not abort the run.
    const payload = {
      account_name: 'SQL Account Renamed',
      notes: 'x'.repeat(300),
      credit_limit: '1000',
      device_serial: 'SN-SQL',
      device_tag: 'SQL-TAG',
    };
    const submissionId = await createSubmission(tenant, definition, clientId, payload);
    const before = await loadPayload(tenant, submissionId);
    await publishRules(tenant, definition.definitionId, [
      accountRule('client_name', 'account_name'),
      accountRule('tax_id_number', 'notes'),
      accountRule('credit_limit', 'credit_limit'),
      serialRule('asset_tag', 'device_tag'),
    ]);

    const run = await applyAnswerMapping({ knex: db, tenant, submissionId, actorUserId: actor.user_id, actorUser: actor });

    // Terminal status, one result per rule — the SQL rejection did not abort.
    expect(run.status).toBe('partially_applied');
    expect(run.results).toHaveLength(4);
    const results = byField(run.results);
    expect(results.get('client_name')?.status).toBe('applied');
    expect(results.get('tax_id_number')).toMatchObject({
      status: 'failed_type_conversion',
      error_code: 'destination_rejected',
    });
    expect(results.get('credit_limit')).toMatchObject({ status: 'applied', after_value: 1000 });
    expect(results.get('asset_tag')?.status).toBe('applied');

    // Applied fields committed; the rejected field's destination is untouched.
    const client = await table(tenant, 'clients').where({ client_id: clientId }).first();
    expect(client.client_name).toBe('SQL Account Renamed');
    expect(Number(client.credit_limit)).toBe(1000);
    expect(client.tax_id_number).toBeNull();
    const asset = await table(tenant, 'assets').where({ client_id: clientId }).first();
    expect(asset.asset_tag).toBe('SQL-TAG');

    // Raw submission is byte-identical and not re-stamped.
    const after = await loadPayload(tenant, submissionId);
    expect(after?.submitted_payload).toEqual(before?.submitted_payload);
    expect(new Date(after!.updated_at).getTime()).toBe(new Date(before!.updated_at).getTime());

    // A per-field audit row exists for every rule plus the run-level event.
    const fieldApplied = await table(tenant, 'audit_logs')
      .where({
        table_name: 'service_request_submissions',
        record_id: submissionId,
        operation: 'service_request_submission_mapping_field_applied',
      })
      .count<{ count: string }[]>('* as count');
    const fieldFailed = await table(tenant, 'audit_logs')
      .where({
        table_name: 'service_request_submissions',
        record_id: submissionId,
        operation: 'service_request_submission_mapping_field_failed',
      })
      .count<{ count: string }[]>('* as count');
    expect(Number(fieldApplied[0].count)).toBe(3);
    expect(Number(fieldFailed[0].count)).toBe(1);
    const runAudit = await table(tenant, 'audit_logs')
      .where({
        table_name: 'service_request_submissions',
        record_id: submissionId,
        operation: 'service_request_submission_mapping_applied',
      })
      .count<{ count: string }[]>('* as count');
    expect(Number(runAudit[0].count)).toBe(1);

    const application = await table(tenant, 'service_request_submission_applications')
      .where({ application_id: run.application_id })
      .first<{ status: string }>('status');
    expect(application?.status).toBe('partially_applied');
  });

  it('takes over an abandoned pending claim without waiting for the settle timeout', async () => {
    const tenant = await createTenant();
    const actor = await createFullAdmin(tenant);
    const clientId = await createClient(tenant, 'Abandoned');
    const definition = await createDefinition(tenant);
    const submissionId = await createSubmission(tenant, definition, clientId, { account_name: 'Recovered' });
    const versionId = await publishRules(tenant, definition.definitionId, [
      accountRule('client_name', 'account_name'),
    ]);

    // A crashed run left the row pending with a stale heartbeat and no owner.
    const applicationId = uuidv4();
    const staleClaim = new Date(Date.now() - 60 * 60 * 1000);
    await table(tenant, 'service_request_submission_applications').insert({
      tenant,
      application_id: applicationId,
      submission_id: submissionId,
      mapping_version_id: versionId,
      applied_by: actor.user_id,
      status: 'pending',
      summary: {},
      claimed_at: staleClaim,
      applied_at: staleClaim,
    });

    const startedAt = Date.now();
    const run = await applyAnswerMapping({ knex: db, tenant, submissionId, actorUserId: actor.user_id, actorUser: actor });
    const elapsed = Date.now() - startedAt;

    expect(elapsed).toBeLessThan(5000);
    expect(run.replayed).toBe(false);
    expect(run.application_id).toBe(applicationId);
    expect(run.status).toBe('applied');
    expect(run.results).toHaveLength(1);

    const client = await table(tenant, 'clients').where({ client_id: clientId }).first();
    expect(client.client_name).toBe('Recovered');
    const rows = await table(tenant, 'service_request_submission_applications').where({ submission_id: submissionId });
    expect(rows).toHaveLength(1);
  });

  it('applies integer semantics to credit_limit in preview and apply alike', async () => {
    const tenant = await createTenant();
    const actor = await createFullAdmin(tenant);
    const clientId = await createClient(tenant, 'Credit', { credit_limit: 500 });
    const definition = await createDefinition(tenant);
    await publishRules(tenant, definition.definitionId, [
      accountRule('credit_limit', 'credit_limit'),
    ]);

    // Fractional input is rejected identically in preview and apply.
    const fractionalSubmission = await createSubmission(tenant, definition, clientId, { credit_limit: '1200.50' });
    const preview = await previewAnswerMapping({ knex: db, tenant, submissionId: fractionalSubmission, actorUserId: actor.user_id, actorUser: actor });
    expect(preview.results[0].status).toBe('failed_type_conversion');
    const fractionalRun = await applyAnswerMapping({ knex: db, tenant, submissionId: fractionalSubmission, actorUserId: actor.user_id, actorUser: actor });
    expect(fractionalRun.results[0].status).toBe('failed_type_conversion');
    expect(fractionalRun.results[0].error_detail).toBe(preview.results[0].errorDetail);
    const afterFractional = await table(tenant, 'clients').where({ client_id: clientId }).first();
    expect(Number(afterFractional.credit_limit)).toBe(500);

    // A whole-number string applies and persists exactly (no rounding).
    const integerSubmission = await createSubmission(tenant, definition, clientId, { credit_limit: '1200' });
    const integerRun = await applyAnswerMapping({ knex: db, tenant, submissionId: integerSubmission, actorUserId: actor.user_id, actorUser: actor });
    expect(integerRun.results[0].status).toBe('applied');
    const afterInteger = await table(tenant, 'clients').where({ client_id: clientId }).first();
    expect(Number(afterInteger.credit_limit)).toBe(1200);

    // Out-of-range input is rejected, leaving the destination at its last value.
    const hugeSubmission = await createSubmission(tenant, definition, clientId, { credit_limit: '99999999999999999999' });
    const hugePreview = await previewAnswerMapping({ knex: db, tenant, submissionId: hugeSubmission, actorUserId: actor.user_id, actorUser: actor });
    expect(hugePreview.results[0].status).toBe('failed_type_conversion');
    const hugeRun = await applyAnswerMapping({ knex: db, tenant, submissionId: hugeSubmission, actorUserId: actor.user_id, actorUser: actor });
    expect(hugeRun.results[0].status).toBe('failed_type_conversion');
    const afterHuge = await table(tenant, 'clients').where({ client_id: clientId }).first();
    expect(Number(afterHuge.credit_limit)).toBe(1200);
  });

  it('rejects impossible calendar dates instead of normalizing them', async () => {
    const tenant = await createTenant();
    const actor = await createFullAdmin(tenant);
    const clientId = await createClient(tenant, 'Dates');
    const assetId = await createAsset(tenant, clientId, {
      name: 'Warranty asset',
      asset_tag: 'W-1',
      serial_number: 'SN-DATE',
    });
    const definition = await createDefinition(tenant);
    await publishRules(tenant, definition.definitionId, [
      serialRule('warranty_end_date', 'warranty_end'),
    ]);

    for (const value of ['2027-02-30', '2027-02-29', '2027-04-31', '2100-02-29']) {
      const submissionId = await createSubmission(tenant, definition, clientId, {
        device_serial: 'SN-DATE',
        warranty_end: value,
      });
      const before = await loadPayload(tenant, submissionId);
      const run = await applyAnswerMapping({ knex: db, tenant, submissionId, actorUserId: actor.user_id, actorUser: actor });
      expect(run.results[0].status).toBe('failed_type_conversion');

      const asset = await table(tenant, 'assets').where({ asset_id: assetId }).first();
      expect(asset.warranty_end_date).toBeNull();

      const after = await loadPayload(tenant, submissionId);
      expect(after?.submitted_payload).toEqual(before?.submitted_payload);
      expect(after?.submitted_payload.warranty_end).toBe(value);
    }

    for (const [value, expected] of [['2028-02-29', '2028-02-29'], ['2027-02-28', '2027-02-28']] as const) {
      const submissionId = await createSubmission(tenant, definition, clientId, {
        device_serial: 'SN-DATE',
        warranty_end: value,
      });
      const run = await applyAnswerMapping({ knex: db, tenant, submissionId, actorUserId: actor.user_id, actorUser: actor });
      expect(run.results[0].status).toBe('applied');
      const asset = await table(tenant, 'assets').where({ asset_id: assetId }).first();
      expect(new Date(asset.warranty_end_date).toISOString().slice(0, 10)).toBe(expected);
    }
  });
});
