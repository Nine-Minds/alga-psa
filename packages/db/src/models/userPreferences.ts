import logger from '@alga-psa/core/logger';
import type { Knex } from 'knex';
import { requireTenantId } from '../lib/tenantId';

export interface IUserPreference {
  tenant: string;
  user_id: string;
  setting_name: string;
  setting_value: any;
  updated_at: Date;
}

const UserPreferences = {
  get: async (
    knexOrTrx: Knex | Knex.Transaction,
    user_id: string,
    setting_name: string
  ): Promise<IUserPreference | undefined> => {
    try {
      const tenant = await requireTenantId(knexOrTrx);

      const user = await knexOrTrx('users').where({ user_id, tenant }).first();
      if (!user) {
        throw new Error(`User with id ${user_id} not found in tenant ${tenant}`);
      }

      const preference = await knexOrTrx<IUserPreference>('user_preferences')
        .where({ tenant, user_id, setting_name })
        .first();

      return preference;
    } catch (error) {
      logger.error(`Error getting user preference for user ${user_id}, setting ${setting_name}:`, error);
      throw error;
    }
  },

  getAllForUser: async (knexOrTrx: Knex | Knex.Transaction, user_id: string): Promise<IUserPreference[]> => {
    try {
      const tenant = await requireTenantId(knexOrTrx);

      const user = await knexOrTrx('users').where({ user_id, tenant }).first();
      if (!user) {
        throw new Error(`User with id ${user_id} not found in tenant ${tenant}`);
      }

      const preferences = await knexOrTrx<IUserPreference>('user_preferences').where({ tenant, user_id });
      return preferences;
    } catch (error) {
      logger.error(`Error getting all preferences for user ${user_id}:`, error);
      throw error;
    }
  },

  upsert: async (knexOrTrx: Knex | Knex.Transaction, preference: Omit<IUserPreference, 'tenant'>): Promise<void> => {
    try {
      const tenant = await requireTenantId(knexOrTrx);

      const user = await knexOrTrx('users').where({ user_id: preference.user_id, tenant }).first();
      if (!user) {
        throw new Error(`User with id ${preference.user_id} not found in tenant ${tenant}`);
      }

      const preferenceData = {
        ...preference,
        tenant,
        updated_at: new Date(),
      };

      await knexOrTrx<IUserPreference>('user_preferences')
        .insert(preferenceData)
        .onConflict(['tenant', 'user_id', 'setting_name'])
        .merge({
          setting_value: preferenceData.setting_value,
          updated_at: preferenceData.updated_at,
        });
    } catch (error) {
      logger.error(
        `Error upserting user preference for user ${preference.user_id}, setting ${preference.setting_name}:`,
        error
      );
      throw error;
    }
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, user_id: string, setting_name: string): Promise<void> => {
    try {
      const tenant = await requireTenantId(knexOrTrx);

      const user = await knexOrTrx('users').where({ user_id, tenant }).first();
      if (!user) {
        throw new Error(`User with id ${user_id} not found in tenant ${tenant}`);
      }

      const preference = await knexOrTrx<IUserPreference>('user_preferences')
        .where({ tenant, user_id, setting_name })
        .first();
      if (!preference) {
        throw new Error(`Preference '${setting_name}' not found for user ${user_id} in tenant ${tenant}`);
      }

      const deletedCount = await knexOrTrx<IUserPreference>('user_preferences')
        .where({ tenant, user_id, setting_name })
        .delete();

      if (deletedCount === 0) {
        throw new Error(`Failed to delete preference '${setting_name}' for user ${user_id} in tenant ${tenant}`);
      }
    } catch (error) {
      logger.error(`Error deleting user preference for user ${user_id}, setting ${setting_name}:`, error);
      throw error;
    }
  },

  deleteAllForUser: async (knexOrTrx: Knex | Knex.Transaction, user_id: string): Promise<void> => {
    try {
      const tenant = await requireTenantId(knexOrTrx);

      const user = await knexOrTrx('users').where({ user_id, tenant }).first();
      if (!user) {
        throw new Error(`User with id ${user_id} not found in tenant ${tenant}`);
      }

      const deletedCount = await knexOrTrx<IUserPreference>('user_preferences').where({ tenant, user_id }).delete();

      logger.info(`Deleted ${deletedCount} preferences for user ${user_id} in tenant ${tenant}`);
    } catch (error) {
      logger.error(`Error deleting all preferences for user ${user_id}:`, error);
      throw error;
    }
  },

  bulkUpsert: async (knexOrTrx: Knex | Knex.Transaction, preferences: Omit<IUserPreference, 'tenant'>[]): Promise<void> => {
    const tenant = await requireTenantId(knexOrTrx);

    const userIds = [...new Set(preferences.map((p) => p.user_id))];

    const users = await knexOrTrx('users').where('tenant', tenant).whereIn('user_id', userIds).select('user_id');
    const foundUserIds = new Set(users.map((u: any) => u.user_id));
    const missingUserIds = userIds.filter((id) => !foundUserIds.has(id));
    if (missingUserIds.length > 0) {
      throw new Error(`Users with ids [${missingUserIds.join(', ')}] not found in tenant ${tenant}`);
    }

    const isTransaction = (knexOrTrx as any).isTransaction || false;
    const trx = isTransaction ? (knexOrTrx as Knex.Transaction) : await (knexOrTrx as Knex).transaction();

    try {
      const now = new Date();

      for (const preference of preferences) {
        const preferenceData = {
          ...preference,
          tenant,
          updated_at: now,
        };

        await trx<IUserPreference>('user_preferences')
          .insert(preferenceData)
          .onConflict(['tenant', 'user_id', 'setting_name'])
          .merge({
            setting_value: preferenceData.setting_value,
            updated_at: now,
          });
      }

      if (!isTransaction) {
        await trx.commit();
      }
    } catch (error) {
      if (!isTransaction) {
        await trx.rollback();
      }
      logger.error(`Error bulk upserting preferences in tenant ${tenant}:`, error);
      throw error;
    }
  },
};

export default UserPreferences;

