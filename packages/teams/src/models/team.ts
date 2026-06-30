import type { Knex } from 'knex';
import type { ITeam } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
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

    const [createdTeam] = await tenantDb(knexOrTrx, tenant).table<ITeam>('teams')
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
    return await tenantDb(knexOrTrx, tenant).table<ITeam>('teams')
      .select('*');
  },

  get: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, team_id: string): Promise<ITeam | undefined> => {
    return await tenantDb(knexOrTrx, tenant).table<ITeam>('teams')
      .select('*')
      .andWhere('team_id', team_id)
      .first();
  },

  update: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    team_id: string,
    team: Partial<ITeam>
  ): Promise<void> => {
    await tenantDb(knexOrTrx, tenant).table<ITeam>('teams')
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
      const db = tenantDb(trx, tenant);

      await db.table('team_members')
        .andWhere('team_id', team_id)
        .del();

      await db.table<ITeam>('teams')
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

  addMember: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    team_id: string,
    user_id: string,
    role: 'member' | 'lead' = 'member'
  ): Promise<void> => {
    const db = tenantDb(knexOrTrx, tenant);
    const user = await db.table('users')
      .select('is_inactive')
      .andWhere('user_id', user_id)
      .first();

    if (!user || user.is_inactive) {
      throw new Error(`Cannot add inactive user to team in tenant ${tenant}`);
    }

    await db.table('team_members').insert({ team_id, user_id, tenant, role });
  },

  removeMember: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, team_id: string, user_id: string): Promise<void> => {
    await tenantDb(knexOrTrx, tenant).table('team_members')
      .andWhere('team_id', team_id)
      .andWhere('user_id', user_id)
      .del();
  },

  getMembers: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    team_id: string
  ): Promise<Array<{ user_id: string; role: 'member' | 'lead' }>> => {
    const db = tenantDb(knexOrTrx, tenant);
    const query = db.table('team_members');
    db.tenantJoin(query, 'users', 'team_members.user_id', 'users.user_id');

    const members = (await query
      .select('team_members.user_id as user_id', 'team_members.role as role')
      .andWhere('team_members.team_id', team_id)
      .andWhere('users.is_inactive', false)) as unknown as Array<{ user_id: string; role: 'member' | 'lead' }>;
    return members.map((member): { user_id: string; role: 'member' | 'lead' } => ({
      user_id: member.user_id,
      role: member.role
    }));
  }
};

export default TeamModel;
