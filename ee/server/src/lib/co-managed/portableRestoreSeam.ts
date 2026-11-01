import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * What activation needs from CM L7b2 (portable restore), written against L7b2's contract
 * (`origin/feature/cm-l7b2-portable-restore`, PR #4052):
 *  - `portable_workspace_restores` receipt, state machine `staged -> promoted -> verified`, carrying the
 *    restored `administrator_user_id` (nullable);
 *  - `portable_restore_suspensions` marker, `reason` `portable_restore_in_progress` ->
 *    `portable_restore_pending_activation`, released by setting `released_at`. L7b2 never writes
 *    `tenants.suspended_at` / `suspended_reason`, so activation must not look there;
 *  - `assertPortableRestoreInstallationAuthority(db)` in `packages/co-managed/src/portableRestoreInstallationAuthority.ts`.
 */
export interface PortableRestorePending { tenant: string; administrator_user_id: string }

export interface PortableRestoreSeam {
  /** Throws unless the caller is the installation (not a tenant request). */
  assertInstallationAuthority(trx: Knex.Transaction): Promise<void>;
  /**
   * The restore awaiting activation, or undefined. Only a VERIFIED restore with a restored administrator
   * AND an unreleased `portable_restore_pending_activation` suspension qualifies: a restore still in
   * progress, merely promoted, or already released never does.
   */
  findPendingActivation(trx: Knex.Transaction, tenant: string): Promise<PortableRestorePending | undefined>;
  /** Release the pending-activation suspension inside the activation transaction; exactly one row or throw. */
  releasePendingActivation(trx: Knex.Transaction, tenant: string): Promise<void>;
}

const PENDING = 'portable_restore_pending_activation';

/** The two reads and the release, against L7b2's tables. Absent tables (L7b2 not migrated) mean "no restore". */
export const portableRestoreTables = {
  async findPendingActivation(trx: Knex.Transaction, tenant: string): Promise<PortableRestorePending | undefined> {
    if (!await trx.schema.hasTable('portable_workspace_restores') || !await trx.schema.hasTable('portable_restore_suspensions')) return undefined;
    const own = tenantDb(trx, tenant);
    const restore = await own.table('portable_workspace_restores').forShare().first('tenant', 'state', 'administrator_user_id');
    if (!restore || restore.state !== 'verified' || typeof restore.administrator_user_id !== 'string') return undefined;
    const suspension = await own.table('portable_restore_suspensions').forUpdate().first('reason', 'released_at');
    if (!suspension || suspension.reason !== PENDING || suspension.released_at !== null) return undefined;
    return { tenant: restore.tenant, administrator_user_id: restore.administrator_user_id };
  },
  async releasePendingActivation(trx: Knex.Transaction, tenant: string): Promise<void> {
    const released = await tenantDb(trx, tenant).table('portable_restore_suspensions')
      .where('reason', PENDING).whereNull('released_at').update({ released_at: trx.fn.now() });
    if (released !== 1) throw new Error('Portable workspace activation rejected: restore suspension changed');
  },
};

/**
 * Default wiring. Fails closed until L7b2 lands on main: plug its `assertPortableRestoreInstallationAuthority`
 * into `assertInstallationAuthority` and nothing else here changes. Because authority is asserted first,
 * no restore read, password check, provider call or write happens before then.
 */
export const portableRestoreSeam: PortableRestoreSeam = {
  async assertInstallationAuthority() {
    throw new Error('Portable restore installation authority is not available in this build (CM L7b2)');
  },
  findPendingActivation: portableRestoreTables.findPendingActivation,
  releasePendingActivation: portableRestoreTables.releasePendingActivation,
};
