exports.up = function(knex) {
  return knex.schema.table('statuses', function(table) {
    // Step 1: Copy values from status_type to item_type
    return knex.raw('UPDATE statuses SET item_type = status_type WHERE item_type IS NULL')
      .then(() => {
        // Step 2: Remove the status_type column
        return table.dropColumn('status_type');
      });
  });
};

exports.down = function(knex) {
  return knex.schema.table('statuses', function(table) {
    // Add back the status_type column
    table.string('status_type');
    
    // Copy values from item_type to status_type
    return knex.raw('UPDATE statuses SET status_type = item_type')
      .then(() => {
        // Make status_type not nullable if it was originally not nullable
        return table.string('status_type').notNullable().alter();
      });
  });
};
