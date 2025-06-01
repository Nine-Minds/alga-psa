// CE version: AI schema migration - skipped for Community Edition
exports.up = async function(knex) {
    // This migration creates AI-related tables and features
    // In the Community Edition, we skip AI functionality
    console.log('Skipping AI schema creation for Community Edition');
};

exports.down = async function(knex) {
    // Nothing to do in CE version
    console.log('Skipping AI schema removal for Community Edition');
};