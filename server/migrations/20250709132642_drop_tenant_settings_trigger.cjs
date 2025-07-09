/**
 * Drop the tenant_settings updated_at trigger since the backend already handles
 * updating the updated_at column explicitly in all update operations.
 * This follows the pattern established in other migrations of moving trigger
 * logic to application code for better control and Citus compatibility.
 */
exports.up = async function(knex) {
  // Drop the trigger on tenant_settings table
  await knex.raw('DROP TRIGGER IF EXISTS update_tenant_settings_updated_at ON tenant_settings');
};

exports.down = async function(knex) {
  // Recreate the trigger if rolling back
  await knex.raw(`
    CREATE TRIGGER update_tenant_settings_updated_at
    BEFORE UPDATE ON tenant_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);
};