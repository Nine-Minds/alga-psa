exports.up = async function (knex) {
  await knex.schema.alterTable('co_managed_provisioning_operations', table => {
    table.timestamp('invitation_sent_at', { useTz: true }).nullable();
    table.text('invitation_delivery_error').nullable();
  });
};
exports.down = async function (knex) {
  await knex.schema.alterTable('co_managed_provisioning_operations', table => {
    table.dropColumn('invitation_delivery_error');
    table.dropColumn('invitation_sent_at');
  });
};
