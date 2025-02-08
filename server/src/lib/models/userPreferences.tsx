import logger from '../../utils/logger';
import { getConnection } from '../db/db';
import { createTenantKnex } from '../db';

interface IUserPreference {
    tenant: string;
    user_id: string;
    setting_name: string;
    setting_value: any;
    updated_at: Date;
}

const UserPreferences = {
    get: async (tenant: string, user_id: string, setting_name: string): Promise<IUserPreference | undefined> => {
        const { knex: db } = await createTenantKnex();
        try {
            const preference = await db<IUserPreference>('user_preferences')
                .where({ tenant, user_id, setting_name })
                .first();
            return preference;
        } catch (error) {
            logger.error(`Error getting user preference for user ${user_id}, setting ${setting_name}:`, error);
            throw error;
        }
    },

    getAllForUser: async (tenant: string, user_id: string): Promise<IUserPreference[]> => {
        const { knex: db } = await createTenantKnex();
        try {
            const preferences = await db<IUserPreference>('user_preferences')
                .where({ tenant, user_id });
            return preferences;
        } catch (error) {
            logger.error(`Error getting all preferences for user ${user_id}:`, error);
            throw error;
        }
    },

    upsert: async (preference: IUserPreference): Promise<void> => {
        const { knex: db } = await createTenantKnex();
        try {
            await db<IUserPreference>('user_preferences')
                .insert(preference)
                .onConflict(['tenant', 'user_id', 'setting_name'])
                .merge({
                    setting_value: preference.setting_value,
                    updated_at: new Date(),
                });
        } catch (error) {
            logger.error(`Error upserting user preference for user ${preference.user_id}, setting ${preference.setting_name}:`, error);
            throw error;
        }
    },

    delete: async (tenant: string, user_id: string, setting_name: string): Promise<void> => {
        const { knex: db } = await createTenantKnex();
        try {
            await db<IUserPreference>('user_preferences')
                .where({ tenant, user_id, setting_name })
                .delete();
        } catch (error) {
            logger.error(`Error deleting user preference for user ${user_id}, setting ${setting_name}:`, error);
            throw error;
        }
    },

    deleteAllForUser: async (tenant: string, user_id: string): Promise<void> => {
        const { knex: db } = await createTenantKnex();
        try {
            await db<IUserPreference>('user_preferences')
                .where({ tenant, user_id })
                .delete();
        } catch (error) {
            logger.error(`Error deleting all preferences for user ${user_id}:`, error);
            throw error;
        }
    },

    bulkUpsert: async (preferences: IUserPreference[]): Promise<void> => {
        const { knex: db } = await createTenantKnex();
        try {
            await db.transaction(async (trx) => {
                for (const preference of preferences) {
                    await trx<IUserPreference>('user_preferences')
                        .insert(preference)
                        .onConflict(['tenant', 'user_id', 'setting_name'])
                        .merge({
                            setting_value: preference.setting_value,
                            updated_at: db.fn.now()
                        });
                }
            });
        } catch (error) {
            logger.error('Error bulk upserting user preferences:', error);
            throw error;
        }
    }
};

export default UserPreferences;
