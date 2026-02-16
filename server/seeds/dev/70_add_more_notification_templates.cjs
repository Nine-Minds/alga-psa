/**
 * Seed 70 — formerly added ticket-assigned, ticket-comment-added, and project
 * email templates. All templates are now upserted by seed 68 from source-of-truth
 * files. This seed is kept as a no-op for ordering compatibility.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.seed = async function () {
  // All email templates are now handled by seed 68.
};
