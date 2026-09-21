import type { Knex } from 'knex';

/** Installation operations require the actual database owner or a superuser.
 * Tenant sessions and browser/API assertions do not grant this authority. */
export async function assertPortableRestoreInstallationAuthority(db: Knex | Knex.Transaction) {
  const { rows } = await db.raw(`SELECT r.rolsuper OR pg_has_role(current_user, d.datdba, 'MEMBER') AS allowed
    FROM pg_roles r CROSS JOIN pg_database d WHERE r.rolname=current_user AND d.datname=current_database()`);
  if (rows.length !== 1 || rows[0].allowed !== true) throw new Error('Portable installation restore rejected: database owner authority required');
}
