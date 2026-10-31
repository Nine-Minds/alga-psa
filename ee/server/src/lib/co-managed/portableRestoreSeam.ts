import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/** What activation needs from CM L7b2 (portable restore). L7b2 owns the `portable_workspace_restores`
 * table and the installation-authority check; this card only reads them through this seam. */
export interface PortableRestoreReceipt { tenant: string; administrator_user_id: string }

export interface PortableRestoreSeam {
  /** Throws unless the caller is the installation (not a tenant request). */
  assertInstallationAuthority(trx: Knex.Transaction): Promise<void>;
  /** The restore row for the tenant, or undefined when the workspace was never restored. */
  findRestore(trx: Knex.Transaction, tenant: string): Promise<PortableRestoreReceipt | undefined>;
}

/** Default wiring. Fails closed until L7b2 lands: plug its `assertPortableRestoreInstallationAuthority`
 * into `assertInstallationAuthority` here. The restore lookup is a plain read of L7b2's table and so
 * already works once that table exists; where it does not, there is no restore and activation refuses. */
export const portableRestoreSeam: PortableRestoreSeam = {
  async assertInstallationAuthority() {
    throw new Error('Portable restore installation authority is not available in this build (CM L7b2)');
  },
  async findRestore(trx, tenant) {
    if (!await trx.schema.hasTable('portable_workspace_restores')) return undefined;
    return tenantDb(trx, tenant).table('portable_workspace_restores').forShare().first() as Promise<PortableRestoreReceipt | undefined>;
  },
};
