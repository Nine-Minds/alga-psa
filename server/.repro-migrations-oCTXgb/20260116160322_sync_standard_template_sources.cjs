const fs = require('fs/promises');
const crypto = require('crypto');
const path = require('path');

/**
 * Migration: Sync standard template sources from disk to database
 *
 * This migration updates the assemblyScriptSource and sha columns in the
 * standard_invoice_templates table to match the current TypeScript source files.
 *
 * This is needed because the source files were updated to use 'tenantClient'
 * instead of 'tenantCompany', but the database still had the old source code.
 */

/**
 * Helper function to read file content, calculate SHA256 hash, and update the template record.
 * @param { import("knex").Knex } knex
 * @param {string} templateCode The standard_invoice_template_code to update.
 * @param {string} relativeFilePath The path to the AssemblyScript source file, relative to the migration file.
 */
const updateTemplateFromFile = async (knex, templateCode, relativeFilePath) => {
  try {
    // Construct the absolute path relative to the migration file's directory
    const filePath = path.resolve(__dirname, '..', relativeFilePath);
    console.log(`[sync_standard_template_sources] Reading file for ${templateCode} from: ${filePath}`);
    const fileContent = await fs.readFile(filePath, 'utf-8');

    const hash = crypto.createHash('sha256');
    hash.update(fileContent);
    const calculatedSha = hash.digest('hex');
    console.log(`[sync_standard_template_sources] Calculated SHA for ${templateCode}: ${calculatedSha}`);

    const updateResult = await knex('standard_invoice_templates')
      .where({ standard_invoice_template_code: templateCode })
      .update({
        assemblyScriptSource: fileContent,
        sha: calculatedSha,
        updated_at: knex.fn.now()
      });

    if (updateResult === 0) {
      console.warn(`[sync_standard_template_sources] No standard template found with code '${templateCode}' to update.`);
    } else {
      console.log(`[sync_standard_template_sources] Successfully updated template '${templateCode}' with source and SHA.`);
    }
  } catch (error) {
    console.error(`[sync_standard_template_sources] Error updating template ${templateCode} from file ${relativeFilePath}:`, error);
    throw error;
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  console.log('[sync_standard_template_sources] Starting migration to sync standard template sources...');

  // Update standard-default template
  await updateTemplateFromFile(
    knex,
    'standard-default',
    'src/invoice-templates/assemblyscript/standard/standard-default.ts'
  );

  // Update standard-detailed template
  await updateTemplateFromFile(
    knex,
    'standard-detailed',
    'src/invoice-templates/assemblyscript/standard/standard-detailed.ts'
  );

  console.log('[sync_standard_template_sources] Migration completed successfully.');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // This migration only updates data to match the current source files.
  // Rolling back would require restoring the old source content, which is not practical.
  // The down migration is a no-op.
  console.log('[sync_standard_template_sources] Down migration is a no-op. Source content was synced from current files.');
};
