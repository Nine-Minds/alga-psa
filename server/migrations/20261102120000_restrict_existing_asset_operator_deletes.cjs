const MIGRATION_TENANT = 'migration:20261102120000_restrict_existing_asset_operator_deletes';
const TENANT_ENUMERATION_REASON = 'upgrade restricted asset operator delete authorization';

async function tenantDbForMigration() {
  return require('./utils/tenantDb.cjs').tenantDb;
}

exports.up = async function up(knex) {
  const tenantDb = await tenantDbForMigration();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);
    const bundles = await db.table('authorization_bundles')
      .where({ bundle_key: 'restricted-asset-operator', status: 'active' })
      .select('bundle_id', 'published_revision_id');

    for (const bundle of bundles) {
      await knex.transaction(async (trx) => {
        const scoped = tenantDb(trx, tenant);
        const lockedBundle = await scoped.table('authorization_bundles')
          .where({ bundle_id: bundle.bundle_id, bundle_key: 'restricted-asset-operator', status: 'active' })
          .forUpdate()
          .first('bundle_id', 'published_revision_id');
        if (!lockedBundle?.published_revision_id) return;

        const publishedRules = await scoped.table('authorization_bundle_rules')
          .where({ bundle_id: bundle.bundle_id, revision_id: lockedBundle.published_revision_id })
          .orderBy('position', 'asc')
          .select('resource_type', 'action', 'template_key', 'effect', 'constraint_key', 'config', 'position');
        if (publishedRules.some((rule) => rule.resource_type === 'asset' && rule.action === 'delete' &&
          rule.template_key === 'same_team' && rule.constraint_key == null)) return;

        const maxRevision = await scoped.table('authorization_bundle_revisions')
          .where({ bundle_id: bundle.bundle_id })
          .max('revision_number as max_revision_number')
          .first();
        const revisionNumber = Number(maxRevision?.max_revision_number || 0) + 1;
        const now = trx.fn.now();
        await scoped.table('authorization_bundle_revisions')
          .where({ bundle_id: bundle.bundle_id, revision_id: lockedBundle.published_revision_id, lifecycle_state: 'published' })
          .update({ lifecycle_state: 'archived', updated_at: now });
        const [revision] = await scoped.table('authorization_bundle_revisions').insert({
          tenant,
          bundle_id: bundle.bundle_id,
          revision_number: revisionNumber,
          lifecycle_state: 'published',
          summary: 'Security upgrade: restrict asset deletion to the subject team',
          published_at: now,
          published_by: null,
          created_by: null,
          updated_by: null,
        }).returning('revision_id');

        const copiedRules = publishedRules.map((rule) => ({
          tenant,
          bundle_id: bundle.bundle_id,
          revision_id: revision.revision_id,
          resource_type: rule.resource_type,
          action: rule.action,
          template_key: rule.template_key,
          effect: rule.effect,
          constraint_key: rule.constraint_key,
          config: rule.config,
          position: rule.position,
          created_by: null,
        }));
        copiedRules.push({
          tenant,
          bundle_id: bundle.bundle_id,
          revision_id: revision.revision_id,
          resource_type: 'asset',
          action: 'delete',
          template_key: 'same_team',
          effect: 'narrow',
          constraint_key: null,
          config: {},
          position: publishedRules.reduce((max, rule) => Math.max(max, rule.position), -1) + 1,
          created_by: null,
        });
        await scoped.table('authorization_bundle_rules').insert(copiedRules);
        await scoped.table('authorization_bundles').where({ bundle_id: bundle.bundle_id }).update({
          published_revision_id: revision.revision_id,
          updated_at: now,
        });
      });
    }
  }
};

exports.down = async function down() {
  // Published security repairs are intentionally retained on rollback.
};
