declare module 'server/src/lib/db/db' {
  import type { Knex } from 'knex';

  export function getConnection(tenantId?: string | null): Promise<Knex>;
}
