// CE version: Extension tables migration - skipped for Community Edition
exports.up = async function(knex) {
    // This migration creates extension tables
    // In the Community Edition, we skip extension functionality
    console.log('Skipping extension tables creation for Community Edition');
};

exports.down = async function(knex) {
    // Nothing to do in CE version
    console.log('Skipping extension tables removal for Community Edition');
};