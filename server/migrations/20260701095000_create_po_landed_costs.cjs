/**
 * Landed cost (remediation plan F069): freight/duty/other amounts attached to a PO
 * and applied — as a separate, idempotent step, because these costs usually arrive
 * after the goods — across RECEIVED quantities. Application adjusts the
 * moving-average cost (cost-only, no phantom quantity) and bumps unit_cost on
 * not-yet-consumed serialized units from that PO.
 */

const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

exports.up = async function up(knex) {
  await knex.schema.createTable('po_landed_costs', (t) => {
    t.uuid('tenant').notNullable();
    t.uuid('landed_cost_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('po_id').notNullable();
    t.text('cost_type').notNullable().defaultTo('freight');
    t.bigInteger('amount').notNullable(); // cents
    t.text('currency_code').notNullable().defaultTo('USD');
    t.text('allocation_method').notNullable().defaultTo('value');
    t.text('description').nullable();
    t.boolean('applied').notNullable().defaultTo(false);
    t.timestamp('applied_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    t.primary(['tenant', 'landed_cost_id']);
    t.foreign(['tenant', 'po_id'], 'fk_po_landed_costs_po')
      .references(['tenant', 'po_id'])
      .inTable('purchase_orders')
      .onDelete('CASCADE');
    t.index(['tenant', 'po_id'], 'idx_po_landed_costs_po');
  });

  // Distribute on Citus (colocated with tenants).
  await ensureTenantDistribution(knex, 'po_landed_costs');

  await knex.raw(`
    ALTER TABLE po_landed_costs ADD CONSTRAINT po_landed_costs_type_check
      CHECK (cost_type = ANY (ARRAY['freight'::text, 'duty'::text, 'other'::text]))
  `);
  await knex.raw(`
    ALTER TABLE po_landed_costs ADD CONSTRAINT po_landed_costs_method_check
      CHECK (allocation_method = ANY (ARRAY['value'::text, 'quantity'::text]))
  `);
  await knex.raw(`ALTER TABLE po_landed_costs ADD CONSTRAINT po_landed_costs_amount_check CHECK (amount > 0)`);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('po_landed_costs');
};

exports.config = { transaction: false };
