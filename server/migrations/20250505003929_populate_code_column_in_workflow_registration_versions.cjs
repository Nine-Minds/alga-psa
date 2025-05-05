/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Select all relevant records
  const records = await knex('workflow_registration_versions')
    .select('version_id', 'tenant_id', 'definition');

  // Iterate and update each record individually
  for (const record of records) {
    const executeFn = record.definition?.executeFn; // Safely access executeFn

    // Only update if executeFn exists
    if (executeFn) {
      await knex('workflow_registration_versions')
        .where({
          version_id: record.version_id,
          tenant_id: record.tenant_id // Crucial for CitusDB compatibility
        })
        .update({
          code: executeFn
        });
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex('workflow_registration_versions')
    .update({
      code: null
    });
};
