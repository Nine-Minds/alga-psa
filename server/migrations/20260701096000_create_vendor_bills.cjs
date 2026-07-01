/**
 * Vendor bills — light AP (remediation plan F075/F076). A bill records what the
 * vendor invoiced (optionally against a PO), with a due date from the vendor's
 * payment terms and a non-blocking 2-way variance indicator vs received value.
 * Deliberately light (D9): no GL, no payment rails — mark-paid is manual.
 */

const RESOURCE = 'vendor_bill';
const ACTIONS = ['create', 'read', 'update', 'delete'];

exports.up = async function up(knex) {
  await knex.schema.createTable('vendor_bills', (t) => {
    t.uuid('tenant').notNullable();
    t.uuid('bill_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('vendor_id').notNullable();
    t.uuid('po_id').nullable();
    t.text('bill_number').notNullable();
    t.timestamp('bill_date').notNullable().defaultTo(knex.fn.now());
    t.timestamp('due_date').nullable();
    t.text('currency_code').notNullable().defaultTo('USD');
    t.text('status').notNullable().defaultTo('draft');
    t.bigInteger('total_amount').notNullable().defaultTo(0); // cents
    t.timestamp('paid_at').nullable();
    t.text('notes').nullable();
    t.uuid('created_by').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    t.primary(['tenant', 'bill_id']);
    t.unique(['tenant', 'vendor_id', 'bill_number'], { indexName: 'uq_vendor_bills_number' });
    t.foreign(['tenant', 'vendor_id'], 'fk_vendor_bills_vendor')
      .references(['tenant', 'vendor_id'])
      .inTable('vendors');
    t.foreign(['tenant', 'po_id'], 'fk_vendor_bills_po')
      .references(['tenant', 'po_id'])
      .inTable('purchase_orders')
      .onDelete('SET NULL');
    t.index(['tenant', 'vendor_id'], 'idx_vendor_bills_vendor');
    t.index(['tenant', 'status'], 'idx_vendor_bills_status');
    t.index(['tenant', 'po_id'], 'idx_vendor_bills_po');
  });
  await knex.raw(`
    ALTER TABLE vendor_bills ADD CONSTRAINT vendor_bills_status_check
      CHECK (status = ANY (ARRAY['draft'::text, 'open'::text, 'paid'::text, 'void'::text]))
  `);

  await knex.schema.createTable('vendor_bill_lines', (t) => {
    t.uuid('tenant').notNullable();
    t.uuid('bill_line_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('bill_id').notNullable();
    t.uuid('service_id').nullable();
    t.text('description').nullable();
    t.integer('quantity').notNullable().defaultTo(1);
    t.bigInteger('unit_cost').notNullable().defaultTo(0); // cents
    t.bigInteger('amount').notNullable().defaultTo(0); // cents
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    t.primary(['tenant', 'bill_line_id']);
    t.foreign(['tenant', 'bill_id'], 'fk_vendor_bill_lines_bill')
      .references(['tenant', 'bill_id'])
      .inTable('vendor_bills')
      .onDelete('CASCADE');
    t.foreign(['tenant', 'service_id'], 'fk_vendor_bill_lines_service')
      .references(['tenant', 'service_id'])
      .inTable('service_catalog');
    t.index(['tenant', 'bill_id'], 'idx_vendor_bill_lines_bill');
  });
  await knex.raw(`ALTER TABLE vendor_bill_lines ADD CONSTRAINT vendor_bill_lines_qty_check CHECK (quantity > 0)`);

  // Permissions (pattern of 20260626100600_add_inventory_permissions.cjs).
  const tenants = await knex('tenants').select('tenant');
  for (const { tenant } of tenants) {
    const existing = await knex('permissions').where({ tenant, resource: RESOURCE }).select('action');
    const have = new Set(existing.map((p) => p.action));
    const toAdd = ACTIONS.filter((a) => !have.has(a)).map((action) => ({
      tenant,
      permission_id: knex.raw('gen_random_uuid()'),
      resource: RESOURCE,
      action,
      msp: true,
      client: false,
      description: `${action} ${RESOURCE}`,
      created_at: new Date(),
    }));
    if (toAdd.length > 0) await knex('permissions').insert(toAdd);

    const adminRole = await knex('roles')
      .where({ tenant, msp: true, client: false })
      .whereRaw("LOWER(role_name) = 'admin'")
      .first();
    if (adminRole) {
      const perms = await knex('permissions')
        .where({ tenant, msp: true, resource: RESOURCE })
        .select('permission_id');
      const existingRolePerms = await knex('role_permissions')
        .where({ tenant, role_id: adminRole.role_id })
        .select('permission_id');
      const haveRole = new Set(existingRolePerms.map((rp) => rp.permission_id));
      const rolePerms = perms
        .filter((p) => !haveRole.has(p.permission_id))
        .map((p) => ({ tenant, role_id: adminRole.role_id, permission_id: p.permission_id }));
      if (rolePerms.length > 0) await knex('role_permissions').insert(rolePerms);
    }
  }
};

exports.down = async function down(knex) {
  const tenants = await knex('tenants').select('tenant');
  for (const { tenant } of tenants) {
    await knex('role_permissions')
      .where('tenant', tenant)
      .whereIn('permission_id', function () {
        this.select('permission_id').from('permissions').where({ tenant, resource: RESOURCE });
      })
      .delete();
    await knex('permissions').where({ tenant, resource: RESOURCE }).delete();
  }
  await knex.schema.dropTableIfExists('vendor_bill_lines');
  await knex.schema.dropTableIfExists('vendor_bills');
};
