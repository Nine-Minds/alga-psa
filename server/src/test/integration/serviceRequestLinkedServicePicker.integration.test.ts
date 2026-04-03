import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  createBlankServiceRequestDefinition,
  searchServiceCatalogForLinking,
  setLinkedServiceForServiceRequestDefinitionDraft,
} from '../../lib/service-requests/definitionManagement';
import { getServiceRequestDefinitionEditorData } from '../../lib/service-requests/definitionEditor';

describe('service request linked-service picker', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('T010: admins can search service catalog and select a linked service from the editor linkage section', async () => {
    const tenant = uuidv4();
    const actor = uuidv4();
    const serviceTypeId = uuidv4();
    const firstServiceId = uuidv4();
    const secondServiceId = uuidv4();

    await db('tenants').insert({
      tenant,
      client_name: `Tenant ${tenant.slice(0, 8)}`,
      email: `tenant-${tenant.slice(0, 8)}@example.com`,
    });

    await db('service_types').insert({
      id: serviceTypeId,
      tenant,
      name: `Catalog Type ${serviceTypeId.slice(0, 8)}`,
      billing_method: 'fixed',
      order_number: 1,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await db('service_catalog').insert([
      {
        tenant,
        service_id: firstServiceId,
        service_name: 'Endpoint Onboarding',
        billing_method: 'fixed',
        custom_service_type_id: serviceTypeId,
      },
      {
        tenant,
        service_id: secondServiceId,
        service_name: 'Access Governance',
        billing_method: 'fixed',
        custom_service_type_id: serviceTypeId,
      },
    ]);

    const definition = await createBlankServiceRequestDefinition({
      knex: db,
      tenant,
      name: 'Link Test',
      createdBy: actor,
    });

    const matches = await searchServiceCatalogForLinking(db, tenant, 'Onboard');
    expect(matches).toHaveLength(1);
    expect(matches[0].service_id).toBe(firstServiceId);
    expect(matches[0].service_name).toBe('Endpoint Onboarding');

    await setLinkedServiceForServiceRequestDefinitionDraft({
      knex: db,
      tenant,
      definitionId: definition.definition_id,
      linkedServiceId: firstServiceId,
      updatedBy: actor,
    });

    const editorData = await getServiceRequestDefinitionEditorData(
      db,
      tenant,
      definition.definition_id
    );

    expect(editorData?.linkage.linkedServiceId).toBe(firstServiceId);
    expect(editorData?.linkage.linkedServiceName).toBe('Endpoint Onboarding');
  });
});
