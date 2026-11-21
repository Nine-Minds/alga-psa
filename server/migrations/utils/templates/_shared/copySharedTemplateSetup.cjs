'use strict';

/**
 * Planning for a migration that splits a client email template off a shared one.
 *
 * Until the split, one template and one notification subtype served both MSP staff and clients,
 * so whatever a tenant set up for it (its own template rows, a switched-off subtype, a user's
 * opt-out) applied to clients too. The split copies that setup to the client names once, and the
 * two are separate emails from then on.
 *
 * Everything here is a pure function over rows: the migration does the reads and writes, and the
 * same functions can be run over exported rows to see what a migration would write.
 */

const NUL = '\u0000';
const templateKey = (tenant, name, language) => [tenant, name, language ?? ''].join(NUL);

/**
 * The tenant template rows to create.
 *
 * @param {object} input
 * @param {Array<{ from: string, to: string }>} input.pairs shared template name -> client template name
 * @param {Array<object>} input.sourceRows tenant rows of the shared templates
 * @param {Array<{ tenant: string, name: string, language_code: string|null }>} input.existingRows
 *   tenant rows that already exist under the client names
 * @param {Array<{ id: number, name: string, language_code: string|null }>} input.systemRows
 *   stock rows of the client templates
 * @returns {{ inserts: object[], skipped: Array<{ tenant: string, name: string, language_code: string|null }> }}
 *   `inserts` carry the source row's subject, HTML, text and language unchanged. A row whose
 *   client counterpart already exists is `skipped`: a tenant's own client row is never replaced.
 */
function planTemplateCopies({ pairs, sourceRows, existingRows, systemRows }) {
  const clientNameOf = new Map(pairs.map((pair) => [pair.from, pair.to]));
  const taken = new Set(existingRows.map((row) => templateKey(row.tenant, row.name, row.language_code)));
  const stockId = new Map(systemRows.map((row) => [templateKey('', row.name, row.language_code), row.id]));

  const inserts = [];
  const skipped = [];
  for (const row of sourceRows) {
    const name = clientNameOf.get(row.name);
    if (!name) continue;
    const key = templateKey(row.tenant, name, row.language_code);
    if (taken.has(key)) {
      skipped.push({ tenant: row.tenant, name, language_code: row.language_code });
      continue;
    }
    taken.add(key);
    inserts.push({
      tenant: row.tenant,
      name,
      language_code: row.language_code,
      subject: row.subject,
      html_content: row.html_content,
      text_content: row.text_content,
      // Points at the stock client template, as a row made with "Customize" would.
      system_template_id: stockId.get(templateKey('', name, row.language_code)) ?? null,
    });
  }
  return { inserts, skipped };
}

const settingKey = (tenant, subtypeId) => `${tenant}${NUL}${subtypeId}`;

/**
 * The tenant on/off settings to create. A tenant with no row is on by default, so only rows that
 * differ from the default are copied; every other tenant already behaves the same without one.
 *
 * @param {object} input
 * @param {Array<{ fromId: number, toId: number }>} input.pairs shared subtype id -> client subtype id
 * @param {Array<{ tenant: string, subtype_id: number, is_enabled: boolean, is_default_enabled: boolean }>} input.sourceRows
 * @param {Array<{ tenant: string, subtype_id: number }>} input.existingRows rows of the client subtypes
 */
function planSubtypeSettingCopies({ pairs, sourceRows, existingRows }) {
  const clientIdOf = new Map(pairs.map((pair) => [pair.fromId, pair.toId]));
  const taken = new Set(existingRows.map((row) => settingKey(row.tenant, row.subtype_id)));

  const inserts = [];
  for (const row of sourceRows) {
    const subtypeId = clientIdOf.get(row.subtype_id);
    if (subtypeId === undefined) continue;
    if (row.is_enabled !== false && row.is_default_enabled !== false) continue;
    const key = settingKey(row.tenant, subtypeId);
    if (taken.has(key)) continue;
    taken.add(key);
    inserts.push({
      tenant: row.tenant,
      subtype_id: subtypeId,
      is_enabled: row.is_enabled,
      is_default_enabled: row.is_default_enabled,
    });
  }
  return { inserts };
}

const preferenceKey = (tenant, userId, subtypeId) => [tenant, userId, subtypeId].join(NUL);

/**
 * The user preferences to create: opt-outs only. A user with no row receives the email, so a
 * row that says "enabled" changes nothing by being copied.
 *
 * @param {object} input
 * @param {Array<{ fromId: number, toId: number }>} input.pairs shared subtype id -> client subtype id
 * @param {Array<{ tenant: string, user_id: string, subtype_id: number, is_enabled: boolean, email_address: string|null, frequency: string }>} input.sourceRows
 * @param {Array<{ tenant: string, user_id: string, subtype_id: number }>} input.existingRows rows of the client subtypes
 */
function planPreferenceCopies({ pairs, sourceRows, existingRows }) {
  const clientIdOf = new Map(pairs.map((pair) => [pair.fromId, pair.toId]));
  const taken = new Set(existingRows.map((row) => preferenceKey(row.tenant, row.user_id, row.subtype_id)));

  const inserts = [];
  for (const row of sourceRows) {
    const subtypeId = clientIdOf.get(row.subtype_id);
    if (subtypeId === undefined) continue;
    if (row.is_enabled !== false) continue;
    const key = preferenceKey(row.tenant, row.user_id, subtypeId);
    if (taken.has(key)) continue;
    taken.add(key);
    inserts.push({
      tenant: row.tenant,
      user_id: row.user_id,
      subtype_id: subtypeId,
      is_enabled: false,
      email_address: row.email_address ?? null,
      frequency: row.frequency,
    });
  }
  return { inserts };
}

/** Rows grouped by tenant, so each write names one tenant (a single-shard statement on Citus). */
function groupByTenant(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.tenant)) groups.set(row.tenant, []);
    groups.get(row.tenant).push(row);
  }
  return groups;
}

module.exports = {
  planTemplateCopies,
  planSubtypeSettingCopies,
  planPreferenceCopies,
  groupByTenant,
};
