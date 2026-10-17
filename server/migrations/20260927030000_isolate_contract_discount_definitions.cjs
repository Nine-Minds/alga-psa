'use strict';

/** Existing contract assignments now own independent editable discount definitions. */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('contract_discount_assignments'))
    || !(await knex.schema.hasColumn('contract_discount_assignments', 'client_contract_id'))) return;

  const { rows: shared } = await knex.raw(`
    SELECT tenant, discount_id
    FROM contract_discount_assignments
    GROUP BY tenant, discount_id
    HAVING COUNT(*) > 1
    ORDER BY tenant, discount_id
  `);
  for (const group of shared) {
    const { rows: assignments } = await knex.raw(`
      SELECT assignment_id, client_contract_id
      FROM contract_discount_assignments
      WHERE tenant = ? AND discount_id = ?
      ORDER BY client_contract_id, assignment_id
    `, [group.tenant, group.discount_id]);
    // Keep the original definition for the first assignment, and retain every
    // assignment UUID so existing invoice settlement provenance remains stable.
    const [sourceAssignment, ...otherAssignments] = assignments;
    if (!sourceAssignment) continue;
    const source = await knex('discounts')
      .where({ tenant: group.tenant, discount_id: group.discount_id })
      .first();
    if (!source) continue;
    for (const assignment of otherAssignments) {
      const newDiscountId = require('crypto').randomUUID();
      await knex('discounts').insert({
        ...source,
        discount_id: newDiscountId,
        created_at: source.created_at ?? knex.fn.now(),
        updated_at: knex.fn.now(),
      });
      await knex('contract_discount_assignments')
        .where({ tenant: group.tenant, assignment_id: assignment.assignment_id })
        .update({ discount_id: newDiscountId });
    }
  }
};

exports.down = async function down() {
  // Merging independently edited definitions would discard contract-owned terms.
};
