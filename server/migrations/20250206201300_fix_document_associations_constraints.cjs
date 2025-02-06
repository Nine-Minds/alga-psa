exports.up = function(knex) {
  return knex.schema.alterTable('document_associations', function(table) {
    // Drop existing foreign keys
    table.dropForeign('document_id');
    table.dropForeign('entity_id');
    
    // Recreate foreign keys with tenant
    table.foreign(['document_id', 'tenant'])
      .references(['document_id', 'tenant'])
      .inTable('documents');
      
    table.foreign(['entity_id', 'tenant'])
      .references(['entity_id', 'tenant'])
      .inTable('entities');
      
    // Add composite primary key
    table.primary(['document_id', 'entity_id', 'tenant']);
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('document_associations', function(table) {
    // Drop composite primary key
    table.dropPrimary();
    
    // Drop foreign keys
    table.dropForeign(['document_id', 'tenant']);
    table.dropForeign(['entity_id', 'tenant']);
    
    // Recreate original foreign keys
    table.foreign('document_id')
      .references('document_id')
      .inTable('documents');
      
    table.foreign('entity_id')
      .references('entity_id')
      .inTable('entities');
  });
};
