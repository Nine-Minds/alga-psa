// alga-2026-0003347: second convergence of contacts.is_client_admin.
//
// 20261118120000 repaired the drift the UI had written, but the application
// fix that shipped with it only covered five server actions. Every other
// writer of `user_roles` — the v1 REST API among them (the path the reporter
// automates), the Entra sync, the registration and invitation paths, and the
// user-creation paths that assign a role to a contact already pre-marked as a
// portal admin — kept writing roles without re-deriving the flag. So drift has
// accumulated again since that migration ran, and the portal visibility
// resolver still widens a flagged contact's ticket, asset and project scope
// from "their own" to "the whole company".
//
// Same convergence as the first repair, which is deliberately left untouched:
// contacts that HAVE a linked portal user (users.user_type = 'client') only,
// both directions (pass 1 clears a stale true, pass 2 sets a missing true).
// Contacts WITHOUT a portal user keep their flag — there it is the invitation
// pre-seed that decides which role the account is created with.
//
// Runs outside one big transaction. Each tenant is repaired in batches of
// BATCH_SIZE contacts, one short transaction per batch, looping until a batch
// comes back short. Every statement is tenant-pinned on both sides of every
// join (contacts.tenant = users.tenant = user_roles.tenant = roles.tenant = ?)
// so Citus routes it to that tenant's single shard. A repaired row leaves its
// pass's predicate, so each loop makes progress and ends. No DDL, idempotent
// (a second run updates 0 rows), N-1 compatible.
const BATCH_SIZE = 1000;

exports.config = { transaction: false };
exports.BATCH_SIZE = BATCH_SIZE;

// Flagged as a portal admin while the linked portal user holds no client
// 'Admin' role — identified the way the rest of the codebase does
// (roles.client = true, case-insensitive "admin"; see clientPortalAdminFlag,
// userRoleFloor and portalInvitationActions).
const CLEAR_STALE_FLAG_SQL = `
    WITH batch AS MATERIALIZED (
        SELECT c.contact_name_id
          FROM contacts AS c
          JOIN users AS u
            ON u.tenant = c.tenant
           AND u.contact_id = c.contact_name_id
         WHERE c.tenant = ?
           AND u.tenant = ?
           AND u.user_type = 'client'
           AND c.is_client_admin
           AND NOT EXISTS (
               SELECT 1
                 FROM user_roles AS ur
                 JOIN roles AS r
                   ON r.tenant = ur.tenant
                  AND r.role_id = ur.role_id
                WHERE ur.tenant = c.tenant
                  AND ur.user_id = u.user_id
                  AND r.client = true
                  AND lower(r.role_name) = 'admin'
           )
         LIMIT ?
    )
    UPDATE contacts AS tgt
       SET is_client_admin = false,
           updated_at = now()
      FROM batch
     WHERE tgt.tenant = ?
       AND tgt.contact_name_id = batch.contact_name_id
`;

// The other direction: the user holds the client 'Admin' role but the contact
// was never flagged, so the portal showed them a non-admin's scope. The
// creation paths produced this one too — an invitation that pre-seeded no flag
// but created the account with the Admin role.
const SET_MISSING_FLAG_SQL = `
    WITH batch AS MATERIALIZED (
        SELECT c.contact_name_id
          FROM contacts AS c
          JOIN users AS u
            ON u.tenant = c.tenant
           AND u.contact_id = c.contact_name_id
         WHERE c.tenant = ?
           AND u.tenant = ?
           AND u.user_type = 'client'
           AND NOT c.is_client_admin
           AND EXISTS (
               SELECT 1
                 FROM user_roles AS ur
                 JOIN roles AS r
                   ON r.tenant = ur.tenant
                  AND r.role_id = ur.role_id
                WHERE ur.tenant = c.tenant
                  AND ur.user_id = u.user_id
                  AND r.client = true
                  AND lower(r.role_name) = 'admin'
           )
         LIMIT ?
    )
    UPDATE contacts AS tgt
       SET is_client_admin = true,
           updated_at = now()
      FROM batch
     WHERE tgt.tenant = ?
       AND tgt.contact_name_id = batch.contact_name_id
`;

exports.CLEAR_STALE_FLAG_SQL = CLEAR_STALE_FLAG_SQL;
exports.SET_MISSING_FLAG_SQL = SET_MISSING_FLAG_SQL;

async function convergeTenant(knex, tenant, sql) {
  for (;;) {
    const result = await knex.transaction(async (trx) => {
      await trx.raw("SET LOCAL lock_timeout = '2s'");
      return trx.raw(sql, [tenant, tenant, BATCH_SIZE, tenant]);
    });
    const updated = typeof result.rowCount === 'number' ? result.rowCount : 0;
    if (updated < BATCH_SIZE) break;
  }
}

exports.convergeTenant = convergeTenant;

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('contacts')) || !(await knex.schema.hasTable('user_roles'))) {
    return;
  }

  const tenants = await knex('users').where({ user_type: 'client' }).distinct('tenant').pluck('tenant');

  for (const tenant of tenants) {
    await convergeTenant(knex, tenant, CLEAR_STALE_FLAG_SQL);
    await convergeTenant(knex, tenant, SET_MISSING_FLAG_SQL);
  }
};

exports.down = async function down() {
  // Data repair; nothing to restore (it only re-derived a flag the user's
  // client portal roles already decide).
};
