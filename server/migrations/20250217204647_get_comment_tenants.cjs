exports.up = async function(knex) {
  // This migration doesn't make any changes, it just provides a reusable function
  // for getting tenants that will be used by subsequent migrations
};

exports.down = async function(knex) {
  // No changes to revert
};

// Export a helper function that can be used by other migrations
exports.getCommentTenants = async function(trx) {
  return await trx('comments')
    .distinct('tenant')
    .pluck('tenant');
};