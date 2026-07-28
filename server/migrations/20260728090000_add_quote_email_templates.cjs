/**
 * Superseded by 20260728120000_add_estimate_email_templates.cjs.
 *
 * This migration originally seeded a "Quotes" notification category with
 * quote-email / quote-reminder-email templates. The client-facing wording was
 * changed to "Estimate" before the templates shipped, so the estimate
 * migration now seeds them (and renames any quote rows left on a development
 * database). Kept as a no-op so applied migration history stays intact.
 */

exports.up = async function() {};

exports.down = async function() {};
