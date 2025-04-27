const fs = require('fs');
const path = require('path');

exports.seed = async function (knex) {
    // Define paths relative to the server root directory (where knex is likely run from)
    const baseDir = path.resolve(__dirname, '../../'); // Go up two levels from seeds/dev
    const standardTsDir = path.join(baseDir, 'src', 'invoice-templates', 'assemblyscript', 'standard');
    const standardWasmOutputDir = 'dist/invoice-templates/standard'; // Relative path for DB

    // Template definitions
    const templates = [
        {
            name: 'Standard Template',
            is_default: true,
            tsFileName: 'standard-default.ts',
            wasmFileName: 'standard-default.wasm',
        },
        {
            name: 'Detailed Template',
            is_default: false,
            tsFileName: 'standard-detailed.ts',
            wasmFileName: 'standard-detailed.wasm',
        },
    ];

    const templatesToInsert = [];

    for (const template of templates) {
        const tsFilePath = path.join(standardTsDir, template.tsFileName);
        const wasmDbPath = path.join(standardWasmOutputDir, template.wasmFileName); // Use POSIX separators for DB path

        let assemblyScriptSource = '';
        try {
            assemblyScriptSource = fs.readFileSync(tsFilePath, 'utf8');
            console.log(`Read source for ${template.name} from ${tsFilePath}`);
        } catch (err) {
            console.error(`Error reading AssemblyScript source file ${tsFilePath}:`, err);
            // Decide how to handle error: skip this template, throw, etc.
            // For seeding, skipping might be acceptable if the file is missing during build
            continue;
        }

        // Check if Wasm file exists (optional, but good practice for seeding)
        const wasmBuildPath = path.join(baseDir, standardWasmOutputDir, template.wasmFileName);
         if (!fs.existsSync(wasmBuildPath)) {
             console.warn(`Warning: Compiled Wasm file not found at ${wasmBuildPath} for template ${template.name}. Skipping seed entry.`);
             continue; // Skip if Wasm file doesn't exist
         }


        templatesToInsert.push({
            // tenant: null, // Standard templates are not tenant-specific
            template_id: knex.raw('gen_random_uuid()'),
            name: template.name,
            version: 1, // Assuming version 1 for initial seeding
            assemblyScriptSource: assemblyScriptSource,
            wasmPath: wasmDbPath.replace(/\\/g, '/'), // Ensure POSIX path separators for DB consistency
            isStandard: true, // Mark as standard
            is_default: template.is_default,
            // dsl: null, // Ensure DSL is null or omitted if column allows null
            created_at: knex.fn.now(),
            updated_at: knex.fn.now(),
        });
    }

    if (templatesToInsert.length > 0) {
        // Use onConflict to update existing standard templates by name if they exist, otherwise insert.
        // This makes the seed idempotent for standard templates.
        await knex('invoice_templates')
            .insert(templatesToInsert)
            .onConflict(['name']) // Assuming 'name' should be unique for standard templates
            .merge([ // Columns to update on conflict
                'version',
                'assemblyScriptSource',
                'wasmPath',
                'isStandard',
                'is_default',
                'updated_at'
            ]);
        console.log(`Successfully seeded/updated ${templatesToInsert.length} standard invoice templates.`);
    } else {
        console.log("No standard invoice templates to seed (source or wasm files might be missing).");
    }

    // Optional: Clean up any old standard templates that might have been assigned a tenant ID previously
    // await knex('invoice_templates').where({ isStandard: true }).whereNotNull('tenant').update({ tenant: null });
};