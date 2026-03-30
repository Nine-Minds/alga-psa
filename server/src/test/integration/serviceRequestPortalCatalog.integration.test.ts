import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  groupServiceRequestCatalogItemsByCategory,
  listVisibleServiceRequestCatalogItems,
} from '../../lib/service-requests/portalCatalog';
import {
  registerServiceRequestProviders,
  resetServiceRequestProviderRegistry,
} from '../../lib/service-requests/providers/registry';
import type { ServiceRequestVisibilityProvider } from '../../lib/service-requests/providers/contracts';

describe('service request portal catalog', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
  });

  afterAll(async () => {
    resetServiceRequestProviderRegistry();
    if (db) {
      await db.destroy();
    }
  });

  it('T017: portal catalog lists only published and visible definitions, grouped by category with card metadata', async () => {
    resetServiceRequestProviderRegistry();

    const testVisibilityProvider: ServiceRequestVisibilityProvider = {
      key: 'test-visibility',
      displayName: 'Test Visibility',
      validateConfig: () => ({ isValid: true }),
      async canAccessDefinition(_context, _definition, config) {
        return config.allow !== false;
      },
    };
    registerServiceRequestProviders({
      executionProviders: [],
      formBehaviorProviders: [],
      visibilityProviders: [testVisibilityProvider],
      templateProviders: [],
      adminExtensionProviders: [],
    });

    const tenant = uuidv4();
    const requesterUserId = uuidv4();
    const clientId = uuidv4();
    const visiblePublishedId = uuidv4();
    const hiddenPublishedId = uuidv4();
    const draftId = uuidv4();
    const uncategorizedId = uuidv4();
    const visibleVersionId = uuidv4();
    const hiddenVersionId = uuidv4();
    const uncategorizedVersionId = uuidv4();

    await db('tenants').insert({
      tenant,
      client_name: `Tenant ${tenant.slice(0, 8)}`,
      email: `tenant-${tenant.slice(0, 8)}@example.com`,
    });

    await db('service_request_definitions').insert([
      {
        tenant,
        definition_id: visiblePublishedId,
        name: 'New Hire Setup',
        description: 'Provision standard onboarding access.',
        icon: 'user-plus',
        category_name_snapshot: 'Onboarding',
        sort_order: 1,
        form_schema: { fields: [] },
        execution_provider: 'ticket-only',
        execution_config: {},
        form_behavior_provider: 'basic',
        form_behavior_config: {},
        visibility_provider: 'test-visibility',
        visibility_config: { allow: true },
        lifecycle_state: 'published',
      },
      {
        tenant,
        definition_id: hiddenPublishedId,
        name: 'Executive Access',
        description: 'Restricted request.',
        icon: 'shield',
        category_name_snapshot: 'Onboarding',
        sort_order: 2,
        form_schema: { fields: [] },
        execution_provider: 'ticket-only',
        execution_config: {},
        form_behavior_provider: 'basic',
        form_behavior_config: {},
        visibility_provider: 'test-visibility',
        visibility_config: { allow: false },
        lifecycle_state: 'published',
      },
      {
        tenant,
        definition_id: draftId,
        name: 'Draft Only Request',
        description: 'Should not appear.',
        icon: 'drafting-compass',
        category_name_snapshot: 'Onboarding',
        sort_order: 3,
        form_schema: { fields: [] },
        execution_provider: 'ticket-only',
        execution_config: {},
        form_behavior_provider: 'basic',
        form_behavior_config: {},
        visibility_provider: 'test-visibility',
        visibility_config: { allow: true },
        lifecycle_state: 'draft',
      },
      {
        tenant,
        definition_id: uncategorizedId,
        name: 'General IT Help',
        description: 'Submit a general request.',
        icon: 'life-buoy',
        category_name_snapshot: null,
        sort_order: 10,
        form_schema: { fields: [] },
        execution_provider: 'ticket-only',
        execution_config: {},
        form_behavior_provider: 'basic',
        form_behavior_config: {},
        visibility_provider: 'all-authenticated-client-users',
        visibility_config: {},
        lifecycle_state: 'published',
      },
    ]);

    await db('service_request_definition_versions').insert([
      {
        tenant,
        version_id: visibleVersionId,
        definition_id: visiblePublishedId,
        version_number: 1,
        name: 'New Hire Setup',
        description: 'Provision standard onboarding access.',
        icon: 'user-plus',
        category_name_snapshot: 'Onboarding',
        sort_order: 1,
        form_schema_snapshot: { fields: [] },
        execution_provider: 'ticket-only',
        execution_config: {},
        form_behavior_provider: 'basic',
        form_behavior_config: {},
        visibility_provider: 'test-visibility',
        visibility_config: { allow: true },
      },
      {
        tenant,
        version_id: hiddenVersionId,
        definition_id: hiddenPublishedId,
        version_number: 1,
        name: 'Executive Access',
        description: 'Restricted request.',
        icon: 'shield',
        category_name_snapshot: 'Onboarding',
        sort_order: 2,
        form_schema_snapshot: { fields: [] },
        execution_provider: 'ticket-only',
        execution_config: {},
        form_behavior_provider: 'basic',
        form_behavior_config: {},
        visibility_provider: 'test-visibility',
        visibility_config: { allow: false },
      },
      {
        tenant,
        version_id: uncategorizedVersionId,
        definition_id: uncategorizedId,
        version_number: 1,
        name: 'General IT Help',
        description: 'Submit a general request.',
        icon: 'life-buoy',
        category_name_snapshot: null,
        sort_order: 10,
        form_schema_snapshot: { fields: [] },
        execution_provider: 'ticket-only',
        execution_config: {},
        form_behavior_provider: 'basic',
        form_behavior_config: {},
        visibility_provider: 'all-authenticated-client-users',
        visibility_config: {},
      },
    ]);

    const visibleItems = await listVisibleServiceRequestCatalogItems(db, {
      tenant,
      requesterUserId,
      clientId,
      contactId: null,
    });

    expect(visibleItems).toHaveLength(2);
    expect(visibleItems.map((item) => item.definitionId)).toEqual([
      visiblePublishedId,
      uncategorizedId,
    ]);
    expect(visibleItems[0]).toMatchObject({
      title: 'New Hire Setup',
      description: 'Provision standard onboarding access.',
      icon: 'user-plus',
      categoryName: 'Onboarding',
    });

    const grouped = groupServiceRequestCatalogItemsByCategory(visibleItems);
    expect(grouped).toHaveLength(2);
    expect(grouped[0].category).toBe('Onboarding');
    expect(grouped[0].items[0].title).toBe('New Hire Setup');
    expect(grouped[1].category).toBe('Other Services');
    expect(grouped[1].items[0].title).toBe('General IT Help');
  });
});
