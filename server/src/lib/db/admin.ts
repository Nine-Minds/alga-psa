import Knex from 'knex';
import knexfile from './knexfile';

export async function getAdminConnection() {
    const environment = process.env.NODE_ENV || 'development';
    const config = {
        ...knexfile[environment],
        connection: `pg://${process.env.DB_USER_ADMIN}:${process.env.DB_PASSWORD_ADMIN}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME_SERVER}`
    };
    
    return Knex(config);
}
