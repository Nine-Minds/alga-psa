// server/migrations/20250427171356_populate_standard_templates_wasm_binary.cjs
// const fs = require('fs/promises');
// const path = require('path');

// const tableName = 'standard_invoice_templates';
// const wasmDir = path.join(__dirname, '../../dist/server/src/invoice-templates/standard'); // Directory relative to this migration file

// // Define standard templates and their corresponding Wasm files and names
// const standardTemplates = [
//   {
//     name: 'Detailed Template',
//     wasmFile: 'standard-detailed.wasm',
//   },
//   {
//     name: 'Standard Template',
//     wasmFile: 'standard-default.wasm',
//   },
  // Add other standard templates here if they exist
// ];

exports.up = async function(knex) {
 return Promise.resolve
}
/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
// exports.up = async function(knex) {
//   console.log(`Populating wasmBinary column in ${tableName}...`);

//   for (const template of standardTemplates) {
//     const wasmFilePath = path.join(wasmDir, template.wasmFile);
//     try {
//       console.log(`Reading Wasm file: ${wasmFilePath} for template name: ${template.name}`);
//       const wasmBuffer = await fs.readFile(wasmFilePath);

//       // Find the template by name to get the correct ID
//       const templateRecord = await knex(tableName)
//         .select('template_id')
//         .where({ name: template.name })
//         .first();

//       if (!templateRecord) {
//         console.warn(`Template with name ${template.name} not found in ${tableName}. Skipping update.`);
//         continue; // Skip to the next template
//       }

//       const templateId = templateRecord.template_id;

//       console.log(`Updating template name: ${template.name} (ID: ${templateId}) with Wasm binary data (${wasmBuffer.length} bytes)`);
//       const updated = await knex(tableName)
//         .where({ template_id: templateId })
//         .update({ wasmBinary: wasmBuffer });

//       if (updated === 0) {
//           console.warn(`Template with ID ${templateId} not found in ${tableName}. Skipping update.`);
//       } else {
//           console.log(`Successfully updated template ID: ${templateId}`);
//       }

//     } catch (error) {
//       console.error(`Error processing template ${template.name} (${template.wasmFile}):`, error);
//       // Decide if one error should stop the whole migration
//       throw new Error(`Failed to process Wasm file ${template.wasmFile} for template ${template.name}: ${error.message}`);
//     }
//   }

//   // Optional: Clean up the temporary directory after successful population
//   // Be cautious with automated cleanup in migrations
//   // try {
//   //   await fs.rm(wasmDir, { recursive: true, force: true });
//   //   console.log(`Cleaned up temporary Wasm directory: ${wasmDir}`);
//   // } catch (cleanupError) {
//   //   console.error(`Failed to clean up temporary Wasm directory ${wasmDir}:`, cleanupError);
//   // }

//   console.log(`Finished populating wasmBinary column in ${tableName}.`);
// };

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  console.log(`Rolling back wasmBinary population for ${tableName}...`);
  // Set wasmBinary back to null for the templates updated in the 'up' function

  // In the down migration, we don't have the IDs readily available from standardTemplates
  // We would need to identify the templates by name again if we wanted to be precise.
  // However, for a rollback, setting wasmBinary to null for all standard templates
  // based on their names is a reasonable approach.
  const templateNames = standardTemplates.map(t => t.name);
  await knex(tableName)
    .whereIn('name', templateNames)
    .update({ wasmBinary: null });
  console.log(`Set wasmBinary to NULL for standard templates in ${tableName}.`);
};
