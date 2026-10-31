/** Only custody events provide evidence of a photo's asset. */
exports.up = async function (knex) {
  const tenants = await knex('tenants').select('tenant');
  let created = 0;
  for (const { tenant } of tenants) {
    let cursor = null;
    for (;;) {
      const query = knex('asset_custody_events').where({ tenant }).select('event_id', 'asset_id', 'document_ids').orderBy('asset_id').orderBy('event_id').limit(200);
      if (cursor) query.whereRaw('(asset_id, event_id) > (?, ?)', [cursor.asset_id, cursor.event_id]);
      const events = await query;
      if (!events.length) break;
      cursor = events[events.length - 1];
      for (const event of events) {
        if (!Array.isArray(event.document_ids) || !event.document_ids.length) continue;
        const ids = event.document_ids.filter(id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
        if (!ids.length) continue;
        const asset = await knex('assets').where({ tenant, asset_id: event.asset_id }).first('asset_id');
        if (!asset) continue;
        const docs = await knex('documents').where({ tenant }).whereIn('document_id', ids).select('document_id');
        if (docs.length) {
          const inserted = await knex('document_associations').insert(docs.map(({ document_id }) => ({
            tenant, document_id, entity_id: event.asset_id, entity_type: 'asset',
          }))).onConflict(['tenant', 'document_id', 'entity_id', 'entity_type']).ignore().returning('association_id');
          created += inserted.length;
        }
      }
    }
  }
  console.log(`Backfilled ${created} custody photo asset associations`);
};

// Associations may have existed before this migration; never delete them on rollback.
exports.down = async function () {};
