import knex, { type Knex } from 'knex';

import { createKnexConfig, type DatabaseConfigOverrides } from './config.js';

let database: Knex | undefined;

export function createDatabase(overrides: DatabaseConfigOverrides = {}): Knex {
  return knex(createKnexConfig(overrides));
}

export function getDatabase(): Knex {
  database ??= createDatabase();
  return database;
}

export async function closeDatabase(): Promise<void> {
  if (!database) {
    return;
  }

  const databaseToClose = database;
  database = undefined;
  await databaseToClose.destroy();
}
