// CE version: Tickets by concept migration - skipped for Community Edition
exports.up = async function(knex) {
    // This migration creates AI tickets-by-concept functionality
    // In the Community Edition, we skip AI functionality
    console.log('Skipping tickets by concept creation for Community Edition');
};

exports.down = async function(knex) {
    // Nothing to do in CE version
    console.log('Skipping tickets by concept removal for Community Edition');
};