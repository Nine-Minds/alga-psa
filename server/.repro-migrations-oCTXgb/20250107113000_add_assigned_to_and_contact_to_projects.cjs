exports.up = async function(knex) {
    await knex.schema.alterTable('projects', (table) => {
        table.uuid('assigned_to').nullable();
        table.uuid('contact_name_id').nullable();
        
        table.foreign(['tenant', 'assigned_to'])
            .references(['tenant', 'user_id'])
            .inTable('users')
            .onDelete('SET NULL');
            
        table.foreign(['tenant', 'contact_name_id'])
            .references(['tenant', 'contact_name_id'])
            .inTable('contacts')
            .onDelete('SET NULL');
    });
};

exports.down = async function(knex) {
    await knex.schema.alterTable('projects', (table) => {
        table.dropForeign(['tenant', 'assigned_to']);
        table.dropForeign(['tenant', 'contact_name_id']);
        table.dropColumn('assigned_to');
        table.dropColumn('contact_name_id');
    });
};