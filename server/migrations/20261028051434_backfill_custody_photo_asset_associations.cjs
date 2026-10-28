/** Only custody events provide evidence of a photo's asset. */
exports.up = async function (knex) {
  const tenants = await knex('tenants').select('tenant');
  for (const { tenant } of tenants) {
    const events = await knex('asset_custody_events').where({ tenant }).select('asset_id', 'document_ids');
    for (const event of events) {
      if (!Array.isArray(event.document_ids) || !event.document_ids.length) continue;
      const ids = event.document_ids.filter(id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
      if (!ids.length) continue;
      const asset = await knex('assets').where({ tenant, asset_id: event.asset_id }).first('asset_id');
      if (!asset) continue;
      const docs = await knex('documents').where({ tenant }).whereIn('document_id', ids).select('document_id');
      if (docs.length) {
        await knex('document_associations').insert(docs.map(({ document_id }) => ({
          tenant, document_id, entity_id: event.asset_id, entity_type: 'asset',
        }))).onConflict(['tenant', 'document_id', 'entity_id', 'entity_type']).ignore();
      }
    }
  }
};

// Associations may have existed before this migration; never delete them on rollback.
exports.down = async function () {};
