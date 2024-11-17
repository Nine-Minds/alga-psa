/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // First, perform the schema changes
    await knex.schema.alterTable('users', (table) => {
        // Add contact_id column without the foreign key constraint initially
        table.uuid('contact_id');
        
        table.boolean('needs_contact_association')
            .defaultTo(false);

        // Create an index on contact_id
        table.index('contact_id');

        // Add the foreign key constraint referencing both tenant and contact_name_id
        table.foreign(['tenant', 'contact_id'])
            .references(['tenant', 'contact_name_id'])
            .inTable('contacts')
            .onDelete('SET NULL');
    });

    // Then, attempt to match existing client users with contacts
    const clientUsers = await knex('users')
        .where({ user_type: 'client' })
        .whereNull('contact_id')
        .select('*');

    // Process each client user
    for (const user of clientUsers) {
        // Look for a contact with matching email
        const contact = await knex('contacts')
            .where({ 
                email: user.email,
                tenant: user.tenant 
            })
            .first();

        if (contact) {
            // Update user with matching contact_id (which references contact_name_id)
            await knex('users')
                .where({ user_id: user.user_id })
                .update({ 
                    contact_id: contact.contact_name_id,  // Use contact_name_id here
                    needs_contact_association: false,
                    updated_at: new Date()
                });

            console.log(`Associated user ${user.email} with contact ${contact.contact_name_id}`);
        } else {
            // Mark user as needing contact association
            await knex('users')
                .where({ user_id: user.user_id })
                .update({ 
                    needs_contact_association: true,
                    updated_at: new Date()
                });

            console.log(`Could not find contact for user ${user.email}`);
        }
    }

    // Log summary
    const unassociatedCount = await knex('users')
        .where({ 
            user_type: 'client',
            needs_contact_association: true 
        })
        .count('* as count')
        .first();

    console.log(`Migration complete. ${unassociatedCount.count} users still need contact association.`);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
    return knex.schema.alterTable('users', (table) => {
        table.dropIndex('contact_id');
        table.dropColumn('needs_contact_association');
        table.dropColumn('contact_id');
    });
};