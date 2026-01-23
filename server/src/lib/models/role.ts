import { getCurrentTenantId } from 'server/src/lib/db';
import { IRole } from '../../interfaces/auth.interfaces';
import logger from '@alga-psa/core/logger';
import { Knex } from 'knex';

const Role = {
  getAllRoles: async (knexOrTrx: Knex | Knex.Transaction): Promise<IRole[]> => {
    try {
      const tenant = await getCurrentTenantId();
      
      if (!tenant) {
        logger.error('Tenant context is required for getting roles');
        throw new Error('Tenant context is required for getting roles');
      }

      const roles = await knexOrTrx<IRole>('roles')
        .select('*')
        .where({ tenant });

      return roles;
    } catch (error) {
      logger.error('Error getting all roles:', error);
      throw error;
    }
  },
};

export default Role;
