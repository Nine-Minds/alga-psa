'use server';

/**
 * Escalation Manager Actions
 *
 * Server actions for managing escalation manager configurations.
 * Escalation managers are assigned per board and escalation level (1, 2, or 3).
 * When a ticket reaches an escalation level, the configured manager is:
 * 1. Added as an additional resource on the ticket
 * 2. Notified via in-app and/or email
 */

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { Knex } from 'knex';
import {
  IEscalationManager,
  IEscalationManagerInput,
  IEscalationManagerWithUser,
  IBoardEscalationConfig,
  SlaNotificationChannel
} from '../types';

// ============================================================================
// Escalation Manager CRUD Operations
// ============================================================================

/**
 * Get all escalation manager configurations for the current tenant.
 */
export const getEscalationManagers = withAuth(async (_user, { tenant }): Promise<IEscalationManagerWithUser[]> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const configs = await trx('escalation_managers as em')
        .leftJoin('users as u', function() {
          this.on('em.manager_user_id', 'u.user_id')
              .andOn('em.tenant', 'u.tenant');
        })
        .where('em.tenant', tenant)
        .select(
          'em.*',
          'u.first_name as manager_first_name',
          'u.last_name as manager_last_name',
          'u.email as manager_email'
        )
        .orderBy(['em.board_id', 'em.escalation_level']);

      return configs as IEscalationManagerWithUser[];
    } catch (error) {
      console.error(`Error fetching escalation managers for tenant ${tenant}:`, error);
      throw new Error(`Failed to fetch escalation managers for tenant ${tenant}`);
    }
  });
});

/**
 * Get escalation manager configurations for a specific board.
 */
export const getEscalationManagersForBoard = withAuth(async (
  _user,
  { tenant },
  boardId: string
): Promise<IEscalationManagerWithUser[]> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const configs = await trx('escalation_managers as em')
        .leftJoin('users as u', function() {
          this.on('em.manager_user_id', 'u.user_id')
              .andOn('em.tenant', 'u.tenant');
        })
        .where('em.tenant', tenant)
        .where('em.board_id', boardId)
        .select(
          'em.*',
          'u.first_name as manager_first_name',
          'u.last_name as manager_last_name',
          'u.email as manager_email'
        )
        .orderBy('em.escalation_level');

      return configs as IEscalationManagerWithUser[];
    } catch (error) {
      console.error(`Error fetching escalation managers for board ${boardId}, tenant ${tenant}:`, error);
      throw new Error(`Failed to fetch escalation managers for board ${boardId}`);
    }
  });
});

/**
 * Get the escalation manager for a specific board and level.
 */
export const getEscalationManagerForLevel = withAuth(async (
  _user,
  { tenant },
  boardId: string,
  level: 1 | 2 | 3
): Promise<IEscalationManagerWithUser | null> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const config = await trx('escalation_managers as em')
        .leftJoin('users as u', function() {
          this.on('em.manager_user_id', 'u.user_id')
              .andOn('em.tenant', 'u.tenant');
        })
        .where('em.tenant', tenant)
        .where('em.board_id', boardId)
        .where('em.escalation_level', level)
        .select(
          'em.*',
          'u.first_name as manager_first_name',
          'u.last_name as manager_last_name',
          'u.email as manager_email'
        )
        .first();

      return config || null;
    } catch (error) {
      console.error(`Error fetching escalation manager for board ${boardId}, level ${level}, tenant ${tenant}:`, error);
      throw new Error(`Failed to fetch escalation manager for board ${boardId}, level ${level}`);
    }
  });
});

/**
 * Set or update an escalation manager for a board and level.
 * If manager_user_id is null, removes the configuration.
 */
export const setEscalationManager = withAuth(async (
  _user,
  { tenant },
  input: IEscalationManagerInput
): Promise<IEscalationManager | null> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Verify board exists
      const board = await trx('boards')
        .where({ tenant, board_id: input.board_id })
        .first();

      if (!board) {
        throw new Error(`Board ${input.board_id} not found`);
      }

      // Verify user exists if provided
      if (input.manager_user_id) {
        const user = await trx('users')
          .where({ tenant, user_id: input.manager_user_id })
          .first();

        if (!user) {
          throw new Error(`User ${input.manager_user_id} not found`);
        }
      }

      // Check if config exists
      const existing = await trx('escalation_managers')
        .where({
          tenant,
          board_id: input.board_id,
          escalation_level: input.escalation_level
        })
        .first();

      // If removing manager (null user_id), delete the config
      if (!input.manager_user_id) {
        if (existing) {
          await trx('escalation_managers')
            .where({
              tenant,
              config_id: existing.config_id
            })
            .delete();
        }
        return null;
      }

      const notifyVia = input.notify_via || ['in_app', 'email'];

      if (existing) {
        // Update existing config
        const [updated] = await trx('escalation_managers')
          .where({
            tenant,
            config_id: existing.config_id
          })
          .update({
            manager_user_id: input.manager_user_id,
            notify_via: notifyVia,
            updated_at: trx.fn.now()
          })
          .returning('*');

        return updated as IEscalationManager;
      } else {
        // Insert new config
        const [inserted] = await trx('escalation_managers')
          .insert({
            config_id: crypto.randomUUID(),
            tenant,
            board_id: input.board_id,
            escalation_level: input.escalation_level,
            manager_user_id: input.manager_user_id,
            notify_via: notifyVia,
            created_at: trx.fn.now(),
            updated_at: trx.fn.now()
          })
          .returning('*');

        return inserted as IEscalationManager;
      }
    } catch (error) {
      console.error(`Error setting escalation manager for board ${input.board_id}, level ${input.escalation_level}:`, error);
      throw new Error(error instanceof Error ? error.message : 'Failed to set escalation manager');
    }
  });
});

/**
 * Delete an escalation manager configuration by ID.
 */
export const deleteEscalationManager = withAuth(async (
  _user,
  { tenant },
  configId: string
): Promise<void> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const deleted = await trx('escalation_managers')
        .where({ tenant, config_id: configId })
        .delete();

      if (!deleted) {
        throw new Error(`Escalation manager configuration ${configId} not found`);
      }
    } catch (error) {
      console.error(`Error deleting escalation manager ${configId}, tenant ${tenant}:`, error);
      throw new Error(error instanceof Error ? error.message : 'Failed to delete escalation manager');
    }
  });
});

/**
 * Get escalation configurations for all boards (for admin UI).
 * Returns a list of boards with their escalation manager configurations.
 */
export const getBoardEscalationConfigs = withAuth(async (_user, { tenant }): Promise<IBoardEscalationConfig[]> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Get all active boards
      const boards = await trx('boards')
        .where({ tenant, is_inactive: false })
        .select('board_id', 'board_name')
        .orderBy('display_order');

      // Get all escalation configs
      const configs = await trx('escalation_managers as em')
        .leftJoin('users as u', function() {
          this.on('em.manager_user_id', 'u.user_id')
              .andOn('em.tenant', 'u.tenant');
        })
        .where('em.tenant', tenant)
        .select(
          'em.*',
          'u.first_name as manager_first_name',
          'u.last_name as manager_last_name',
          'u.email as manager_email'
        );

      // Map configs to boards
      const configsByBoard = new Map<string, Map<number, IEscalationManagerWithUser>>();
      for (const config of configs) {
        if (!configsByBoard.has(config.board_id)) {
          configsByBoard.set(config.board_id, new Map());
        }
        configsByBoard.get(config.board_id)!.set(config.escalation_level, config);
      }

      // Build result
      const result: IBoardEscalationConfig[] = boards.map(board => ({
        board_id: board.board_id,
        board_name: board.board_name,
        level_1: configsByBoard.get(board.board_id)?.get(1) || null,
        level_2: configsByBoard.get(board.board_id)?.get(2) || null,
        level_3: configsByBoard.get(board.board_id)?.get(3) || null
      }));

      return result;
    } catch (error) {
      console.error(`Error fetching board escalation configs for tenant ${tenant}:`, error);
      throw new Error(`Failed to fetch board escalation configs`);
    }
  });
});

/**
 * Bulk update escalation managers for a board.
 * Sets all three levels at once.
 */
export const setBoardEscalationManagers = withAuth(async (
  _user,
  { tenant },
  boardId: string,
  managers: {
    level_1?: { user_id: string | null; notify_via?: SlaNotificationChannel[] };
    level_2?: { user_id: string | null; notify_via?: SlaNotificationChannel[] };
    level_3?: { user_id: string | null; notify_via?: SlaNotificationChannel[] };
  }
): Promise<void> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Verify board exists
      const board = await trx('boards')
        .where({ tenant, board_id: boardId })
        .first();

      if (!board) {
        throw new Error(`Board ${boardId} not found`);
      }

      // Process each level
      for (const [levelKey, config] of Object.entries(managers)) {
        if (!config) continue;

        const level = parseInt(levelKey.replace('level_', '')) as 1 | 2 | 3;

        // Verify user exists if provided
        if (config.user_id) {
          const user = await trx('users')
            .where({ tenant, user_id: config.user_id })
            .first();

          if (!user) {
            throw new Error(`User ${config.user_id} not found`);
          }
        }

        // Check if config exists
        const existing = await trx('escalation_managers')
          .where({ tenant, board_id: boardId, escalation_level: level })
          .first();

        if (!config.user_id) {
          // Remove config if user_id is null
          if (existing) {
            await trx('escalation_managers')
              .where({ tenant, config_id: existing.config_id })
              .delete();
          }
        } else if (existing) {
          // Update existing
          await trx('escalation_managers')
            .where({ tenant, config_id: existing.config_id })
            .update({
              manager_user_id: config.user_id,
              notify_via: config.notify_via || ['in_app', 'email'],
              updated_at: trx.fn.now()
            });
        } else {
          // Insert new
          await trx('escalation_managers')
            .insert({
              config_id: crypto.randomUUID(),
              tenant,
              board_id: boardId,
              escalation_level: level,
              manager_user_id: config.user_id,
              notify_via: config.notify_via || ['in_app', 'email'],
              created_at: trx.fn.now(),
              updated_at: trx.fn.now()
            });
        }
      }
    } catch (error) {
      console.error(`Error setting escalation managers for board ${boardId}:`, error);
      throw new Error(error instanceof Error ? error.message : 'Failed to set escalation managers');
    }
  });
});
