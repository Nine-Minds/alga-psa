// CE version: AI views migration - skipped for Community Edition
exports.up = async function(knex) {
    // This migration creates AI-related database views
    // In the Community Edition, we skip AI functionality
    console.log('Skipping AI views creation for Community Edition');
};

exports.down = async function(knex) {
    // Nothing to do in CE version
    console.log('Skipping AI views removal for Community Edition');
};