import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { publishServiceRequestDefinition } from '../../lib/service-requests/definitionPublishing';
import { getServiceRequestSubmissionHistoryDetail } from '../../lib/service-requests/submissionHistory';

describe('service request submission history integrity', () => {
  let db: Knex;

  function tenantTable(tenant: string, table: string) {
    return tenantDb(db, tenant).table(table);
  }

  function tenantRows() {
    return tenantDb(db, '__test_tenant_fixture__')
      .unscoped('tenants', 'test fixture creates and removes tenant rows');
  }

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('T044: history rendering remains stable when linked service and category are renamed after submission', async () => {
    const tenant = uuidv4();
    const categoryId = uuidv4();
    const serviceId = uuidv4();
    const serviceTypeId = uuidv4();
    const definitionId = uuidv4();
    const submissionId = uuidv4();

    await tenantRows().insert({
      tenant,
      client_name: `Tenant ${tenant.slice(0, 8)}`,
      email: `tenant-${tenant.slice(0, 8)}@example.com`,
    });

    await tenantTable(tenant, 'service_categories').insert({
      tenant,
      category_id: categoryId,
      category_name: 'Onboarding',
    });

    await tenantTable(tenant, 'service_types').insert({
      id: serviceTypeId,
      tenant,
      name: `Request Type ${serviceTypeId.slice(0, 8)}`,
      billing_method: 'fixed',
      order_number: 1,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await tenantTable(tenant, 'service_catalog').insert({
      tenant,
      service_id: serviceId,
      service_name: 'Laptop Provisioning',
      billing_method: 'fixed',
      custom_service_type_id: serviceTypeId,
      category_id: categoryId,
    });

    await tenantTable(tenant, 'service_request_definitions').insert({
      tenant,
      definition_id: definitionId,
      name: 'New Hire Setup',
      category_id: categoryId,
      linked_service_id: serviceId,
      form_schema: { fields: [{ key: 'employee_name', type: 'short-text' }] },
      execution_provider: 'ticket-only',
      execution_config: {},
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {},
      lifecycle_state: 'draft',
    });

    const publishedVersion = await publishServiceRequestDefinition({
      knex: db,
      tenant,
      definitionId,
    });

    await tenantTable(tenant, 'service_request_submissions').insert({
      tenant,
      submission_id: submissionId,
      definition_id: definitionId,
      definition_version_id: publishedVersion.version_id,
      requester_user_id: uuidv4(),
      client_id: uuidv4(),
      contact_id: uuidv4(),
      request_name: 'New Hire Setup',
      submitted_payload: { employee_name: 'Avery Example' },
      execution_status: 'pending',
    });

    await tenantTable(tenant, 'service_categories').where({ tenant, category_id: categoryId }).update({
      category_name: 'User Lifecycle',
    });

    await tenantTable(tenant, 'service_catalog').where({ tenant, service_id: serviceId }).update({
      service_name: 'Workstation Provisioning',
    });

    const historyDetail = await getServiceRequestSubmissionHistoryDetail(db, tenant, submissionId);

    expect(historyDetail).not.toBeNull();
    expect(historyDetail).toMatchObject({
      category_id: categoryId,
      category_name_snapshot: 'Onboarding',
      linked_service_id: serviceId,
      linked_service_name_snapshot: 'Laptop Provisioning',
      request_name: 'New Hire Setup',
      submitted_payload: { employee_name: 'Avery Example' },
    });
  });
});
