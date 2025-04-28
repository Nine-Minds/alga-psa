// server/migrations/20250427171356_populate_standard_templates_wasm_binary.cjs
const fs = require('fs/promises');
const path = require('path');

const tableName = 'standard_invoice_templates';
const wasmDir = path.join(__dirname, 'temp_wasm'); // Directory relative to this migration file

// Define standard templates and their corresponding Wasm files and IDs
const standardTemplates = [
  {
    // IMPORTANT: Replace placeholder ID if known
    id: '7a7cfba8-3213-4819-b4e4-32c92139ce0b', // standard-detailed
    wasmFile: 'standard-detailed.wasm',
  },
  {
    // IMPORTANT: Replace placeholder ID if known
    id: '17af7ffd-d9e5-4da0-b822-0f8b8c587d94', // standard-default (ID confirmed via DB query)
    wasmFile: 'standard-default.wasm',
  },
  // Add other standard templates here if they exist
];

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  console.log(`Populating wasmBinary column in ${tableName}...`);

  for (const template of standardTemplates) {
    const wasmFilePath = path.join(wasmDir, template.wasmFile);
    try {
      console.log(`Reading Wasm file: ${wasmFilePath} for template ID: ${template.id}`);
      const wasmBuffer = await fs.readFile(wasmFilePath);

      console.log(`Updating template ID: ${template.id} with Wasm binary data (${wasmBuffer.length} bytes)`);
      const updated = await knex(tableName)
        .where({ template_id: template.id })
        .update({ wasmBinary: wasmBuffer });

      if (updated === 0) {
          console.warn(`Template with ID ${template.id} not found in ${tableName}. Skipping update.`);
      } else {
          console.log(`Successfully updated template ID: ${template.id}`);
      }

    } catch (error) {
      console.error(`Error processing template ${template.id} (${template.wasmFile}):`, error);
      // Decide if one error should stop the whole migration
      throw new Error(`Failed to process Wasm file ${template.wasmFile} for template ${template.id}: ${error.message}`);
    }
  }

  // Optional: Clean up the temporary directory after successful population
  // Be cautious with automated cleanup in migrations
  // try {
  //   await fs.rm(wasmDir, { recursive: true, force: true });
  //   console.log(`Cleaned up temporary Wasm directory: ${wasmDir}`);
  // } catch (cleanupError) {
  //   console.error(`Failed to clean up temporary Wasm directory ${wasmDir}:`, cleanupError);
  // }

  console.log(`Finished populating wasmBinary column in ${tableName}.`);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  console.log(`Rolling back wasmBinary population for ${tableName}...`);
  // Set wasmBinary back to null for the templates updated in the 'up' function
  const templateIds = standardTemplates.map(t => t.id);
  await knex(tableName)
    .whereIn('template_id', templateIds)
    .update({ wasmBinary: null });
  console.log(`Set wasmBinary to NULL for standard templates in ${tableName}.`);
};
