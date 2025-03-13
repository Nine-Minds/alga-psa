import Knex from 'knex';
import knexfile from './knexfile';
import { getSecret } from '../utils/getSecret';

export async function getAdminConnection() {
    const environment = process.env.NODE_ENV || 'development';
    const dbPassword = await getSecret('postgres_password', 'DB_PASSWORD_ADMIN');
    const config = {
        ...knexfile[environment],
        connection: {
            host: process.env.DB_HOST,
            port: Number(process.env.DB_PORT),
            user: process.env.DB_USER_ADMIN,
            password: dbPassword,
            database: process.env.DB_NAME_SERVER
        }
    };
    console.log('Creating admin database connection');

    return Knex(config);
}
