/**
 * Refresh localized notification templates from source-of-truth files.
 *
 * The 2026-08 localization sweep touched the non-English variants of these
 * templates: raw-HTML placeholders that had drifted to the escaping form
 * ({{ticket.description}} -> {{{ticket.description}}}), the missing
 * {{commentPreview}} in the internal ticket-comment message, register and
 * terminology corrections (nl je->u and e-mail spelling, it board->bacheca and
 * milestone->traguardo, fr assignation->attribution, es usted), Handlebars
 * block structure realigned with the English variants, and the product name
 * respelled AlgaPSA (one word) — which reaches every template through the
 * shared email layout's "Powered by" footer.
 *
 * Sources are DISCOVERED by walking the template directories rather than
 * listed by hand: the brand fix touched all of them, and an explicit list
 * silently omitted 27 of 49 email templates when it was maintained manually.
 * Re-upserting delivers the corrected content to existing installations.
 */

const fs = require('fs');
const path = require('path');

const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
const { upsertInternalTemplates } = require('./utils/templates/_shared/upsertInternalTemplates.cjs');

const EMAIL_ROOT = path.join(__dirname, 'utils', 'templates', 'email');
const INTERNAL_ROOT = path.join(__dirname, 'utils', 'templates', 'internal');

function walkCjs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkCjs(full);
    return entry.isFile() && entry.name.endsWith('.cjs') ? [full] : [];
  }).sort();
}

exports.up = async function up(knex) {
  for (const file of walkCjs(EMAIL_ROOT)) {
    const mod = require(file);
    if (typeof mod.getTemplate !== 'function') continue;
    // skipMissingSubtype: appliance tenants may lack optional feature subtypes;
    // a content refresh must never abort their migration chain.
    await upsertEmailTemplate(knex, mod.getTemplate(), { skipMissingSubtype: true });
  }

  for (const file of walkCjs(INTERNAL_ROOT)) {
    const mod = require(file);
    if (!Array.isArray(mod.TEMPLATES)) continue;   // e.g. categoriesAndSubtypes.cjs
    await upsertInternalTemplates(knex, mod.TEMPLATES, { skipMissingSubtype: true });
  }
};

exports.down = async function down() {
  // Content-only refresh of existing rows; there is no previous content to
  // restore from source. Rolling back the deploy re-runs the prior upserts.
};
