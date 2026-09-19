exports.up = function(knex) {
  return knex.schema.table('tags', function(table) {
    table.string('background_color').nullable();
    table.string('text_color').nullable();
    // Add index for tenant and colors for better query performance
    table.index(['tenant', 'background_color', 'text_color'], 'idx_tags_tenant_colors');
  });
};

exports.down = function(knex) {
  return knex.schema.table('tags', function(table) {
    table.dropIndex(['tenant', 'background_color', 'text_color'], 'idx_tags_tenant_colors');
    table.dropColumn('text_color');
    table.dropColumn('background_color');
  });
};