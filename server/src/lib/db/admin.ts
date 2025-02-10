import Knex from 'knex';
import knexfile from './knexfile';
import { getSecret } from '../utils/getSecret';

export async function getAdminConnection() {
    const environment = process.env.NODE_ENV || 'development';
    const dbPassword = await getSecret('postgres_password', 'DB_PASSWORD_ADMIN');
    const config = {
        ...knexfile[environment],
        connection: `pg://${process.env.DB_USER_ADMIN}:${dbPassword}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME_SERVER}`
    };

    // console.log('config', config);
    
    return Knex(config);
}
