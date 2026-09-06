const { v4: uuidv4 } = require('uuid');
const { DEFAULTS } = require('../psa/08_document_folder_templates.cjs');
const { forCoManagedTenants } = require('../lib/coManagedSeeds.cjs');

// Reuse operational defaults, excluding commercial entities and folders. Replay
// adds missing defaults without deleting a customer's customized folder setup.
exports.seed = async function (knex, tenantId) {
  const { tenantDb } = await import('@alga-psa/db');
  await forCoManagedTenants(knex, tenantId, async (tenant) => {
    const db = tenantDb(knex, tenant);
    for (const def of DEFAULTS) {
      if (def.entity_type === 'contract') continue;
      for (const item of def.items) {
        if (/^\/Clients\/(Contracts|Invoices|Sales Orders)(\/|$)/.test(item.folder_path)) continue;
        const identity = { entity_type: def.entity_type, folder_path: item.folder_path };
        if (await db.table('document_default_folders').where(identity).first()) continue;
        await db.table('document_default_folders').insert({ tenant, default_folder_id: uuidv4(),
          entity_type: def.entity_type, ...item, created_at: knex.fn.now(), updated_at: knex.fn.now(),
          created_by: null, updated_by: null,
        });
      }
    }
  });
};
