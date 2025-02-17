import logger from '../../utils/logger';
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
        try {
            const { knex: db, tenant: contextTenant } = await createTenantKnex();
            if (!contextTenant) {
                throw new Error('Tenant context is required for getting user preferences');
            }

            // Verify tenant matches context
            if (tenant !== contextTenant) {
                throw new Error(`Tenant mismatch: expected ${contextTenant}, got ${tenant}`);
            }

            // Verify user exists in the tenant
            const user = await db('users')
                .where({
                    user_id,
                    tenant
                })
                .first();

            if (!user) {
                throw new Error(`User with id ${user_id} not found in tenant ${tenant}`);
            }

            const preference = await db<IUserPreference>('user_preferences')
                .where({
                    tenant,
                    user_id,
                    setting_name
                })
                .first();

            return preference;
        } catch (error) {
            logger.error(`Error getting user preference for user ${user_id}, setting ${setting_name}:`, error);
            throw error;
        }
    },

    getAllForUser: async (tenant: string, user_id: string): Promise<IUserPreference[]> => {
        try {
            const { knex: db, tenant: contextTenant } = await createTenantKnex();
            if (!contextTenant) {
                throw new Error('Tenant context is required for getting user preferences');
            }

            // Verify tenant matches context
            if (tenant !== contextTenant) {
                throw new Error(`Tenant mismatch: expected ${contextTenant}, got ${tenant}`);
            }

            // Verify user exists in the tenant
            const user = await db('users')
                .where({
                    user_id,
                    tenant
                })
                .first();

            if (!user) {
                throw new Error(`User with id ${user_id} not found in tenant ${tenant}`);
            }

            const preferences = await db<IUserPreference>('user_preferences')
                .where({
                    tenant,
                    user_id
                });

            return preferences;
        } catch (error) {
            logger.error(`Error getting all preferences for user ${user_id} in tenant ${tenant}:`, error);
            throw error;
        }
    },

    upsert: async (preference: IUserPreference): Promise<void> => {
        try {
            const { knex: db, tenant: contextTenant } = await createTenantKnex();
            if (!contextTenant) {
                throw new Error('Tenant context is required for upserting user preferences');
            }

            // Verify tenant matches context
            if (preference.tenant !== contextTenant) {
                throw new Error(`Tenant mismatch: expected ${contextTenant}, got ${preference.tenant}`);
            }

            // Verify user exists in the tenant
            const user = await db('users')
                .where({
                    user_id: preference.user_id,
                    tenant: contextTenant
                })
                .first();

            if (!user) {
                throw new Error(`User with id ${preference.user_id} not found in tenant ${contextTenant}`);
            }

            // Ensure tenant cannot be modified and is set to context tenant
            const preferenceData = {
                ...preference,
                tenant: contextTenant,
                updated_at: new Date()
            };

            await db<IUserPreference>('user_preferences')
                .insert(preferenceData)
                .onConflict(['tenant', 'user_id', 'setting_name'])
                .merge({
                    setting_value: preferenceData.setting_value,
                    updated_at: preferenceData.updated_at
                });
        } catch (error) {
            logger.error(`Error upserting user preference for user ${preference.user_id}, setting ${preference.setting_name} in tenant ${preference.tenant}:`, error);
            throw error;
        }
    },

    delete: async (tenant: string, user_id: string, setting_name: string): Promise<void> => {
        try {
            const { knex: db, tenant: contextTenant } = await createTenantKnex();
            if (!contextTenant) {
                throw new Error('Tenant context is required for deleting user preferences');
            }

            // Verify tenant matches context
            if (tenant !== contextTenant) {
                throw new Error(`Tenant mismatch: expected ${contextTenant}, got ${tenant}`);
            }

            // Verify user exists in the tenant
            const user = await db('users')
                .where({
                    user_id,
                    tenant
                })
                .first();

            if (!user) {
                throw new Error(`User with id ${user_id} not found in tenant ${tenant}`);
            }

            // Verify preference exists before deletion
            const preference = await db<IUserPreference>('user_preferences')
                .where({
                    tenant,
                    user_id,
                    setting_name
                })
                .first();

            if (!preference) {
                throw new Error(`Preference '${setting_name}' not found for user ${user_id} in tenant ${tenant}`);
            }

            const deletedCount = await db<IUserPreference>('user_preferences')
                .where({
                    tenant,
                    user_id,
                    setting_name
                })
                .delete();

            if (deletedCount === 0) {
                throw new Error(`Failed to delete preference '${setting_name}' for user ${user_id} in tenant ${tenant}`);
            }
        } catch (error) {
            logger.error(`Error deleting user preference for user ${user_id}, setting ${setting_name} in tenant ${tenant}:`, error);
            throw error;
        }
    },

    deleteAllForUser: async (tenant: string, user_id: string): Promise<void> => {
        try {
            const { knex: db, tenant: contextTenant } = await createTenantKnex();
            if (!contextTenant) {
                throw new Error('Tenant context is required for deleting user preferences');
            }

            // Verify tenant matches context
            if (tenant !== contextTenant) {
                throw new Error(`Tenant mismatch: expected ${contextTenant}, got ${tenant}`);
            }

            // Verify user exists in the tenant
            const user = await db('users')
                .where({
                    user_id,
                    tenant
                })
                .first();

            if (!user) {
                throw new Error(`User with id ${user_id} not found in tenant ${tenant}`);
            }

            const deletedCount = await db<IUserPreference>('user_preferences')
                .where({
                    tenant,
                    user_id
                })
                .delete();

            // Note: It's okay if no preferences were found to delete
            logger.info(`Deleted ${deletedCount} preferences for user ${user_id} in tenant ${tenant}`);
        } catch (error) {
            logger.error(`Error deleting all preferences for user ${user_id} in tenant ${tenant}:`, error);
            throw error;
        }
    },

    bulkUpsert: async (preferences: IUserPreference[]): Promise<void> => {
        try {
            const { knex: db, tenant: contextTenant } = await createTenantKnex();
            if (!contextTenant) {
                throw new Error('Tenant context is required for bulk upserting user preferences');
            }

            // Verify all preferences have matching tenant
            for (const preference of preferences) {
                if (preference.tenant !== contextTenant) {
                    throw new Error(`Tenant mismatch: expected ${contextTenant}, got ${preference.tenant}`);
                }
            }

            // Get unique user IDs from preferences
            const userIds = [...new Set(preferences.map(p => p.user_id))];

            // Verify all users exist in the tenant
            const users = await db('users')
                .where('tenant', contextTenant)
                .whereIn('user_id', userIds)
                .select('user_id');

            const foundUserIds = new Set(users.map(u => u.user_id));
            const missingUserIds = userIds.filter(id => !foundUserIds.has(id));

            if (missingUserIds.length > 0) {
                throw new Error(`Users with ids [${missingUserIds.join(', ')}] not found in tenant ${contextTenant}`);
            }

            await db.transaction(async (trx) => {
                for (const preference of preferences) {
                    // Ensure tenant cannot be modified and is set to context tenant
                    const preferenceData = {
                        ...preference,
                        tenant: contextTenant,
                        updated_at: db.fn.now()
                    };

                    await trx<IUserPreference>('user_preferences')
                        .insert(preferenceData)
                        .onConflict(['tenant', 'user_id', 'setting_name'])
                        .merge({
                            setting_value: preferenceData.setting_value,
                            updated_at: preferenceData.updated_at
                        });
                }
            });

            logger.info(`Successfully bulk upserted ${preferences.length} preferences in tenant ${contextTenant}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Error bulk upserting user preferences: ${errorMessage}`);
            throw error;
        }
    }
};

export default UserPreferences;
