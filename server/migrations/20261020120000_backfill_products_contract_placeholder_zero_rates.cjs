// Data repair for alga-2026-0002714: Products contracts valued at $0.
//
// The contract wizard used to persist a placeholder 0 for Products lines:
//   (a) contract_lines.custom_rate = 0 (rate_provenance 'custom'), and
//   (b) contract_line_service_fixed_config.base_rate = 0, pricing_basis = 'bundle' on each
//       product member.
// Readers trusted the 0 over the member/catalog price, so the contract was valued at $0 while
// the invoice engine (which ignores the placeholder) billed the catalog price. The wizard no
// longer writes the placeholder and the readers ignore a zero line rate on priced product
// lines; this migration rewrites the rows that already carry it. Exactly two shapes, per tenant:
//
//   1. contract_lines (non-template, contract_type Fixed) with custom_rate = 0 that hold at least
//      one PRICED product member -> custom_rate = NULL, rate_provenance = 'inherited'.
//      "Priced" is the resolver's definition (shared/billingClients/recurringMemberRate
//      hasRecurringMemberRate): a configuration custom_rate, a legacy contract_line_services
//      custom_rate, a service_prices row in the CONTRACT's currency, or a catalog default_rate.
//      A non-product line with custom_rate = 0 is never touched.
//   2. contract_line_service_fixed_config with base_rate = 0 AND pricing_basis = 'bundle' whose
//      member is a product (service_catalog.item_kind = 'product') AND whose line is a
//      non-template contract line with a contract_id (same scope as step 1; template
//      lines are left untouched)
//      -> base_rate = NULL, rate_provenance = 'inherited', pricing_basis = 'unit'.
//   3. The same product members on the same non-template contract lines that already have
//      base_rate IS NULL AND pricing_basis = 'bundle' (what the wizard wrote between the
//      placeholder fix and the basis fix) -> pricing_basis = 'unit'.
//
// Why 'unit': the engine bills a product member as quantity x resolved rate (it never reads a
// product's pricing_basis -- product members are excluded from the fixed-line loaders), so
// 'bundle' only made the UI call the seat count "an allocation of the bundle price". Product
// members with a real (non-zero) base_rate are NOT touched: that is a different shape (quote
// conversion) and carries information.
//
// This extends the (unmerged, never-applied) placeholder backfill instead of adding a sibling
// migration because both steps select the very same rows with the same scope; two migrations
// would have to agree on that WHERE clause forever.
//
// rate_provenance moves with the rate because of the CHECK constraints (a NULL rate must be
// 'inherited'). Not reversible: the zero was a placeholder, not information (down is a no-op).
//
// base_rate_basis (20261012000001_fixed_member_base_rate_basis, merged): it adds
// CHECK ((base_rate IS NULL) = (base_rate_basis IS NULL)) and a seat check (pricing_basis = 'unit'
// => base_rate_basis IS DISTINCT FROM 'share'). Step 2 therefore clears base_rate_basis together
// with base_rate (the wizard placeholder wrote base_rate_basis 'per_unit'); step 3 only touches rows
// whose base_rate is already NULL, which the pair CHECK guarantees have a NULL basis. The column is
// cleared only when it exists, so the file stays valid on a database that predates that migration.
//
// Ordering: knex runs any unapplied file regardless of its timestamp, and no migration newer than
// this one touches contract_lines / contract_line_service_fixed_config, so the name is unchanged.
//
// Citus-safe: every statement is tenant-scoped, ids are selected first and bound in Node, there
// are no joins/functions/casts in the UPDATEs. Row counts are logged per tenant and in total.
const MIGRATION_TENANT = 'migration:20261020120000_backfill_products_contract_placeholder_zero_rates';
const TENANT_ENUMERATION_REASON = 'enumerate tenants for products placeholder-zero rate backfill';
const CHUNK = 500;

exports.config = { transaction: true };

function chunk(items) {
  const out = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

// Config ids of Fixed members that (a) match `rateFilter` on the fixed config with
// pricing_basis = 'bundle', (b) are catalog products and (c) sit on a non-template contract line.
async function productMemberConfigIds(db, rateFilter) {
  const candidates = await rateFilter(db.table('contract_line_service_fixed_config').where('pricing_basis', 'bundle'))
    .select('config_id');
  if (candidates.length === 0) return [];

  const configToMember = new Map();
  for (const ids of chunk(candidates.map((row) => row.config_id))) {
    const rows = await db.table('contract_line_service_configuration')
      .whereIn('config_id', ids)
      .select('config_id', 'service_id', 'contract_line_id');
    for (const row of rows) configToMember.set(row.config_id, row);
  }
  // Same scope as step 1: only non-template lines that belong to a contract.
  const contractLineIds = new Set();
  for (const ids of chunk(Array.from(new Set(Array.from(configToMember.values(), (m) => m.contract_line_id))))) {
    const rows = await db.table('contract_lines')
      .whereIn('contract_line_id', ids)
      .whereNotNull('contract_id')
      .where(function notTemplate() {
        this.where('is_template', false).orWhereNull('is_template');
      })
      .select('contract_line_id');
    for (const row of rows) contractLineIds.add(row.contract_line_id);
  }
  const productServices = new Set();
  for (const ids of chunk(Array.from(new Set(Array.from(configToMember.values(), (m) => m.service_id))))) {
    const rows = await db.table('service_catalog')
      .whereIn('service_id', ids)
      .where('item_kind', 'product')
      .select('service_id');
    for (const row of rows) productServices.add(row.service_id);
  }
  const out = [];
  for (const [configId, member] of configToMember) {
    if (productServices.has(member.service_id) && contractLineIds.has(member.contract_line_id)) out.push(configId);
  }
  return out;
}

exports.up = async function up(knex) {
  const { tenantDb } = require('./utils/tenantDb.cjs');
  const tenants = await tenantDb(knex, MIGRATION_TENANT)
    .unscoped('tenants', TENANT_ENUMERATION_REASON)
    .select('tenant');

  let totalLines = 0;
  let totalConfigs = 0;
  let totalBasisOnly = 0;

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);
    const nowIso = new Date().toISOString();

    // ---- 1. contract_lines.custom_rate = 0 on lines with priced product members ----
    const zeroLines = await db.table('contract_lines')
      .where('contract_line_type', 'Fixed')
      .where('custom_rate', 0)
      .whereNotNull('contract_id')
      .where(function notTemplate() {
        this.where('is_template', false).orWhereNull('is_template');
      })
      .select('contract_line_id', 'contract_id');

    const lineIdsToFix = [];
    if (zeroLines.length > 0) {
      const lineIds = zeroLines.map((row) => row.contract_line_id);
      const contractIds = Array.from(new Set(zeroLines.map((row) => row.contract_id)));

      const currencyByContract = new Map();
      for (const ids of chunk(contractIds)) {
        const rows = await db.table('contracts').whereIn('contract_id', ids).select('contract_id', 'currency_code');
        for (const row of rows) currencyByContract.set(row.contract_id, row.currency_code);
      }

      const members = [];
      for (const ids of chunk(lineIds)) {
        const rows = await db.table('contract_line_service_configuration')
          .where('configuration_type', 'Fixed')
          .whereIn('contract_line_id', ids)
          .select('contract_line_id', 'service_id', 'custom_rate');
        members.push(...rows);
      }

      const serviceIds = Array.from(new Set(members.map((row) => row.service_id)));
      const catalogByService = new Map();
      const pricesByService = new Map();
      for (const ids of chunk(serviceIds)) {
        const catalogRows = await db.table('service_catalog')
          .whereIn('service_id', ids)
          .select('service_id', 'item_kind', 'default_rate');
        for (const row of catalogRows) catalogByService.set(row.service_id, row);
        const priceRows = await db.table('service_prices')
          .whereIn('service_id', ids)
          .select('service_id', 'currency_code');
        for (const row of priceRows) {
          const set = pricesByService.get(row.service_id) ?? new Set();
          set.add(row.currency_code);
          pricesByService.set(row.service_id, set);
        }
      }

      const serviceLineRates = new Map();
      for (const ids of chunk(lineIds)) {
        const rows = await db.table('contract_line_services')
          .whereIn('contract_line_id', ids)
          .select('contract_line_id', 'service_id', 'custom_rate');
        for (const row of rows) serviceLineRates.set(`${row.contract_line_id}:${row.service_id}`, row.custom_rate);
      }

      const lineContract = new Map(zeroLines.map((row) => [row.contract_line_id, row.contract_id]));
      const fixable = new Set();
      for (const member of members) {
        const catalog = catalogByService.get(member.service_id);
        if (!catalog || catalog.item_kind !== 'product') continue;
        const currency = currencyByContract.get(lineContract.get(member.contract_line_id));
        const priced =
          member.custom_rate != null ||
          serviceLineRates.get(`${member.contract_line_id}:${member.service_id}`) != null ||
          (currency != null && (pricesByService.get(member.service_id)?.has(currency) ?? false)) ||
          catalog.default_rate != null;
        if (priced) fixable.add(member.contract_line_id);
      }
      lineIdsToFix.push(...fixable);
    }

    let linesUpdated = 0;
    for (const ids of chunk(lineIdsToFix)) {
      // migration-lint: allow 5 - retroactive: backfill is already chunked or bounded by tenant/id lists in the surrounding loop; the lint cannot see the bound through the builder
      linesUpdated += await db.table('contract_lines')
        .whereIn('contract_line_id', ids)
        .where('custom_rate', 0)
        .update({ custom_rate: null, rate_provenance: 'inherited', updated_at: nowIso });
    }

    // ---- 2./3. product members on contract lines: placeholder base_rate = 0 / 'bundle' (-> NULL,
    //      'unit') and rate-less 'bundle' (-> 'unit') ----
    const zeroConfigIds = await productMemberConfigIds(db, (q) => q.where('base_rate', 0));
    const nullConfigIds = await productMemberConfigIds(db, (q) => q.whereNull('base_rate'));

    const clearBasis = (await knex.schema.hasColumn('contract_line_service_fixed_config', 'base_rate_basis'))
      ? { base_rate_basis: null }
      : {};

    let configsUpdated = 0;
    let basisOnlyUpdated = 0;
    for (const ids of chunk(zeroConfigIds)) {
      // migration-lint: allow 5 - retroactive: backfill is already chunked or bounded by tenant/id lists in the surrounding loop; the lint cannot see the bound through the builder
      configsUpdated += await db.table('contract_line_service_fixed_config')
        .whereIn('config_id', ids)
        .where('base_rate', 0)
        .where('pricing_basis', 'bundle')
        .update({ base_rate: null, ...clearBasis, rate_provenance: 'inherited', pricing_basis: 'unit', updated_at: nowIso });
    }
    for (const ids of chunk(nullConfigIds)) {
      // migration-lint: allow 5 - retroactive: backfill is already chunked or bounded by tenant/id lists in the surrounding loop; the lint cannot see the bound through the builder
      basisOnlyUpdated += await db.table('contract_line_service_fixed_config')
        .whereIn('config_id', ids)
        .whereNull('base_rate')
        .where('pricing_basis', 'bundle')
        .update({ pricing_basis: 'unit', updated_at: nowIso });
    }

    if (linesUpdated > 0 || configsUpdated > 0 || basisOnlyUpdated > 0) {
      console.log(
        `[products placeholder-zero backfill] tenant ${tenant}: contract_lines.custom_rate 0 -> NULL: ${linesUpdated}; `
        + `contract_line_service_fixed_config.base_rate 0 -> NULL (+ pricing_basis unit): ${configsUpdated}; `
        + `contract_line_service_fixed_config.pricing_basis bundle -> unit (rate already NULL): ${basisOnlyUpdated}`,
      );
    }
    totalLines += linesUpdated;
    totalConfigs += configsUpdated;
    totalBasisOnly += basisOnlyUpdated;
  }

  console.log(
    `[products placeholder-zero backfill] total: contract_lines rewritten: ${totalLines}; `
    + `contract_line_service_fixed_config rewritten (base_rate 0 -> NULL, pricing_basis -> unit): ${totalConfigs}; `
    + `contract_line_service_fixed_config pricing_basis bundle -> unit only: ${totalBasisOnly}`,
  );
};

exports.down = async function down() {
  // Intentionally a no-op: the zeros were placeholders, not data worth restoring.
};
