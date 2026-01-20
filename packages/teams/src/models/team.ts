import type { Knex } from 'knex';
import type { ITeam } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';

const TeamModel = {
  create: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    teamData: Omit<ITeam, 'team_id' | 'tenant' | 'members'>
  ): Promise<ITeam> => {
    if (!teamData.manager_id) {
      throw new Error('manager_id is required when creating a team');
    }

    const [createdTeam] = await knexOrTrx<ITeam>('teams')
      .insert({
        ...teamData,
        team_id: uuidv4(),
        tenant
      })
      .returning('*');

    if (!createdTeam) {
      throw new Error(`Failed to create team in tenant ${tenant}`);
    }

    return createdTeam;
  },

  getAll: async (knexOrTrx: Knex | Knex.Transaction, tenant: string): Promise<ITeam[]> => {
    return await knexOrTrx<ITeam>('teams')
      .whereNotNull('tenant')
      .andWhere('tenant', tenant)
      .select('*');
  },

  get: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, team_id: string): Promise<ITeam | undefined> => {
    return await knexOrTrx<ITeam>('teams')
      .select('*')
      .whereNotNull('tenant')
      .andWhere('tenant', tenant)
      .andWhere('team_id', team_id)
      .first();
  },

  update: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    team_id: string,
    team: Partial<ITeam>
  ): Promise<void> => {
    await knexOrTrx<ITeam>('teams')
      .whereNotNull('tenant')
      .andWhere('tenant', tenant)
      .andWhere('team_id', team_id)
      .update(team);
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, team_id: string): Promise<void> => {
    const maybeTrx = knexOrTrx as unknown as {
      commit?: unknown;
      rollback?: unknown;
    };

    const isTransaction = typeof maybeTrx.commit === 'function' && typeof maybeTrx.rollback === 'function';
    const trx = isTransaction ? (knexOrTrx as Knex.Transaction) : await (knexOrTrx as Knex).transaction();

    try {
      await trx('team_members')
        .whereNotNull('tenant')
        .andWhere('tenant', tenant)
        .andWhere('team_id', team_id)
        .del();

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
  },

  addMember: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, team_id: string, user_id: string): Promise<void> => {
    const user = await knexOrTrx('users')
      .select('is_inactive')
      .whereNotNull('tenant')
      .andWhere('tenant', tenant)
      .andWhere('user_id', user_id)
      .first();

    if (!user || user.is_inactive) {
      throw new Error(`Cannot add inactive user to team in tenant ${tenant}`);
    }

    await knexOrTrx('team_members').insert({ team_id, user_id, tenant });
  },

  removeMember: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, team_id: string, user_id: string): Promise<void> => {
    await knexOrTrx('team_members')
      .whereNotNull('tenant')
      .andWhere('tenant', tenant)
      .andWhere('team_id', team_id)
      .andWhere('user_id', user_id)
      .del();
  },

  getMembers: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, team_id: string): Promise<string[]> => {
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
  }
};

export default TeamModel;

