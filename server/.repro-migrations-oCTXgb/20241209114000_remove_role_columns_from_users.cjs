exports.up = async function(knex) {
    // Remove the 'role' column from users table
    await knex.schema.alterTable('users', (table) => {
        table.dropColumn('role');
    });

    // Remove the 'roles' jsonb column from users table
    await knex.schema.alterTable('users', (table) => {
        table.dropColumn('roles');
    });

    // Drop the user_has_role function since it's no longer needed
    await knex.raw('DROP FUNCTION IF EXISTS user_has_role(JSONB, TEXT)');
};

exports.down = async function(knex) {
    // Add back the columns if we need to rollback
    await knex.schema.alterTable('users', (table) => {
        table.text('role');
        table.jsonb('roles').defaultTo('[]');
    });

    // Recreate the user_has_role function
    await knex.raw(`
        CREATE OR REPLACE FUNCTION user_has_role(user_roles JSONB, role_name TEXT)
        RETURNS BOOLEAN AS $$
        BEGIN
            RETURN EXISTS (SELECT 1 FROM jsonb_array_elements(user_roles) AS role WHERE role->>'role_name' = role_name);
        END;
        $$ LANGUAGE plpgsql;
    `);
};