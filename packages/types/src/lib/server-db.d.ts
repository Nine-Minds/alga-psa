declare module '@alga-psa/db' {
  import type { Knex } from 'knex';

  export function getConnection(tenantId?: string | null): Promise<Knex>;
}
