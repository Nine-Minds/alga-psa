// Import mocks first to ensure they're hoisted
import 'server/test-utils/testMocks';

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { TestContext } from 'server/test-utils/testContext';
import { setupCommonMocks } from 'server/test-utils/testMocks';
import { v4 as uuidv4 } from 'uuid';

import {
  getSlaSettings,
  updateSlaSettings,
  getStatusSlaPauseConfigs,
  getSlaPauseConfigForStatus,
  setStatusSlaPauseConfig,
  bulkUpdateStatusSlaPauseConfigs,
  shouldSlaBePaused,
  deleteStatusSlaPauseConfig
} from '@alga-psa/sla/actions';

const HOOK_TIMEOUT = 120_000;

describe('SLA Pause Config Actions Integration Tests', () => {
  const {
    beforeAll: setupContext,
    beforeEach: resetContext,
    afterEach: rollbackContext,
    afterAll: cleanupContext
  } = TestContext.createHelpers();

  let context: TestContext;
  let testStatusId: string;

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'tickets',
        'status_sla_pause_config',
        'sla_settings',
        'statuses'
      ]
    });

    setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      user: context.user,
      permissionCheck: () => true
    });
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    context = await resetContext();
    setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      user: context.user,
      permissionCheck: () => true
    });

    // Create a test status for the pause config tests
    const statusResult = await context.db('statuses')
      .insert({
        tenant: context.tenantId,
        name: 'Test Status',
        status_type: 'ticket',
        order_number: 1,
        is_closed: false,
        created_by: context.userId
      })
      .returning('status_id');

    testStatusId = statusResult[0].status_id;
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await rollbackContext();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await cleanupContext();
  }, HOOK_TIMEOUT);

  // ============================================================================
  // SLA Settings Tests
  // ============================================================================
  describe('SLA Settings (getSlaSettings, updateSlaSettings)', () => {
    it('should get SLA settings and create defaults if not exist', async () => {
      const settings = await getSlaSettings();

      expect(settings).toBeDefined();
      expect(settings.tenant).toBe(context.tenantId);
      expect(typeof settings.pause_on_awaiting_client).toBe('boolean');
      // Default value should be true
      expect(settings.pause_on_awaiting_client).toBe(true);
    });

    it('should return existing settings when they already exist', async () => {
      // First call creates settings
      const settings1 = await getSlaSettings();

      // Second call should return existing settings
      const settings2 = await getSlaSettings();

      expect(settings1.tenant).toBe(settings2.tenant);
      expect(settings1.pause_on_awaiting_client).toBe(settings2.pause_on_awaiting_client);
    });

    it('should update SLA settings - enable pause_on_awaiting_client', async () => {
      // First ensure settings exist
      await getSlaSettings();

      // Update to enable
      const updated = await updateSlaSettings({ pause_on_awaiting_client: true });

      expect(updated.pause_on_awaiting_client).toBe(true);
      expect(updated.updated_at).toBeDefined();
    });

    it('should update SLA settings - disable pause_on_awaiting_client', async () => {
      // First ensure settings exist
      await getSlaSettings();

      // Update to disable
      const updated = await updateSlaSettings({ pause_on_awaiting_client: false });

      expect(updated.pause_on_awaiting_client).toBe(false);
    });

    it('should create settings if they do not exist during update', async () => {
      // Directly update without getting first
      const updated = await updateSlaSettings({ pause_on_awaiting_client: false });

      expect(updated).toBeDefined();
      expect(updated.tenant).toBe(context.tenantId);
      expect(updated.pause_on_awaiting_client).toBe(false);
    });

    it('should preserve existing settings when updating partial data', async () => {
      // Create initial settings
      await updateSlaSettings({ pause_on_awaiting_client: true });

      // Get settings to verify
      const settings = await getSlaSettings();
      expect(settings.pause_on_awaiting_client).toBe(true);
    });
  });

  // ============================================================================
  // Status SLA Pause Config CRUD Tests
  // ============================================================================
  describe('Status Pause Config CRUD', () => {
    it('should get all status SLA pause configs', async () => {
      // Create some configs first
      await setStatusSlaPauseConfig(testStatusId, true);

      const status2Result = await context.db('statuses')
        .insert({
          tenant: context.tenantId,
          name: 'Another Status',
          status_type: 'ticket',
          order_number: 2,
          is_closed: false,
          created_by: context.userId
        })
        .returning('status_id');

      await setStatusSlaPauseConfig(status2Result[0].status_id, false);

      const configs = await getStatusSlaPauseConfigs();

      expect(configs.length).toBeGreaterThanOrEqual(2);
      expect(configs.some(c => c.status_id === testStatusId)).toBe(true);
      expect(configs.some(c => c.status_id === status2Result[0].status_id)).toBe(true);
    });

    it('should get SLA pause config for a specific status', async () => {
      await setStatusSlaPauseConfig(testStatusId, true);

      const config = await getSlaPauseConfigForStatus(testStatusId);

      expect(config).toBeDefined();
      expect(config!.status_id).toBe(testStatusId);
      expect(config!.pauses_sla).toBe(true);
    });

    it('should return null for status without config', async () => {
      const config = await getSlaPauseConfigForStatus(uuidv4());
      expect(config).toBeNull();
    });

    it('should set status SLA pause config - create new', async () => {
      const config = await setStatusSlaPauseConfig(testStatusId, true);

      expect(config).toBeDefined();
      expect(config.config_id).toBeDefined();
      expect(config.status_id).toBe(testStatusId);
      expect(config.pauses_sla).toBe(true);
      expect(config.tenant).toBe(context.tenantId);
    });

    it('should set status SLA pause config - update existing', async () => {
      // Create initial config
      await setStatusSlaPauseConfig(testStatusId, true);

      // Update to false
      const updated = await setStatusSlaPauseConfig(testStatusId, false);

      expect(updated.pauses_sla).toBe(false);

      // Verify only one config exists for this status
      const configs = await getStatusSlaPauseConfigs();
      const statusConfigs = configs.filter(c => c.status_id === testStatusId);
      expect(statusConfigs).toHaveLength(1);
    });

    it('should delete status SLA pause config', async () => {
      await setStatusSlaPauseConfig(testStatusId, true);

      const deleted = await deleteStatusSlaPauseConfig(testStatusId);
      expect(deleted).toBe(true);

      const config = await getSlaPauseConfigForStatus(testStatusId);
      expect(config).toBeNull();
    });

    it('should return false when deleting non-existent config', async () => {
      const deleted = await deleteStatusSlaPauseConfig(uuidv4());
      expect(deleted).toBe(false);
    });
  });

  // ============================================================================
  // Bulk Update Status Pause Configs Tests
  // ============================================================================
  describe('Bulk Update Status SLA Pause Configs', () => {
    it('should bulk update multiple status configs', async () => {
      const status2Result = await context.db('statuses')
        .insert({
          tenant: context.tenantId,
          name: 'Bulk Status 2',
          status_type: 'ticket',
          order_number: 2,
          is_closed: false,
          created_by: context.userId
        })
        .returning('status_id');

      const status3Result = await context.db('statuses')
        .insert({
          tenant: context.tenantId,
          name: 'Bulk Status 3',
          status_type: 'ticket',
          order_number: 3,
          is_closed: false,
          created_by: context.userId
        })
        .returning('status_id');

      const results = await bulkUpdateStatusSlaPauseConfigs([
        { statusId: testStatusId, pausesSla: true },
        { statusId: status2Result[0].status_id, pausesSla: false },
        { statusId: status3Result[0].status_id, pausesSla: true }
      ]);

      expect(results).toHaveLength(3);

      const config1 = results.find(c => c.status_id === testStatusId);
      const config2 = results.find(c => c.status_id === status2Result[0].status_id);
      const config3 = results.find(c => c.status_id === status3Result[0].status_id);

      expect(config1!.pauses_sla).toBe(true);
      expect(config2!.pauses_sla).toBe(false);
      expect(config3!.pauses_sla).toBe(true);
    });

    it('should return empty array when bulk updating with empty input', async () => {
      const results = await bulkUpdateStatusSlaPauseConfigs([]);
      expect(results).toHaveLength(0);
    });

    it('should handle mix of creates and updates in bulk operation', async () => {
      // Create initial config
      await setStatusSlaPauseConfig(testStatusId, false);

      const status2Result = await context.db('statuses')
        .insert({
          tenant: context.tenantId,
          name: 'New Bulk Status',
          status_type: 'ticket',
          order_number: 2,
          is_closed: false,
          created_by: context.userId
        })
        .returning('status_id');

      // Bulk update - one existing, one new
      const results = await bulkUpdateStatusSlaPauseConfigs([
        { statusId: testStatusId, pausesSla: true },  // Update existing
        { statusId: status2Result[0].status_id, pausesSla: true }  // Create new
      ]);

      expect(results).toHaveLength(2);

      const updatedConfig = await getSlaPauseConfigForStatus(testStatusId);
      expect(updatedConfig!.pauses_sla).toBe(true);

      const newConfig = await getSlaPauseConfigForStatus(status2Result[0].status_id);
      expect(newConfig!.pauses_sla).toBe(true);
    });
  });

  // ============================================================================
  // shouldSlaBePaused Logic Tests
  // ============================================================================
  describe('shouldSlaBePaused Logic', () => {
    let testTicketId: string;
    let testPriorityId: string;
    let testCategoryId: string;

    beforeEach(async () => {
      // Create necessary test data for tickets
      const priorityResult = await context.db('priorities')
        .insert({
          tenant: context.tenantId,
          priority_name: 'Medium',
          priority_order: 1
        })
        .returning('priority_id');
      testPriorityId = priorityResult[0].priority_id;

      const categoryResult = await context.db('ticket_categories')
        .insert({
          tenant: context.tenantId,
          category_name: 'Test Category'
        })
        .returning('category_id');
      testCategoryId = categoryResult[0].category_id;

      // Create a channel for tickets
      const channelResult = await context.db('channels')
        .insert({
          tenant: context.tenantId,
          channel_name: 'Email',
          is_inactive: false
        })
        .returning('channel_id');
      const testChannelId = channelResult[0].channel_id;

      // Create a test ticket
      const ticketResult = await context.db('tickets')
        .insert({
          tenant: context.tenantId,
          ticket_number: 'TEST-001',
          title: 'Test Ticket',
          company_id: context.clientId,
          status_id: testStatusId,
          priority_id: testPriorityId,
          category_id: testCategoryId,
          channel_id: testChannelId,
          entered_by: context.userId,
          response_state: 'not_set'
        })
        .returning('ticket_id');
      testTicketId = ticketResult[0].ticket_id;
    });

    it('should return paused=false when no pause conditions are met', async () => {
      // Ensure SLA settings have pause_on_awaiting_client disabled
      await updateSlaSettings({ pause_on_awaiting_client: false });

      const result = await shouldSlaBePaused(testTicketId);

      expect(result.paused).toBe(false);
      expect(result.reason).toBeNull();
    });

    it('should return paused=true with reason awaiting_client when ticket is awaiting client', async () => {
      // Enable pause_on_awaiting_client
      await updateSlaSettings({ pause_on_awaiting_client: true });

      // Update ticket to awaiting_client state
      await context.db('tickets')
        .where({ ticket_id: testTicketId, tenant: context.tenantId })
        .update({ response_state: 'awaiting_client' });

      const result = await shouldSlaBePaused(testTicketId);

      expect(result.paused).toBe(true);
      expect(result.reason).toBe('awaiting_client');
    });

    it('should return paused=false when awaiting client but setting is disabled', async () => {
      // Disable pause_on_awaiting_client
      await updateSlaSettings({ pause_on_awaiting_client: false });

      // Update ticket to awaiting_client state
      await context.db('tickets')
        .where({ ticket_id: testTicketId, tenant: context.tenantId })
        .update({ response_state: 'awaiting_client' });

      const result = await shouldSlaBePaused(testTicketId);

      expect(result.paused).toBe(false);
      expect(result.reason).toBeNull();
    });

    it('should return paused=true with reason status_pause when status pauses SLA', async () => {
      // Disable awaiting client pause
      await updateSlaSettings({ pause_on_awaiting_client: false });

      // Set the status to pause SLA
      await setStatusSlaPauseConfig(testStatusId, true);

      const result = await shouldSlaBePaused(testTicketId);

      expect(result.paused).toBe(true);
      expect(result.reason).toBe('status_pause');
    });

    it('should return paused=false when status config exists but pauses_sla is false', async () => {
      await updateSlaSettings({ pause_on_awaiting_client: false });
      await setStatusSlaPauseConfig(testStatusId, false);

      const result = await shouldSlaBePaused(testTicketId);

      expect(result.paused).toBe(false);
      expect(result.reason).toBeNull();
    });

    it('should prioritize awaiting_client over status_pause', async () => {
      // Enable both pause conditions
      await updateSlaSettings({ pause_on_awaiting_client: true });
      await setStatusSlaPauseConfig(testStatusId, true);

      // Set ticket to awaiting_client
      await context.db('tickets')
        .where({ ticket_id: testTicketId, tenant: context.tenantId })
        .update({ response_state: 'awaiting_client' });

      const result = await shouldSlaBePaused(testTicketId);

      // Should return awaiting_client as it's checked first
      expect(result.paused).toBe(true);
      expect(result.reason).toBe('awaiting_client');
    });

    it('should throw error for non-existent ticket', async () => {
      await expect(shouldSlaBePaused(uuidv4())).rejects.toThrow('not found');
    });

    it('should use default settings when no settings exist', async () => {
      // Ensure no settings exist by deleting them
      await context.db('sla_settings')
        .where({ tenant: context.tenantId })
        .delete();

      // Set ticket to awaiting_client
      await context.db('tickets')
        .where({ ticket_id: testTicketId, tenant: context.tenantId })
        .update({ response_state: 'awaiting_client' });

      const result = await shouldSlaBePaused(testTicketId);

      // Default is pause_on_awaiting_client: true
      expect(result.paused).toBe(true);
      expect(result.reason).toBe('awaiting_client');
    });

    it('should handle ticket without status pause config', async () => {
      await updateSlaSettings({ pause_on_awaiting_client: false });

      // Don't set any status config - ticket should not be paused
      const result = await shouldSlaBePaused(testTicketId);

      expect(result.paused).toBe(false);
      expect(result.reason).toBeNull();
    });
  });

  // ============================================================================
  // Combined Pause Logic Scenarios Tests
  // ============================================================================
  describe('Combined Pause Logic Scenarios', () => {
    let testTicketId: string;
    let testPriorityId: string;
    let testCategoryId: string;

    beforeEach(async () => {
      // Create necessary test data
      const priorityResult = await context.db('priorities')
        .insert({
          tenant: context.tenantId,
          priority_name: 'High',
          priority_order: 1
        })
        .returning('priority_id');
      testPriorityId = priorityResult[0].priority_id;

      const categoryResult = await context.db('ticket_categories')
        .insert({
          tenant: context.tenantId,
          category_name: 'Support Category'
        })
        .returning('category_id');
      testCategoryId = categoryResult[0].category_id;

      const channelResult = await context.db('channels')
        .insert({
          tenant: context.tenantId,
          channel_name: 'Phone',
          is_inactive: false
        })
        .returning('channel_id');
      const testChannelId = channelResult[0].channel_id;

      const ticketResult = await context.db('tickets')
        .insert({
          tenant: context.tenantId,
          ticket_number: 'TEST-002',
          title: 'Combined Test Ticket',
          company_id: context.clientId,
          status_id: testStatusId,
          priority_id: testPriorityId,
          category_id: testCategoryId,
          channel_id: testChannelId,
          entered_by: context.userId,
          response_state: 'not_set'
        })
        .returning('ticket_id');
      testTicketId = ticketResult[0].ticket_id;
    });

    it('scenario: both conditions off, ticket not awaiting - not paused', async () => {
      await updateSlaSettings({ pause_on_awaiting_client: false });
      await setStatusSlaPauseConfig(testStatusId, false);

      const result = await shouldSlaBePaused(testTicketId);
      expect(result.paused).toBe(false);
    });

    it('scenario: awaiting_client on, status off, ticket awaiting - paused (awaiting)', async () => {
      await updateSlaSettings({ pause_on_awaiting_client: true });
      await setStatusSlaPauseConfig(testStatusId, false);

      await context.db('tickets')
        .where({ ticket_id: testTicketId, tenant: context.tenantId })
        .update({ response_state: 'awaiting_client' });

      const result = await shouldSlaBePaused(testTicketId);
      expect(result.paused).toBe(true);
      expect(result.reason).toBe('awaiting_client');
    });

    it('scenario: awaiting_client off, status on, ticket not awaiting - paused (status)', async () => {
      await updateSlaSettings({ pause_on_awaiting_client: false });
      await setStatusSlaPauseConfig(testStatusId, true);

      const result = await shouldSlaBePaused(testTicketId);
      expect(result.paused).toBe(true);
      expect(result.reason).toBe('status_pause');
    });

    it('scenario: awaiting_client on, status on, ticket awaiting - paused (awaiting takes precedence)', async () => {
      await updateSlaSettings({ pause_on_awaiting_client: true });
      await setStatusSlaPauseConfig(testStatusId, true);

      await context.db('tickets')
        .where({ ticket_id: testTicketId, tenant: context.tenantId })
        .update({ response_state: 'awaiting_client' });

      const result = await shouldSlaBePaused(testTicketId);
      expect(result.paused).toBe(true);
      expect(result.reason).toBe('awaiting_client');
    });

    it('scenario: awaiting_client on, status on, ticket not awaiting - paused (status)', async () => {
      await updateSlaSettings({ pause_on_awaiting_client: true });
      await setStatusSlaPauseConfig(testStatusId, true);

      const result = await shouldSlaBePaused(testTicketId);
      expect(result.paused).toBe(true);
      expect(result.reason).toBe('status_pause');
    });

    it('scenario: change ticket status to one that pauses SLA', async () => {
      await updateSlaSettings({ pause_on_awaiting_client: false });

      // Create a new status that pauses SLA
      const pendingStatusResult = await context.db('statuses')
        .insert({
          tenant: context.tenantId,
          name: 'Pending External',
          status_type: 'ticket',
          order_number: 5,
          is_closed: false,
          created_by: context.userId
        })
        .returning('status_id');

      await setStatusSlaPauseConfig(pendingStatusResult[0].status_id, true);

      // Update ticket to the new status
      await context.db('tickets')
        .where({ ticket_id: testTicketId, tenant: context.tenantId })
        .update({ status_id: pendingStatusResult[0].status_id });

      const result = await shouldSlaBePaused(testTicketId);
      expect(result.paused).toBe(true);
      expect(result.reason).toBe('status_pause');
    });

    it('scenario: change ticket response_state from awaiting to not_set', async () => {
      await updateSlaSettings({ pause_on_awaiting_client: true });
      await setStatusSlaPauseConfig(testStatusId, false);

      // First set to awaiting
      await context.db('tickets')
        .where({ ticket_id: testTicketId, tenant: context.tenantId })
        .update({ response_state: 'awaiting_client' });

      let result = await shouldSlaBePaused(testTicketId);
      expect(result.paused).toBe(true);
      expect(result.reason).toBe('awaiting_client');

      // Change back to not_set
      await context.db('tickets')
        .where({ ticket_id: testTicketId, tenant: context.tenantId })
        .update({ response_state: 'not_set' });

      result = await shouldSlaBePaused(testTicketId);
      expect(result.paused).toBe(false);
    });
  });

  // ============================================================================
  // Multi-Tenant Isolation Tests
  // ============================================================================
  describe('Multi-Tenant Isolation', () => {
    it('should isolate SLA settings by tenant', async () => {
      // Update current tenant settings
      await updateSlaSettings({ pause_on_awaiting_client: false });

      // Insert settings for a different tenant directly
      const otherTenantId = uuidv4();
      await context.db('tenants').insert({
        tenant: otherTenantId,
        client_name: 'Other SLA Tenant',
        email: 'other-sla@test.com'
      });

      await context.db('sla_settings').insert({
        tenant: otherTenantId,
        pause_on_awaiting_client: true
      });

      // Get settings should return current tenant's settings
      const settings = await getSlaSettings();
      expect(settings.pause_on_awaiting_client).toBe(false);
    });

    it('should isolate status pause configs by tenant', async () => {
      // Create config for current tenant
      await setStatusSlaPauseConfig(testStatusId, true);

      // Insert config for different tenant directly
      const otherTenantId = uuidv4();
      const otherStatusId = uuidv4();

      await context.db('tenants').insert({
        tenant: otherTenantId,
        client_name: 'Other Config Tenant',
        email: 'other-config@test.com'
      });

      await context.db('statuses').insert({
        tenant: otherTenantId,
        status_id: otherStatusId,
        name: 'Other Tenant Status',
        status_type: 'ticket',
        order_number: 1,
        is_closed: false
      });

      await context.db('status_sla_pause_config').insert({
        tenant: otherTenantId,
        config_id: uuidv4(),
        status_id: otherStatusId,
        pauses_sla: true
      });

      // Get configs should only return current tenant's configs
      const configs = await getStatusSlaPauseConfigs();
      const statusIds = configs.map(c => c.status_id);

      expect(statusIds).toContain(testStatusId);
      expect(statusIds).not.toContain(otherStatusId);
    });

    it('should not be able to get other tenant status config', async () => {
      const otherTenantId = uuidv4();
      const otherStatusId = uuidv4();

      await context.db('tenants').insert({
        tenant: otherTenantId,
        client_name: 'Isolated Config Tenant',
        email: 'isolated@test.com'
      });

      await context.db('statuses').insert({
        tenant: otherTenantId,
        status_id: otherStatusId,
        name: 'Isolated Status',
        status_type: 'ticket',
        order_number: 1,
        is_closed: false
      });

      await context.db('status_sla_pause_config').insert({
        tenant: otherTenantId,
        config_id: uuidv4(),
        status_id: otherStatusId,
        pauses_sla: true
      });

      // Try to get other tenant's config
      const config = await getSlaPauseConfigForStatus(otherStatusId);
      expect(config).toBeNull();
    });

    it('should not affect other tenant when deleting config', async () => {
      const otherTenantId = uuidv4();
      const otherStatusId = uuidv4();

      await context.db('tenants').insert({
        tenant: otherTenantId,
        client_name: 'Delete Test Tenant',
        email: 'delete-test@test.com'
      });

      await context.db('statuses').insert({
        tenant: otherTenantId,
        status_id: otherStatusId,
        name: 'Delete Test Status',
        status_type: 'ticket',
        order_number: 1,
        is_closed: false
      });

      await context.db('status_sla_pause_config').insert({
        tenant: otherTenantId,
        config_id: uuidv4(),
        status_id: otherStatusId,
        pauses_sla: true
      });

      // Create config for current tenant
      await setStatusSlaPauseConfig(testStatusId, true);

      // Delete current tenant's config
      await deleteStatusSlaPauseConfig(testStatusId);

      // Other tenant's config should still exist
      const otherConfig = await context.db('status_sla_pause_config')
        .where({ tenant: otherTenantId, status_id: otherStatusId })
        .first();

      expect(otherConfig).toBeDefined();
      expect(otherConfig.pauses_sla).toBe(true);
    });
  });
});
