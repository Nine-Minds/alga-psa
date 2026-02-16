/**
 * Seed 86 — formerly contained styled email template translations for
 * fr, es, de, nl, it (12 000+ lines). All multi-language templates are now
 * upserted by seed 68 from source-of-truth files under
 * server/migrations/utils/templates/email/. This seed is kept as a no-op
 * for ordering compatibility.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.seed = async function () {
  // All email template translations are now handled by seed 68.
};
