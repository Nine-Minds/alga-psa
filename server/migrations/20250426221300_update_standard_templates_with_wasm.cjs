const fs = require('fs');
const path = require('path');

exports.up = async function(knex) {
    // Define paths relative to the migration file location
    const standardTsDir = path.resolve(__dirname, '../src/invoice-templates/assemblyscript/standard');
    const standardWasmOutputDir = 'dist/invoice-templates/standard'; // Relative path for DB

    // 1. Alter the table: Add new columns, drop old one
    await knex.schema.alterTable('standard_invoice_templates', (table) => {
        table.text('assemblyScriptSource').nullable();
        table.string('wasmPath', 1024).nullable();
        // Check if 'dsl' column exists before dropping (safer if run multiple times or on different states)
        knex.schema.hasColumn('standard_invoice_templates', 'dsl').then(exists => {
            if (exists) {
                table.dropColumn('dsl');
            }
        });
    });

    // 2. Prepare template data (source content and paths)
    const templatesToUpdate = [
        { name: 'Standard Template', tsFileName: 'standard-default.ts', wasmFileName: 'standard-default.wasm' },
        { name: 'Detailed Template', tsFileName: 'standard-detailed.ts', wasmFileName: 'standard-detailed.wasm' },
    ];

    for (const template of templatesToUpdate) {
        const tsFilePath = path.join(standardTsDir, template.tsFileName);
        const wasmDbPath = path.join(standardWasmOutputDir, template.wasmFileName).replace(/\\/g, '/'); // POSIX path

        let assemblyScriptSource = '';
        try {
            assemblyScriptSource = fs.readFileSync(tsFilePath, 'utf8');
        } catch (err) {
            console.error(`Migration Warning: Could not read AssemblyScript source file ${tsFilePath} for standard template '${template.name}'. Source will not be updated in DB.`, err);
            // Set source to null or empty if file read fails, so wasmPath might still be set
            assemblyScriptSource = null;
        }

        // 3. Update existing rows
        await knex('standard_invoice_templates')
            .where({ name: template.name })
            .update({
                assemblyScriptSource: assemblyScriptSource,
                wasmPath: wasmDbPath,
                updated_at: knex.fn.now() // Update timestamp
            });
         console.log(`Migration: Updated standard template '${template.name}' with AssemblyScript source and Wasm path.`);
    }
};

exports.down = async function(knex) {
    // Revert the changes: Add 'dsl' back, drop new columns
    await knex.schema.alterTable('standard_invoice_templates', (table) => {
        // Add 'dsl' column back - assuming it was text and nullable for simplicity in rollback
        table.text('dsl').nullable();

        // Drop the added columns if they exist
         knex.schema.hasColumn('standard_invoice_templates', 'assemblyScriptSource').then(exists => {
            if (exists) {
                 table.dropColumn('assemblyScriptSource');
            }
        });
         knex.schema.hasColumn('standard_invoice_templates', 'wasmPath').then(exists => {
            if (exists) {
                 table.dropColumn('wasmPath');
            }
        });
    });
     // Note: The actual content of 'dsl' and the source/wasm paths are not restored in this down migration.
     // A full rollback would require storing the old DSL content before dropping.
};