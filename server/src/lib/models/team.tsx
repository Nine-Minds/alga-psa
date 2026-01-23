import logger from '../../utils/logger';
import { ITeam } from '../../interfaces';
import { getCurrentTenantId } from '../db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { v4 as uuid4 } from 'uuid';

const Team = {
    create: async (knexOrTrx: Knex | Knex.Transaction, teamData: Omit<ITeam, 'team_id' | 'tenant' | 'members'>): Promise<ITeam> => {
        try {
            if (!teamData.manager_id) {
                throw new Error('manager_id is required when creating a team');
            }
            const tenant = await getCurrentTenantId();
            
            if (!tenant) {
                throw new Error('Tenant context is required for team creation');
            }
            
            logger.info(`Creating new team in tenant ${tenant}:`, teamData);
            
            const [createdTeam] = await knexOrTrx<ITeam>('teams')
                .insert({
                    ...teamData,
                    team_id: uuid4(),
                    tenant: tenant
                })
                .returning('*');
            
            if (!createdTeam) {
                throw new Error(`Failed to create team in tenant ${tenant}`);
            }

            logger.info('Team created successfully:', createdTeam);
            return createdTeam;
        } catch (error) {
            logger.error('Error creating team:', error);
            throw error;
        }
    },

    getAll: async (knexOrTrx: Knex | Knex.Transaction): Promise<ITeam[]> => {
        try {
            const tenant = await getCurrentTenantId();
            
            const teams = await knexOrTrx<ITeam>('teams')
                .whereNotNull('tenant')
                .andWhere('tenant', tenant)
                .select('*');
            return teams;
        } catch (error) {
            logger.error('Error getting all teams:', error);
            throw error;
        }
    },

    get: async (knexOrTrx: Knex | Knex.Transaction, team_id: string): Promise<ITeam | undefined> => {
        try {
            const tenant = await getCurrentTenantId();
            
            const team = await knexOrTrx<ITeam>('teams')
                .select('*')
                .whereNotNull('tenant')
                .andWhere('tenant', tenant)
                .andWhere('team_id', team_id)
                .first();
            return team;
        } catch (error) {
            logger.error(`Error getting team with id ${team_id}:`, error);
            throw error;
        }
    },

    insert: async (knexOrTrx: Knex | Knex.Transaction, team: Omit<ITeam, 'team_id'>): Promise<Pick<ITeam, "team_id">> => {
        try {
            const tenant = await getCurrentTenantId();
            
            if (!tenant) {
                throw new Error('Tenant context is required for team insertion');
            }
            
            logger.info(`Inserting team in tenant ${tenant}:`, team);
            
            const [team_id] = await knexOrTrx<ITeam>('teams')
                .insert({...team, tenant: tenant})
                .returning('team_id');
            return team_id;
        } catch (error) {
            logger.error('Error inserting team:', error);
            throw error;
        }
    },

    update: async (knexOrTrx: Knex | Knex.Transaction, team_id: string, team: Partial<ITeam>): Promise<void> => {
        try {
            const tenant = await getCurrentTenantId();
            
            if (!tenant) {
                throw new Error('Tenant context is required for team updates');
            }
            
            logger.info(`Updating team ${team_id} in tenant ${tenant}`);
            
            await knexOrTrx<ITeam>('teams')
                .whereNotNull('tenant')
                .andWhere('tenant', tenant)
                .andWhere('team_id', team_id)
                .update(team);
        } catch (error) {
            logger.error(`Error updating team with id ${team_id}:`, error);
            throw error;
        }
    },

    delete: async (knexOrTrx: Knex | Knex.Transaction, team_id: string): Promise<void> => {
        try {
            const tenant = await getCurrentTenantId();
            
            if (!tenant) {
                throw new Error('Tenant context is required for team deletion');
            }
            
            logger.info(`Deleting team ${team_id} and its members in tenant ${tenant}`);
            
            const isTransaction = (knexOrTrx as any).isTransaction || false;
            const trx = isTransaction ? knexOrTrx as Knex.Transaction : await knexOrTrx.transaction();
            
            try {
                // Delete team members first
                await trx('team_members')
                    .whereNotNull('tenant')
                    .andWhere('tenant', tenant)
                    .andWhere('team_id', team_id)
                    .del();
                // Then delete the team
                await trx<ITeam>('teams')
                    .whereNotNull('tenant')
                    .andWhere('tenant', tenant)
                    .andWhere('team_id', team_id)
                    .del();
                
                if (!isTransaction) {
                    await trx.commit();
                }
            } catch (error) {
                if (!isTransaction) {
                    await trx.rollback();
                }
                throw error;
            }
        } catch (error) {
            logger.error(`Error deleting team with id ${team_id}:`, error);
            throw error;
        }
    },

    addMember: async (knexOrTrx: Knex | Knex.Transaction, team_id: string, user_id: string): Promise<void> => {
        try {
            const tenant = await getCurrentTenantId();
            
            if (!tenant) {
                throw new Error('Tenant context is required for team member operations');
            }
            
            // Check if the user is active
            const user = await knexOrTrx('users')
                .select('is_inactive')
                .whereNotNull('tenant')
                .andWhere('tenant', tenant)
                .andWhere('user_id', user_id)
                .first();
            if (!user || user.is_inactive) {
                throw new Error(`Cannot add inactive user to team in tenant ${tenant}`);
            }

            await knexOrTrx('team_members').insert({ team_id, user_id, tenant: tenant });
        } catch (error) {
            logger.error(`Error adding user ${user_id} to team ${team_id}:`, error);
            throw error;
        }
    },

    removeMember: async (knexOrTrx: Knex | Knex.Transaction, team_id: string, user_id: string): Promise<void> => {
        try {
            const tenant = await getCurrentTenantId();
            
            await knexOrTrx('team_members')
                .whereNotNull('tenant')
                .andWhere('tenant', tenant)
                .andWhere('team_id', team_id)
                .andWhere('user_id', user_id)
                .del();
        } catch (error) {
            logger.error(`Error removing user ${user_id} from team ${team_id}:`, error);
            throw error;
        }
    },

    getMembers: async (knexOrTrx: Knex | Knex.Transaction, team_id: string): Promise<string[]> => {
        try {
            const tenant = await getCurrentTenantId();
            
            if (!tenant) {
                throw new Error('Tenant context is required for getting team members');
            }
            
            logger.info(`Getting members for team ${team_id} in tenant ${tenant}`);
            
            const members = await knexOrTrx('team_members')
                .select('team_members.user_id')
                .join('users', function() {
                    this.on('team_members.user_id', '=', 'users.user_id')
                        .andOn('team_members.tenant', '=', 'users.tenant');
                })
                .whereNotNull('team_members.tenant')
                .andWhere('team_members.tenant', tenant)
                .andWhere('team_members.team_id', team_id)
                .andWhere('users.is_inactive', false);
            return members.map((member): string => member.user_id);
        } catch (error) {
            logger.error(`Error getting members for team ${team_id}:`, error);
            throw error;
        }
    },
};

export default Team;
