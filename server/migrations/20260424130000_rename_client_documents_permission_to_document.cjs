exports.up = async function (knex) {
  // Earlier migration (20250908144222) attempted the same rename but skipped any
  // tenant where a singular 'document' (client=true) row already existed, leaving
  // tenants whose only client document permission rows came from
  // ee/server/seeds/onboarding/02_permissions.cjs ('documents', plural) untouched.
  //
  // role_permissions references permissions by permission_id, so renaming the
  // resource column re-targets every existing assignment in one shot.
  //
  // Verified before writing this migration:
  //   - 0 tenants have BOTH 'document' and 'documents' client=true rows
  //     (no PK/uniqueness collisions; permissions PK is (tenant, permission_id))
  //   - 76 role_permissions rows currently reference plural rows
  //   - No code path checks resource='documents' anywhere

  const tenants = await knex('tenants').select('tenant');

  let totalUpdated = 0;
  for (const { tenant } of tenants) {
    const updated = await knex('permissions')
      .where({ tenant, resource: 'documents', client: true })
      .update({ resource: 'document' });
    totalUpdated += updated;
  }

  console.log(`Renamed ${totalUpdated} client permission rows from 'documents' to 'document'`);
};

exports.down = async function (knex) {
  // Best-effort revert: rename back. Cannot perfectly distinguish rows that
  // were originally 'document' from those renamed by the up migration, so
  // this only reverts when no singular twin would be left behind.
  const tenants = await knex('tenants').select('tenant');

  let totalReverted = 0;
  for (const { tenant } of tenants) {
    const reverted = await knex('permissions')
      .where({ tenant, resource: 'document', client: true })
      .update({ resource: 'documents' });
    totalReverted += reverted;
  }

  console.log(`Reverted ${totalReverted} client permission rows from 'document' to 'documents'`);
};
