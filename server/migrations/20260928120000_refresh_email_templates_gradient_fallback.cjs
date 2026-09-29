/**
 * Re-upsert every system email template with the flat header fallback.
 *
 * The shared layout painted its header with `background: linear-gradient(...)`
 * alone. Every Outlook (classic Windows, new Windows/Mac, Outlook.com) drops
 * that declaration and paints nothing, so the header rendered as the white
 * card and its white text was invisible. The layout now also carries
 * `bgcolor` and `background-color` set to the brand primary, which those
 * clients honor; browsers, Gmail and Apple Mail still paint the gradient.
 *
 * Tenant rows are not rewritten here: the send-time pass in
 * packages/email/src/branding/gradientFallback.ts repairs them on their next
 * send, and the branding classifier ignores the fallback when comparing a
 * tenant row to its system template, so previously branded rows stay branded.
 *
 * Sources are discovered by walking the template directory, as in
 * 20260805120000_refresh_localized_notification_templates.cjs.
 */

const fs = require('fs');
const path = require('path');

const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');

const EMAIL_ROOT = path.join(__dirname, 'utils', 'templates', 'email');

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
};

exports.down = async function down() {
  // Content-only refresh of existing rows; there is no previous content to
  // restore from source. Rolling back the deploy re-runs the prior upserts.
};
