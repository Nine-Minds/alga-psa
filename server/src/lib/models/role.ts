import { createTenantKnex } from 'server/src/lib/db';
import { IRole } from '../../interfaces/auth.interfaces';
import logger from '@shared/core/logger';

const Role = {
  getAllRoles: async (): Promise<IRole[]> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      
      if (!tenant) {
        logger.error('Tenant context is required for getting roles');
        throw new Error('Tenant context is required for getting roles');
      }

      const roles = await db<IRole>('roles')
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
