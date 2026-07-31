/**
 * Normalize clients.client_type to the supported enum ('company' | 'individual').
 *
 * The public API previously accepted client_type as a free-form string, so clients
 * could be created with arbitrary types (e.g. "Customer"). Those records are then
 * hidden everywhere the UI filters by client_type === 'company' (client picker,
 * integration mappings, ticket/contact flows). The API now validates client_type
 * against the enum; this backfills existing off-enum rows so they become visible
 * again. Case-variant "individual" is preserved; everything else non-null collapses
 * to 'company'. NULL is left untouched (a valid "unset" state). Idempotent.
 */
exports.up = async function (knex) {
  console.log('Starting migration: normalize_client_type_to_enum');

  // Preserve intent for case-variant "individual" (e.g. "Individual").
  const keptIndividual = await knex('clients')
    .whereNotNull('client_type')
    .whereNotIn('client_type', ['company', 'individual'])
    .whereRaw("lower(client_type) = 'individual'")
    .update({ client_type: 'individual' });

  // Collapse all remaining off-enum values to 'company'.
  const resetToCompany = await knex('clients')
    .whereNotNull('client_type')
    .whereNotIn('client_type', ['company', 'individual'])
    .update({ client_type: 'company' });

  console.log(
    `Normalized client_type: ${keptIndividual} -> 'individual', ${resetToCompany} -> 'company'`
  );
  console.log('Migration completed successfully');
};

exports.down = async function () {
  // Not reversible: original custom client_type values are not recoverable.
  console.log('Rollback skipped: client_type normalization is not reversible');
};
