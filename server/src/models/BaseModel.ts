import { createTenantKnex } from '../lib/db';
import { Knex } from 'knex';

export abstract class BaseModel {
  static async getKnex(): Promise<Knex> {
    const { knex } = await createTenantKnex();
    return knex;
  }
}