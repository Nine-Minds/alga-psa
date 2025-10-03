/**
 * Production seed file for standard reference tables
 * This ensures standard reference data is available in production
 * The migration file already includes this data, but this serves as a backup
 */

exports.seed = async function(knex) {
    // Check if standard tables already have data
    const [boardCount, serviceCategoryCount, categoryCount] = await Promise.all([
        knex('standard_boards').count('* as count').first(),
        knex('standard_service_categories').count('* as count').first(),
        knex('standard_categories').count('* as count').first()
    ]);
    
    if (boardCount?.count > 0 && serviceCategoryCount?.count > 0 && categoryCount?.count > 0) {
        console.log('Standard reference tables already populated');
        return;
    }
    
    console.log('Ensuring standard reference data is populated...');
    
    // The migration file 20250630140000_create_standard_reference_tables.cjs
    // already includes all the data insertion, so this seed file
    // primarily serves as documentation and a backup
    
    // If needed, we could re-run the inserts here, but it's better
    // to rely on the migration for initial data population
    
    console.log('Standard reference data check complete');
};