// CE version: Extension RLS policies migration - skipped for Community Edition
exports.up = async function(knex) {
    // This migration adds RLS policies for extension tables
    // In the Community Edition, we skip extension functionality
    console.log('Skipping extension RLS policies creation for Community Edition');
};

exports.down = async function(knex) {
    // Nothing to do in CE version
    console.log('Skipping extension RLS policies removal for Community Edition');
};