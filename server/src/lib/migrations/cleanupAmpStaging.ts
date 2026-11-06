import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/** Failed imports retain verified source bytes for 30 days; a retry after expiry restages the
 * original AMP package. Never touches committed native files or another tenant's staging. */
export async function cleanupAmpStaging(knex: Knex, tenant: string): Promise<number> {
  if (!await knex.schema.hasTable('migration_staged_attachments')) return 0;
  return tenantDb(knex, tenant).table('migration_staged_attachments').where('expires_at', '<=', knex.fn.now()).delete();
}
