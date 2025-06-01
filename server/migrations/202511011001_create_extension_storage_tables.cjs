// CE version: Extension storage tables migration - skipped for Community Edition
exports.up = async function(knex) {
    // This migration creates extension storage tables
    // In the Community Edition, we skip extension functionality
    console.log('Skipping extension storage tables creation for Community Edition');
};

exports.down = async function(knex) {
    // Nothing to do in CE version
    console.log('Skipping extension storage tables removal for Community Edition');
};