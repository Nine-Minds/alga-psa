const { getFirstTenantSeedContext, getTenantDb } = require('./_tenant.cjs');

// A tenant that cloned the grouped quote layout before alga-2026-0002383 keeps
// a frozen copy of the pre-cadence AST. The same fixture backs the unit tests
// for that case, so the seeded copy and the tests describe one reality.
//
// Every image that runs these seeds (setup/Dockerfile*, Dockerfile.build,
// ee/setup/Dockerfile.dev) copies server/seeds without a packages/ tree, so a
// top-level require here aborts the whole seed run on a fresh install. Resolve
// it lazily and seed the clone only where the fixture exists — a checkout.
const loadLegacyGroupedQuoteAst = () => {
  try {
    return require('../../../packages/billing/src/lib/quote-template-ast/__fixtures__/legacy-grouped-quote-ast.json');
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') throw error;
    return null;
  }
};

/**
 * Quote fixtures for the grouped-layout section titles (alga-2026-0002573).
 *
 * The feature only shows itself on a quote whose grouped layout renders more
 * than one cadence band, so the ids below are fixed: review links point at
 * them, and reseeding must land on the same rows instead of minting new ones.
 *
 *   Q-0001  draft, editable  — monthly + annual + one-time items, so the
 *                              monthly and one-time bands can be renamed and
 *                              the annual band visibly keeps its own name.
 *   Q-0002  sent, read-only  — the same shape with the title fields disabled.
 *
 * Both start with no custom titles (the fields are meant to be typed in), and
 * both are pinned to the shared "Grouped Quote Template (Standard)". The
 * tenant-owned "Copy of Grouped Quote Template" is seeded alongside them as
 * the deliberate back-compat gap: a pre-cadence clone has fixed headings and
 * ignores custom titles.
 *
 * Non-destructive: upserts its own rows and leaves every other quote alone.
 */
const QUOTE_DRAFT_ID = 'b4ffea3e-9457-48c0-839d-2c9e807ed562';
const QUOTE_SENT_ID = '8f2d8bf0-24a0-42a7-89d6-3dc9f6c1f872';
const TENANT_TEMPLATE_COPY_ID = 'd403ff84-cb9a-4de8-a817-3ec94159d4aa';
// The prefix the fixture numbers below are written with.
const FIXTURE_NUMBER_PREFIX = 'Q-';

// Amounts are in minor units, matching the quote tables.
const ITEMS = [
  {
    suffix: '000000000001',
    description: 'Managed Support — Emerald City',
    service_name: 'Managed Support',
    unit_price: 100000,
    tax_amount: 8000,
    is_recurring: true,
    billing_frequency: 'monthly',
  },
  {
    suffix: '000000000002',
    description: 'Annual Firewall Subscription',
    service_name: 'Firewall Subscription',
    unit_price: 159000,
    tax_amount: 12720,
    is_recurring: true,
    billing_frequency: 'annually',
  },
  {
    suffix: '000000000003',
    description: 'Onboarding & Kickoff',
    service_name: 'Onboarding',
    unit_price: 250000,
    tax_amount: 20000,
    is_recurring: false,
    billing_frequency: null,
  },
];

const buildItems = (tenantId, quoteId, itemIdPrefix, userId, now) =>
  ITEMS.map((item, index) => ({
    tenant: tenantId,
    quote_item_id: `${itemIdPrefix}-${item.suffix}`,
    quote_id: quoteId,
    service_item_kind: 'service',
    service_name: item.service_name,
    description: item.description,
    quantity: 1,
    unit_price: item.unit_price,
    total_price: item.unit_price,
    tax_amount: item.tax_amount,
    net_amount: item.unit_price,
    display_order: index + 1,
    is_optional: false,
    is_selected: false,
    is_recurring: item.is_recurring,
    billing_frequency: item.billing_frequency,
    is_discount: false,
    is_taxable: true,
    created_by: userId,
    updated_by: userId,
    created_at: now,
    updated_at: now,
  }));

const totals = () => {
  const subtotal = ITEMS.reduce((sum, item) => sum + item.unit_price, 0);
  const tax = ITEMS.reduce((sum, item) => sum + item.tax_amount, 0);
  return { subtotal, tax, total_amount: subtotal + tax };
};

/**
 * The seeded dev tenant, identified by its admin (`glinda`) the way the KB
 * article seed does. A long-lived dev database accumulates test tenants, and
 * "first tenant" is unordered there — the review links belong to the tenant
 * you actually sign into. Falls back to the first tenant on a fresh database.
 */
const resolveSeedTenant = async (knex) => {
  const admin = await knex('users').where({ username: 'glinda' }).select('tenant').first();
  if (admin?.tenant) return { tenantId: admin.tenant, db: getTenantDb(knex, admin.tenant) };
  return getFirstTenantSeedContext(knex);
};

exports.seed = async function seed(knex) {
  // Seeds run against partially-migrated schemas in some test harnesses; a
  // throw here would abort the whole directory run.
  const tables = ['quotes', 'quote_items', 'quote_document_templates', 'standard_quote_document_templates'];
  for (const table of tables) {
    if (!(await knex.schema.hasTable(table))) return;
  }

  const context = await resolveSeedTenant(knex);
  if (!context) return;

  const { db, tenantId } = context;

  const client = (await db.table('clients').where({ client_name: 'Emerald City' }).select('client_id').first())
    ?? (await db.table('clients').select('client_id').first());
  if (!client) return;

  const user = await db.table('users').where({ username: 'glinda' }).select('user_id').first();
  const userId = user?.user_id ?? null;

  const groupedStandard = await knex('standard_quote_document_templates')
    .where({ standard_quote_document_template_code: 'standard-quote-grouped' })
    .select('template_id')
    .first();

  const now = new Date();
  const quoteDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const validUntil = new Date(quoteDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  const money = totals();

  // The tenant's own pre-cadence clone of the grouped layout.
  const legacyGroupedQuoteAst = loadLegacyGroupedQuoteAst();
  if (legacyGroupedQuoteAst) {
    await db.table('quote_document_templates')
      .insert({
        tenant: tenantId,
        template_id: TENANT_TEMPLATE_COPY_ID,
        name: 'Copy of Grouped Quote Template',
        version: legacyGroupedQuoteAst.version,
        templateAst: JSON.stringify(legacyGroupedQuoteAst),
        is_default: false,
        created_at: now,
        updated_at: now,
      })
      .onConflict(['tenant', 'template_id'])
      .merge({
        name: 'Copy of Grouped Quote Template',
        templateAst: JSON.stringify(legacyGroupedQuoteAst),
        updated_at: now,
      });
  }

  const quotes = [
    {
      quote_id: QUOTE_DRAFT_ID,
      quote_number: 'Q-0001',
      status: 'draft',
      title: 'Emerald City managed services',
      description: 'Monitoring, support and onboarding for the Emerald City estate.',
      sent_at: null,
      itemIdPrefix: 'b4ffea3e-9457-48c0-839d',
    },
    {
      quote_id: QUOTE_SENT_ID,
      quote_number: 'Q-0002',
      status: 'sent',
      title: 'Emerald City managed services (issued)',
      description: 'Issued copy — read-only, used to check the section title fields stay disabled.',
      sent_at: now,
      itemIdPrefix: '8f2d8bf0-24a0-42a7-89d6',
    },
  ];

  for (const quote of quotes) {
    await db.table('quotes')
      .insert({
        tenant: tenantId,
        quote_id: quote.quote_id,
        quote_number: quote.quote_number,
        client_id: client.client_id,
        title: quote.title,
        description: quote.description,
        quote_date: quoteDate,
        valid_until: validUntil,
        status: quote.status,
        version: 1,
        subtotal: money.subtotal,
        discount_total: 0,
        tax: money.tax,
        total_amount: money.total_amount,
        currency_code: 'USD',
        is_template: false,
        template_id: groupedStandard?.template_id ?? null,
        recurring_section_title: null,
        onetime_section_title: null,
        sent_at: quote.sent_at,
        created_by: userId,
        updated_by: userId,
        created_at: now,
        updated_at: now,
      })
      .onConflict(['tenant', 'quote_id'])
      .merge({
        quote_number: quote.quote_number,
        client_id: client.client_id,
        title: quote.title,
        description: quote.description,
        quote_date: quoteDate,
        valid_until: validUntil,
        status: quote.status,
        subtotal: money.subtotal,
        discount_total: 0,
        tax: money.tax,
        total_amount: money.total_amount,
        template_id: groupedStandard?.template_id ?? null,
        sent_at: quote.sent_at,
        updated_at: now,
      });

    await db.table('quote_items').where({ quote_id: quote.quote_id }).del();
    await db.table('quote_items').insert(buildItems(tenantId, quote.quote_id, quote.itemIdPrefix, userId, now));
  }

  // Walk the counter past the seeded numbers, but only where it would actually
  // mint one of them: (tenant, quote_number) is unique, so a tenant still on
  // the migration default prefix ('Q-') would fail the user's next Create /
  // Duplicate on Q-0001. 13_next_number.cjs gives this tenant 'QUO-', which
  // cannot collide, and there the counter is left untouched — the quote
  // numbering tests read it as the tenant's first-ever quote number. Never
  // walk it backwards: an environment already at Q-0012 keeps its place.
  const counter = await db.table('next_number')
    .where({ entity_type: 'QUOTE' })
    .select('prefix', 'last_number')
    .first();

  if (!counter) {
    await db.table('next_number').insert({
      tenant: tenantId,
      entity_type: 'QUOTE',
      prefix: FIXTURE_NUMBER_PREFIX,
      initial_value: 1,
      last_number: quotes.length,
      padding_length: 4,
    });
  } else if (counter.prefix === FIXTURE_NUMBER_PREFIX && Number(counter.last_number) < quotes.length) {
    await db.table('next_number').where({ entity_type: 'QUOTE' }).update({ last_number: quotes.length });
  }
};
