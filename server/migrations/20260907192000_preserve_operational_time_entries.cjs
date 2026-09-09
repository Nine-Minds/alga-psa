const { supportsTriggers } = require('./utils/citusDistribution.cjs');
const UNPRICED = `billable_duration IS NOT DISTINCT FROM 0 AND service_id IS NULL AND contract_line_id IS NULL
  AND contract_line_source IS NULL AND contract_line_unresolved_reason IS NULL AND tax_rate_id IS NULL AND tax_region IS NULL AND invoiced IS NOT TRUE`;

exports.up = async function(knex) {
  // Never silently rewrite pre-existing financial evidence during classification.
  // Resolve the co-managed tenants first and filter by that list: `tenants` is
  // distributed under Citus while `time_entries` is not, and Citus rejects a
  // direct join between a distributed and a local table.
  const coManagedTenants = (await knex('tenants').where('product_code', 'co_managed').pluck('tenant'));
  if (coManagedTenants.length) {
    const customerEntries = () => knex('time_entries as e').whereIn('e.tenant', coManagedTenants);
    const priced = await customerEntries().whereRaw(`NOT (${UNPRICED.replace(/\b(billable_duration|service_id|contract_line_id|contract_line_source|contract_line_unresolved_reason|tax_rate_id|tax_region|invoiced)\b/g, 'e.$1')})`).first('e.entry_id');
    const linked = await customerEntries().whereExists(knex('invoice_time_entries as i').select(knex.raw('1')).whereRaw('i.tenant::uuid = e.tenant AND i.entry_id = e.entry_id')).first('e.entry_id');
    if (priced || linked) throw new Error('Existing co-managed time has billing evidence; reconcile it before classifying operational effort');
  }

  if (!await knex.schema.hasColumn('time_entries', 'billing_mode')) await knex.schema.alterTable('time_entries', table => table.string('billing_mode', 16).notNullable().defaultTo('commercial'));
  if (coManagedTenants.length) {
    await knex('time_entries').whereIn('tenant', coManagedTenants).update({ billing_mode: 'operational' });
  }
  await knex.raw('ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_billing_mode_check');
  await knex.raw(`ALTER TABLE time_entries ADD CONSTRAINT time_entries_billing_mode_check CHECK (
    billing_mode = 'commercial' OR (billing_mode = 'operational' AND (${UNPRICED})))`);
  await knex.raw(`CREATE OR REPLACE FUNCTION preserve_operational_time_entry() RETURNS trigger AS $$
    DECLARE product text;
    BEGIN
      SELECT product_code INTO product FROM tenants WHERE tenant = NEW.tenant FOR SHARE;
      IF TG_OP = 'UPDATE' AND OLD.billing_mode = 'operational' AND NEW.billing_mode IS DISTINCT FROM 'operational' THEN
        RAISE EXCEPTION 'Operational time cannot become invoiceable' USING ERRCODE = '23514', CONSTRAINT = 'time_entries_operational_mode_immutable';
      END IF;
      IF product = 'co_managed' THEN NEW.billing_mode := 'operational'; END IF;
      IF NEW.billing_mode = 'operational' AND EXISTS (SELECT 1 FROM invoice_time_entries WHERE tenant::uuid = NEW.tenant AND entry_id = NEW.entry_id) THEN
        RAISE EXCEPTION 'Invoiced time cannot become operational effort' USING ERRCODE = '23514', CONSTRAINT = 'operational_time_not_invoiceable';
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql`);
  if (await supportsTriggers(knex, 'time_entries')) {
    await knex.raw('DROP TRIGGER IF EXISTS preserve_operational_time_entry ON time_entries');
    await knex.raw('CREATE TRIGGER preserve_operational_time_entry BEFORE INSERT OR UPDATE ON time_entries FOR EACH ROW EXECUTE FUNCTION preserve_operational_time_entry()');
  }
  await knex.raw(`CREATE OR REPLACE FUNCTION reject_operational_invoice_time() RETURNS trigger AS $$
    DECLARE mode text;
    BEGIN
      SELECT billing_mode INTO mode FROM time_entries WHERE tenant = NEW.tenant::uuid AND entry_id = NEW.entry_id FOR SHARE;
      IF mode IS NULL OR mode = 'operational' THEN
        RAISE EXCEPTION 'Invoice time must reference commercial effort owned by the invoice tenant' USING ERRCODE = '23514', CONSTRAINT = 'operational_time_not_invoiceable';
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql`);
  if (await supportsTriggers(knex, 'invoice_time_entries')) {
    await knex.raw('DROP TRIGGER IF EXISTS reject_operational_invoice_time ON invoice_time_entries');
    await knex.raw('CREATE TRIGGER reject_operational_invoice_time BEFORE INSERT OR UPDATE ON invoice_time_entries FOR EACH ROW EXECUTE FUNCTION reject_operational_invoice_time()');
  }
};

exports.down = async function(knex) {
  if (await knex('time_entries').where('billing_mode', 'operational').first()) throw new Error('Cannot discard retained operational time history');
  if (await supportsTriggers(knex, 'invoice_time_entries')) {
    await knex.raw('DROP TRIGGER IF EXISTS reject_operational_invoice_time ON invoice_time_entries');
  }
  await knex.raw('DROP FUNCTION IF EXISTS reject_operational_invoice_time()');
  if (await supportsTriggers(knex, 'time_entries')) {
    await knex.raw('DROP TRIGGER IF EXISTS preserve_operational_time_entry ON time_entries');
  }
  await knex.raw('DROP FUNCTION IF EXISTS preserve_operational_time_entry()');
  await knex.raw('ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_billing_mode_check');
  await knex.schema.alterTable('time_entries', table => table.dropColumn('billing_mode'));
};
