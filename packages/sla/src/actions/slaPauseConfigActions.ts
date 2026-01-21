'use server';

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import {
  ISlaSettings,
  IStatusSlaPauseConfig,
  SlaPauseReason
} from '../types';

// ============================================================================
// SLA Settings (global per tenant)
// ============================================================================

/**
 * Get SLA settings for the current tenant.
 * Creates default settings if none exist.
 */
export async function getSlaSettings(): Promise<ISlaSettings> {
  const { knex: db, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('No tenant found');
  }

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
}

/**
 * Update SLA settings for the current tenant.
 * Creates settings if they don't exist (upsert pattern).
 */
export async function updateSlaSettings(settings: Partial<ISlaSettings>): Promise<ISlaSettings> {
  const { knex: db, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('No tenant found');
  }

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
}

// ============================================================================
// Status SLA Pause Configuration
// ============================================================================

/**
 * Get all status SLA pause configurations for the current tenant.
 */
export async function getStatusSlaPauseConfigs(): Promise<IStatusSlaPauseConfig[]> {
  const { knex: db, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('No tenant found');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const configs = await trx('status_sla_pause_config')
        .where({ tenant })
        .select('*');

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
}

/**
 * Get the SLA pause configuration for a specific status.
 */
export async function getSlaPauseConfigForStatus(statusId: string): Promise<IStatusSlaPauseConfig | null> {
  const { knex: db, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('No tenant found');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const config = await trx('status_sla_pause_config')
        .where({ tenant, status_id: statusId })
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
}

/**
 * Set the SLA pause configuration for a specific status.
 * Uses upsert pattern - inserts if not exists, updates if exists.
 */
export async function setStatusSlaPauseConfig(
  statusId: string,
  pausesSla: boolean
): Promise<IStatusSlaPauseConfig> {
  const { knex: db, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('No tenant found');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
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
}

/**
 * Bulk update status SLA pause configurations.
 * Efficiently updates multiple status configurations in a single transaction.
 */
export async function bulkUpdateStatusSlaPauseConfigs(
  configs: Array<{ statusId: string; pausesSla: boolean }>
): Promise<IStatusSlaPauseConfig[]> {
  const { knex: db, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('No tenant found');
  }

  if (configs.length === 0) {
    return [];
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
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
}

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
export async function shouldSlaBePaused(
  ticketId: string
): Promise<{ paused: boolean; reason: SlaPauseReason | null }> {
  const { knex: db, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('No tenant found');
  }

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
}

/**
 * Delete a status SLA pause configuration.
 * Useful when a status is deleted or when you want to remove the override.
 */
export async function deleteStatusSlaPauseConfig(statusId: string): Promise<boolean> {
  const { knex: db, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('No tenant found');
  }

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
}
