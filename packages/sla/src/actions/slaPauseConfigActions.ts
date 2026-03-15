'use server';

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { Knex } from 'knex';
import {
  ISlaSettings,
  IStatusSlaPauseConfig,
  SlaPauseReason
} from '../types';

export interface ISlaPauseConfigStatusOption {
  status_id: string;
  board_id: string;
  board_name: string;
  name: string;
  is_closed: boolean;
  order_number: number | null;
}

async function getBoardOwnedTicketStatus(
  trx: Knex.Transaction,
  tenant: string,
  statusId: string
) {
  return trx('statuses')
    .select('status_id')
    .where({
      tenant,
      status_id: statusId,
      status_type: 'ticket'
    })
    .whereNotNull('board_id')
    .first();
}

async function assertBoardOwnedTicketStatus(
  trx: Knex.Transaction,
  tenant: string,
  statusId: string
): Promise<void> {
  const status = await getBoardOwnedTicketStatus(trx, tenant, statusId);

  if (!status) {
    throw new Error('SLA pause configuration requires a board-owned ticket status');
  }
}

// ============================================================================
// SLA Settings (global per tenant)
// ============================================================================

/**
 * Get SLA settings for the current tenant.
 * Creates default settings if none exist.
 */
export const getSlaSettings = withAuth(async (_user, { tenant }): Promise<ISlaSettings> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Try to get existing settings
      let settings = await trx('sla_settings')
        .where({ tenant })
        .first();

      // If no settings exist, create default settings
      if (!settings) {
        const defaultSettings = {
          tenant,
          pause_on_awaiting_client: true,
        };

        const [inserted] = await trx('sla_settings')
          .insert(defaultSettings)
          .returning('*');

        settings = inserted;
      }

      return {
        tenant: settings.tenant,
        pause_on_awaiting_client: settings.pause_on_awaiting_client,
        created_at: settings.created_at,
        updated_at: settings.updated_at,
      } as ISlaSettings;
    } catch (error) {
      console.error(`Error fetching SLA settings for tenant ${tenant}:`, error);
      throw new Error(`Failed to fetch SLA settings for tenant ${tenant}`);
    }
  });
});

/**
 * Update SLA settings for the current tenant.
 * Creates settings if they don't exist (upsert pattern).
 */
export const updateSlaSettings = withAuth(async (_user, { tenant }, settings: Partial<ISlaSettings>): Promise<ISlaSettings> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Check if settings exist
      const existingSettings = await trx('sla_settings')
        .where({ tenant })
        .first();

      let result;

      if (existingSettings) {
        // Update existing settings
        const [updated] = await trx('sla_settings')
          .where({ tenant })
          .update({
            pause_on_awaiting_client: settings.pause_on_awaiting_client ?? existingSettings.pause_on_awaiting_client,
            updated_at: trx.fn.now(),
          })
          .returning('*');

        result = updated;
      } else {
        // Insert new settings
        const [inserted] = await trx('sla_settings')
          .insert({
            tenant,
            pause_on_awaiting_client: settings.pause_on_awaiting_client ?? true,
          })
          .returning('*');

        result = inserted;
      }

      return {
        tenant: result.tenant,
        pause_on_awaiting_client: result.pause_on_awaiting_client,
        created_at: result.created_at,
        updated_at: result.updated_at,
      } as ISlaSettings;
    } catch (error) {
      console.error(`Error updating SLA settings for tenant ${tenant}:`, error);
      throw new Error(`Failed to update SLA settings for tenant ${tenant}`);
    }
  });
});

// ============================================================================
// Status SLA Pause Configuration
// ============================================================================

/**
 * Get all status SLA pause configurations for the current tenant.
 */
export const getStatusSlaPauseConfigs = withAuth(async (_user, { tenant }): Promise<IStatusSlaPauseConfig[]> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const configs = await trx('status_sla_pause_config as config')
        .join('statuses as status', function () {
          this.on('config.tenant', '=', 'status.tenant')
            .andOn('config.status_id', '=', 'status.status_id');
        })
        .where({
          'config.tenant': tenant,
          'status.status_type': 'ticket',
        })
        .whereNotNull('status.board_id')
        .select('config.*');

      return configs.map((config): IStatusSlaPauseConfig => ({
        tenant: config.tenant,
        config_id: config.config_id,
        status_id: config.status_id,
        pauses_sla: config.pauses_sla,
        created_at: config.created_at,
      }));
    } catch (error) {
      console.error(`Error fetching status SLA pause configs for tenant ${tenant}:`, error);
      throw new Error(`Failed to fetch status SLA pause configs for tenant ${tenant}`);
    }
  });
});

/**
 * Get the SLA pause configuration for a specific status.
 */
export const getSlaPauseConfigForStatus = withAuth(async (_user, { tenant }, statusId: string): Promise<IStatusSlaPauseConfig | null> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const config = await trx('status_sla_pause_config as config')
        .join('statuses as status', function () {
          this.on('config.tenant', '=', 'status.tenant')
            .andOn('config.status_id', '=', 'status.status_id');
        })
        .where({
          'config.tenant': tenant,
          'config.status_id': statusId,
          'status.status_type': 'ticket',
        })
        .whereNotNull('status.board_id')
        .select('config.*')
        .first();

      if (!config) {
        return null;
      }

      return {
        tenant: config.tenant,
        config_id: config.config_id,
        status_id: config.status_id,
        pauses_sla: config.pauses_sla,
        created_at: config.created_at,
      } as IStatusSlaPauseConfig;
    } catch (error) {
      console.error(`Error fetching SLA pause config for status ${statusId}:`, error);
      throw new Error(`Failed to fetch SLA pause config for status ${statusId}`);
    }
  });
});

/**
 * Set the SLA pause configuration for a specific status.
 * Uses upsert pattern - inserts if not exists, updates if exists.
 */
export const setStatusSlaPauseConfig = withAuth(async (
  _user,
  { tenant },
  statusId: string,
  pausesSla: boolean
): Promise<IStatusSlaPauseConfig> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      await assertBoardOwnedTicketStatus(trx, tenant, statusId);

      // Check if config exists for this status
      const existingConfig = await trx('status_sla_pause_config')
        .where({ tenant, status_id: statusId })
        .first();

      let result;

      if (existingConfig) {
        // Update existing config
        const [updated] = await trx('status_sla_pause_config')
          .where({ tenant, status_id: statusId })
          .update({
            pauses_sla: pausesSla,
          })
          .returning('*');

        result = updated;
      } else {
        // Insert new config
        const [inserted] = await trx('status_sla_pause_config')
          .insert({
            tenant,
            status_id: statusId,
            pauses_sla: pausesSla,
          })
          .returning('*');

        result = inserted;
      }

      return {
        tenant: result.tenant,
        config_id: result.config_id,
        status_id: result.status_id,
        pauses_sla: result.pauses_sla,
        created_at: result.created_at,
      } as IStatusSlaPauseConfig;
    } catch (error) {
      console.error(`Error setting SLA pause config for status ${statusId}:`, error);
      throw new Error(`Failed to set SLA pause config for status ${statusId}`);
    }
  });
});

/**
 * Bulk update status SLA pause configurations.
 * Efficiently updates multiple status configurations in a single transaction.
 */
export const bulkUpdateStatusSlaPauseConfigs = withAuth(async (
  _user,
  { tenant },
  configs: Array<{ statusId: string; pausesSla: boolean }>
): Promise<IStatusSlaPauseConfig[]> => {
  const { knex: db } = await createTenantKnex();

  if (configs.length === 0) {
    return [];
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      for (const config of configs) {
        await assertBoardOwnedTicketStatus(trx, tenant, config.statusId);
      }

      const results: IStatusSlaPauseConfig[] = [];

      for (const config of configs) {
        // Check if config exists for this status
        const existingConfig = await trx('status_sla_pause_config')
          .where({ tenant, status_id: config.statusId })
          .first();

        let result;

        if (existingConfig) {
          // Update existing config
          const [updated] = await trx('status_sla_pause_config')
            .where({ tenant, status_id: config.statusId })
            .update({
              pauses_sla: config.pausesSla,
            })
            .returning('*');

          result = updated;
        } else {
          // Insert new config
          const [inserted] = await trx('status_sla_pause_config')
            .insert({
              tenant,
              status_id: config.statusId,
              pauses_sla: config.pausesSla,
            })
            .returning('*');

          result = inserted;
        }

        results.push({
          tenant: result.tenant,
          config_id: result.config_id,
          status_id: result.status_id,
          pauses_sla: result.pauses_sla,
          created_at: result.created_at,
        });
      }

      return results;
    } catch (error) {
      console.error(`Error bulk updating SLA pause configs for tenant ${tenant}:`, error);
      throw new Error(`Failed to bulk update SLA pause configs for tenant ${tenant}`);
    }
  });
});

/**
 * Get board-owned ticket statuses for SLA pause configuration.
 * Duplicate names remain distinguishable by including board context.
 */
export const getBoardOwnedTicketStatusesForSlaPauseConfig = withAuth(async (
  _user,
  { tenant }
): Promise<ISlaPauseConfigStatusOption[]> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const rows = await trx('statuses as status')
        .join('boards as board', function () {
          this.on('status.tenant', '=', 'board.tenant')
            .andOn('status.board_id', '=', 'board.board_id');
        })
        .where({
          'status.tenant': tenant,
          'status.status_type': 'ticket',
        })
        .whereNotNull('status.board_id')
        .select(
          'status.status_id',
          'status.board_id',
          'status.name',
          'status.is_closed',
          'status.order_number',
          'board.board_name'
        )
        .orderBy('board.display_order', 'asc')
        .orderBy('board.board_name', 'asc')
        .orderBy('status.order_number', 'asc')
        .orderBy('status.name', 'asc');

      return rows.map((row) => ({
        status_id: row.status_id,
        board_id: row.board_id,
        board_name: row.board_name,
        name: row.name,
        is_closed: row.is_closed,
        order_number: row.order_number ?? null,
      }));
    } catch (error) {
      console.error(`Error fetching board-owned ticket statuses for tenant ${tenant}:`, error);
      throw new Error(`Failed to fetch board-owned ticket statuses for tenant ${tenant}`);
    }
  });
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if SLA should be paused for the current state of a ticket.
 * Checks both:
 * - If `pause_on_awaiting_client` is enabled AND ticket's `response_state = 'awaiting_client'`
 * - If ticket's current status has `pauses_sla = true` in status_sla_pause_config
 *
 * @param ticketId - The ID of the ticket to check
 * @returns Object with paused status and reason
 */
export const shouldSlaBePaused = withAuth(async (
  _user,
  { tenant },
  ticketId: string
): Promise<{ paused: boolean; reason: SlaPauseReason | null }> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Get the ticket's current state
      const ticket = await trx('tickets')
        .where({ tenant, ticket_id: ticketId })
        .select('status_id', 'response_state')
        .first();

      if (!ticket) {
        throw new Error(`Ticket ${ticketId} not found`);
      }

      // Get SLA settings
      let slaSettings = await trx('sla_settings')
        .where({ tenant })
        .first();

      // Use default settings if none exist
      if (!slaSettings) {
        slaSettings = {
          pause_on_awaiting_client: true,
        };
      }

      // Check 1: Awaiting client response
      if (slaSettings.pause_on_awaiting_client && ticket.response_state === 'awaiting_client') {
        return {
          paused: true,
          reason: 'awaiting_client' as SlaPauseReason,
        };
      }

      // Check 2: Status-based pause
      const statusPauseConfig = await trx('status_sla_pause_config')
        .where({ tenant, status_id: ticket.status_id })
        .first();

      if (statusPauseConfig?.pauses_sla) {
        return {
          paused: true,
          reason: 'status_pause' as SlaPauseReason,
        };
      }

      // No pause conditions met
      return {
        paused: false,
        reason: null,
      };
    } catch (error) {
      console.error(`Error checking SLA pause status for ticket ${ticketId}:`, error);
      throw new Error(`Failed to check SLA pause status for ticket ${ticketId}`);
    }
  });
});

/**
 * Delete a status SLA pause configuration.
 * Useful when a status is deleted or when you want to remove the override.
 */
export const deleteStatusSlaPauseConfig = withAuth(async (_user, { tenant }, statusId: string): Promise<boolean> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const deleted = await trx('status_sla_pause_config')
        .where({ tenant, status_id: statusId })
        .delete();

      return deleted > 0;
    } catch (error) {
      console.error(`Error deleting SLA pause config for status ${statusId}:`, error);
      throw new Error(`Failed to delete SLA pause config for status ${statusId}`);
    }
  });
});

// ============================================================================
// Response State Tracking Setting (reads/writes tenant_settings JSONB)
// ============================================================================

/**
 * Get the response state tracking setting for the current tenant.
 * This reads from tenant_settings.ticket_display_settings JSONB to avoid
 * circular dependency with @alga-psa/tickets.
 */
export const getResponseStateTrackingSetting = withAuth(async (_user, { tenant }): Promise<boolean> => {
  const { knex: db } = await createTenantKnex();
  const row = await db('tenant_settings')
    .select('ticket_display_settings')
    .where({ tenant })
    .first();
  return (row?.ticket_display_settings as any)?.responseStateTrackingEnabled ?? true;
});

/**
 * Update the response state tracking setting for the current tenant.
 */
export const updateResponseStateTrackingSetting = withAuth(async (_user, { tenant }, enabled: boolean): Promise<boolean> => {
  const { knex: db } = await createTenantKnex();
  const now = new Date();

  const existingRow = await db('tenant_settings')
    .select('ticket_display_settings', 'settings')
    .where({ tenant })
    .first();

  const currentDisplay = (existingRow?.ticket_display_settings as any) || {};
  const mergedDisplay = { ...currentDisplay, responseStateTrackingEnabled: enabled };

  const rootSettings = (existingRow?.settings as any) || {};
  const ticketing = rootSettings.ticketing || {};
  const display = ticketing.display || {};
  const mergedSettings = {
    ...rootSettings,
    ticketing: { ...ticketing, display: { ...display, responseStateTrackingEnabled: enabled } },
  };

  await db('tenant_settings')
    .insert({
      tenant,
      ticket_display_settings: JSON.stringify(mergedDisplay),
      settings: JSON.stringify(mergedSettings),
      updated_at: now,
    })
    .onConflict('tenant')
    .merge({
      ticket_display_settings: JSON.stringify(mergedDisplay),
      settings: JSON.stringify(mergedSettings),
      updated_at: now,
    });

  return enabled;
});
