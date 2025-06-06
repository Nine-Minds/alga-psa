import { getCurrentTenantId } from '../db';
import { ISession } from '../../interfaces/session.interfaces';
import logger from '../../utils/logger';
import { Knex } from 'knex';

const Session = {
  get: async (knexOrTrx: Knex | Knex.Transaction, session_id: string): Promise<ISession | undefined> => {
    try {
      const tenant = await getCurrentTenantId();
      
      if (!tenant) {
        throw new Error('Tenant context is required for session operations');
      }

      const user = await knexOrTrx<ISession>('session')
        .select('*')
        .where('session_id', session_id)
        .andWhere('tenant', tenant)
        .first();
      return user;
    } catch (error) {
      logger.error(`Error getting user with session_id ${session_id}:`, error);
      throw error;
    }
  },

  getByToken: async (knexOrTrx: Knex | Knex.Transaction, token: string): Promise<ISession | undefined> => {
    try {
      const tenant = await getCurrentTenantId();
      
      if (!tenant) {
        throw new Error('Tenant context is required for session operations');
      }

      const user = await knexOrTrx<ISession>('session')
        .select('*')
        .where('token', token)
        .andWhere('tenant', tenant)
        .first();
      return user;
    } catch (error) {
      logger.error(`Error getting user with token ${token.substring(0, 10)}... :`, error);
      throw error;
    }
  },

  insert: async (knexOrTrx: Knex | Knex.Transaction, user: Omit<ISession, 'tenant'>): Promise<Pick<ISession, "session_id">> => {
    try {
      const tenant = await getCurrentTenantId();
      
      if (!tenant) {
        throw new Error('Tenant context is required for session operations');
      }

      logger.info(`Inserting user in tenant ${tenant}:`, user);
      const [session_id] = await knexOrTrx<ISession>('session')
        .insert({
          ...user,
          tenant
        })
        .returning('session_id');
      return session_id;
    } catch (error) {
      logger.error('Error inserting user:', error);
      throw error;
    }
  },

  update: async (knexOrTrx: Knex | Knex.Transaction, session_id: string, user: Partial<ISession>): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();
      
      if (!tenant) {
        throw new Error('Tenant context is required for session operations');
      }

      logger.info(`Updating session ${session_id} in tenant ${tenant}`);
      await knexOrTrx<ISession>('session')
        .where('session_id', session_id)
        .andWhere('tenant', tenant)
        .update(user);
    } catch (error) {
      logger.error(`Error updating user with session_id ${session_id}:`, error);
      throw error;
    }
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, session_id: string): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();
      
      if (!tenant) {
        throw new Error('Tenant context is required for session operations');
      }

      logger.info(`Deleting session ${session_id} in tenant ${tenant}`);
      await knexOrTrx<ISession>('session')
        .where('session_id', session_id)
        .andWhere('tenant', tenant)
        .del();
    } catch (error) {
      logger.error(`Error deleting user with session_id ${session_id}:`, error);
      throw error;
    }
  },

  deleteByToken: async (knexOrTrx: Knex | Knex.Transaction, token: string): Promise<number | null> => {
    try {
      const tenant = await getCurrentTenantId();
      
      if (!tenant) {
        throw new Error('Tenant context is required for session operations');
      }

      logger.info(`Attempting to delete session with token in tenant ${tenant}`);
      const session = await knexOrTrx<ISession>('session')
        .where('token', token)
        .andWhere('tenant', tenant)
        .first('usersession_id');

      if (!session) {
        logger.warn(`No session found with token ${token} in tenant ${tenant}`);
        return null;
      }
      
      await knexOrTrx<ISession>('session')
        .where('token', token)
        .andWhere('tenant', tenant)
        .del();
      logger.debug(`Deleted session with token ${token.substring(0, 10)}... for user ${session.usersession_id}`);
      return session.usersession_id;
    } catch (error) {
      logger.error(`Error deleting user with token ${token.substring(0, 10)}... :`, error);
      throw error;
    }
  }
};

export default Session;
