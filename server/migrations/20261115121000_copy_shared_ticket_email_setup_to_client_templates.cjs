'use strict';

/**
 * One-time copy for the ticket-comment-added / ticket-closed split (2026-11-15).
 *
 * Until now one template and one subtype served both MSP staff and clients, so a tenant's own
 * `ticket-closed` template, a switched-off 'Ticket Closed' subtype or a user's opt-out applied
 * to clients too. 20261115120000 added the client templates and subtypes; this migration copies
 * what each tenant has set up to the client names, so clients keep receiving exactly what they
 * received before. From here on the internal and the client email are separate: editing one
 * never changes the other.
 *
 * What is copied, and only where the client row does not exist yet (nothing is overwritten):
 *   - tenant_email_templates: every row of the two shared templates, with its subject, HTML,
 *     text and language unchanged, under the client template name.
 *   - tenant_notification_subtype_settings: rows that differ from the default (switched off).
 *     A tenant with no row is on, so the others need none.
 *   - user_notification_preferences: opt-outs.
 *
 * Each write names one tenant, so it is a single-shard statement where a table is distributed,
 * and rows are read a page at a time. The migration runs in one transaction and checks its own
 * result before it commits: every shared template row must have a client row, and every row it
 * wrote must be byte-identical to its source.
 *
 * Safe to re-run: a second run finds every client row in place and writes nothing.
 */

const { randomUUID } = require('node:crypto');
const {
  planTemplateCopies,
  planSubtypeSettingCopies,
  planPreferenceCopies,
  groupByTenant,
} = require('./utils/templates/_shared/copySharedTemplateSetup.cjs');

const TEMPLATE_PAIRS = [
  { from: 'ticket-comment-added', to: 'ticket-comment-added-client' },
  { from: 'ticket-closed', to: 'ticket-closed-client' },
];
const SUBTYPE_PAIRS = [
  { from: 'Ticket Comment Added', to: 'Ticket Comment Added Client' },
  { from: 'Ticket Closed', to: 'Ticket Closed Client' },
];

const PAGE = 200;
const NO_TENANT = '00000000-0000-0000-0000-000000000000';
const FROM_TEMPLATES = TEMPLATE_PAIRS.map((pair) => pair.from);
const TO_TEMPLATES = TEMPLATE_PAIRS.map((pair) => pair.to);

const templateKey = (row) => [row.tenant, row.name, row.language_code ?? ''].join('\u0000');
const tenantsOf = (rows) => [...new Set(rows.map((row) => row.tenant))];

/** What a row says, as one value: used to prove a copy is identical to its source. */
const CONTENT_DIGEST =
  "md5(coalesce(subject, '') || chr(1) || coalesce(html_content, '') || chr(1) || coalesce(text_content, ''))";

async function subtypeIdPairs(knex) {
  const rows = await knex('notification_subtypes')
    .whereIn('name', SUBTYPE_PAIRS.flatMap((pair) => [pair.from, pair.to]))
    .select('id', 'name');
  const idOf = new Map(rows.map((row) => [row.name, row.id]));
  return SUBTYPE_PAIRS.map((pair) => {
    const fromId = idOf.get(pair.from);
    const toId = idOf.get(pair.to);
    // A missing shared subtype has nothing to copy; a missing client one means 20261115120000 did not run.
    if (fromId !== undefined && toId === undefined) {
      throw new Error(`Notification subtype '${pair.to}' not found; run 20261115120000 first`);
    }
    return { fromId, toId };
  }).filter((pair) => pair.fromId !== undefined);
}

async function copyTemplates(knex) {
  const systemRows = await knex('system_email_templates')
    .whereIn('name', TO_TEMPLATES)
    .select('id', 'name', 'language_code');

  const written = new Set();
  let kept = 0;
  let cursor = { id: 0, tenant: NO_TENANT };
  for (;;) {
    const sourceRows = await knex('tenant_email_templates')
      .whereIn('name', FROM_TEMPLATES)
      .whereRaw('(id, tenant) > (?, ?::uuid)', [cursor.id, cursor.tenant])
      .orderBy(['id', 'tenant'])
      .limit(PAGE)
      .select('id', 'tenant', 'name', 'language_code', 'subject', 'html_content', 'text_content');
    if (sourceRows.length === 0) break;
    cursor = sourceRows[sourceRows.length - 1];

    const existingRows = await knex('tenant_email_templates')
      .whereIn('tenant', tenantsOf(sourceRows))
      .whereIn('name', TO_TEMPLATES)
      .select('tenant', 'name', 'language_code');

    const plan = planTemplateCopies({ pairs: TEMPLATE_PAIRS, sourceRows, existingRows, systemRows });
    for (const rows of groupByTenant(plan.inserts).values()) {
      await knex('tenant_email_templates')
        .insert(rows)
        .onConflict(['tenant', 'name', 'language_code'])
        .ignore();
    }
    for (const row of plan.inserts) written.add(templateKey(row));
    kept += plan.skipped.length;
  }
  return { written, kept };
}

/**
 * Proves the template copy before the transaction commits: no shared row is left without a
 * client row, and no row this run wrote differs from its source.
 */
async function verifyTemplates(knex, written) {
  const rows = await knex('tenant_email_templates')
    .whereIn('name', [...FROM_TEMPLATES, ...TO_TEMPLATES])
    .select('tenant', 'name', 'language_code', knex.raw(`${CONTENT_DIGEST} AS digest`));
  const digestOf = new Map(rows.map((row) => [templateKey(row), row.digest]));
  const clientNameOf = new Map(TEMPLATE_PAIRS.map((pair) => [pair.from, pair.to]));

  let missing = 0;
  let different = 0;
  for (const row of rows) {
    const name = clientNameOf.get(row.name);
    if (!name) continue;
    const key = templateKey({ ...row, name });
    if (!digestOf.has(key)) missing += 1;
    else if (written.has(key) && digestOf.get(key) !== row.digest) different += 1;
  }
  if (missing > 0 || different > 0) {
    throw new Error(
      `Template copy check failed: ${missing} shared row(s) without a client row, ${different} copied row(s) differ from their source`
    );
  }
}

async function copySubtypeSettings(knex, pairs) {
  const fromIds = pairs.map((pair) => pair.fromId);
  const toIds = pairs.map((pair) => pair.toId);
  let copied = 0;
  let cursor = { tenant: NO_TENANT, subtype_id: 0 };
  for (;;) {
    const sourceRows = await knex('tenant_notification_subtype_settings')
      .whereIn('subtype_id', fromIds)
      .where((query) => query.where('is_enabled', false).orWhere('is_default_enabled', false))
      .whereRaw('(tenant, subtype_id) > (?::uuid, ?)', [cursor.tenant, cursor.subtype_id])
      .orderBy(['tenant', 'subtype_id'])
      .limit(PAGE)
      .select('tenant', 'subtype_id', 'is_enabled', 'is_default_enabled');
    if (sourceRows.length === 0) break;
    cursor = sourceRows[sourceRows.length - 1];

    const existingRows = await knex('tenant_notification_subtype_settings')
      .whereIn('tenant', tenantsOf(sourceRows))
      .whereIn('subtype_id', toIds)
      .select('tenant', 'subtype_id');

    const plan = planSubtypeSettingCopies({ pairs, sourceRows, existingRows });
    for (const row of plan.inserts) {
      await knex('tenant_notification_subtype_settings')
        .insert({ ...row, tenant_notification_subtype_setting_id: randomUUID() })
        .onConflict(['tenant', 'subtype_id'])
        .ignore();
    }
    copied += plan.inserts.length;
  }
  return copied;
}

async function copyPreferences(knex, pairs) {
  const fromIds = pairs.map((pair) => pair.fromId);
  const toIds = pairs.map((pair) => pair.toId);
  let copied = 0;
  let cursor = { id: 0, tenant: NO_TENANT };
  for (;;) {
    const sourceRows = await knex('user_notification_preferences')
      .whereIn('subtype_id', fromIds)
      .where('is_enabled', false)
      .whereRaw('(id, tenant) > (?, ?::uuid)', [cursor.id, cursor.tenant])
      .orderBy(['id', 'tenant'])
      .limit(PAGE)
      .select('id', 'tenant', 'user_id', 'subtype_id', 'is_enabled', 'email_address', 'frequency');
    if (sourceRows.length === 0) break;
    cursor = sourceRows[sourceRows.length - 1];

    const existingRows = await knex('user_notification_preferences')
      .whereIn('tenant', tenantsOf(sourceRows))
      .whereIn('subtype_id', toIds)
      .select('tenant', 'user_id', 'subtype_id');

    const plan = planPreferenceCopies({ pairs, sourceRows, existingRows });
    for (const rows of groupByTenant(plan.inserts).values()) {
      await knex('user_notification_preferences')
        .insert(rows)
        .onConflict(['tenant', 'user_id', 'subtype_id'])
        .ignore();
    }
    copied += plan.inserts.length;
  }
  return copied;
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const templates = await copyTemplates(knex);
  await verifyTemplates(knex, templates.written);

  const pairs = await subtypeIdPairs(knex);
  const settings = await copySubtypeSettings(knex, pairs);
  const preferences = await copyPreferences(knex, pairs);

  // Counts only: never tenant ids or template content.
  console.log(
    `  ✓ client ticket email setup: ${templates.written.size} template row(s) copied, ` +
      `${templates.kept} already present, ${settings} tenant setting(s), ${preferences} user opt-out(s)`
  );
};

/**
 * Removes only what is still an untouched copy: a client template row that is byte-identical to
 * the tenant's shared row. A row a tenant has edited since is theirs and stays. Tenant settings
 * and user preferences of the client subtypes go, because 20261115120000's down removes the
 * subtypes they belong to.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  const clientNameOf = new Map(TEMPLATE_PAIRS.map((pair) => [pair.from, pair.to]));
  let cursor = { id: 0, tenant: NO_TENANT };
  for (;;) {
    const sharedRows = await knex('tenant_email_templates')
      .whereIn('name', FROM_TEMPLATES)
      .whereRaw('(id, tenant) > (?, ?::uuid)', [cursor.id, cursor.tenant])
      .orderBy(['id', 'tenant'])
      .limit(PAGE)
      .select('id', 'tenant', 'name', 'language_code', knex.raw(`${CONTENT_DIGEST} AS digest`));
    if (sharedRows.length === 0) break;
    cursor = sharedRows[sharedRows.length - 1];

    const clientRows = await knex('tenant_email_templates')
      .whereIn('tenant', tenantsOf(sharedRows))
      .whereIn('name', TO_TEMPLATES)
      .select('tenant', 'name', 'language_code', knex.raw(`${CONTENT_DIGEST} AS digest`));
    const clientDigest = new Map(clientRows.map((row) => [templateKey(row), row.digest]));

    for (const shared of sharedRows) {
      const client = { tenant: shared.tenant, name: clientNameOf.get(shared.name), language_code: shared.language_code };
      if (clientDigest.get(templateKey(client)) !== shared.digest) continue;
      await knex('tenant_email_templates').where(client).del();
    }
  }

  const toIds = (await subtypeIdPairs(knex)).map((pair) => pair.toId);
  for (const table of ['tenant_notification_subtype_settings', 'user_notification_preferences']) {
    for (;;) {
      const rows = await knex(table).whereIn('subtype_id', toIds).limit(PAGE).select('tenant', 'subtype_id');
      if (rows.length === 0) break;
      for (const [tenant, tenantRows] of groupByTenant(rows)) {
        await knex(table)
          .where({ tenant })
          .whereIn('subtype_id', [...new Set(tenantRows.map((row) => row.subtype_id))])
          .del();
      }
    }
  }
};
