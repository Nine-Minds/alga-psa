const fs = require('fs/promises');
const crypto = require('crypto');
const path = require('path');

/**
 * Helper function to read file content, calculate SHA256 hash, and update the template record.
 * @param { import("knex").Knex } knex
 * @param {string} templateCode The standard_invoice_template_code to update.
 * @param {string} relativeFilePath The path to the AssemblyScript source file, relative to the migration file.
 */
const updateTemplateFromFile = async (knex, templateCode, relativeFilePath) => {
  try {
    // Construct the absolute path relative to the migration file's directory
    const filePath = path.resolve(__dirname, '..', relativeFilePath); // Go up one level from /migrations
    console.log(`Reading file for ${templateCode} from: ${filePath}`);
    const fileContent = await fs.readFile(filePath, 'utf-8');

    const hash = crypto.createHash('sha256');
    hash.update(fileContent);
    const calculatedSha = hash.digest('hex');
    console.log(`Calculated SHA for ${templateCode}: ${calculatedSha}`);

    const updateResult = await knex('standard_invoice_templates')
      .where({ standard_invoice_template_code: templateCode })
      .update({
        assemblyScriptSource: fileContent,
        sha: calculatedSha,
      });

    if (updateResult === 0) {
      console.warn(`No standard template found with code '${templateCode}' to update.`);
    } else {
      console.log(`Successfully updated template '${templateCode}' with source and SHA.`);
    }
  } catch (error) {
    console.error(`Error updating template ${templateCode} from file ${relativeFilePath}:`, error);
    // Re-throw the error to ensure the migration fails if any file operation or update fails
    throw error;
  }
};


/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Add the new columns
  await knex.schema.alterTable('standard_invoice_templates', (table) => {
    table.string('standard_invoice_template_code'); // Using string (VARCHAR) as TEXT might be overkill unless very long codes are expected
    table.string('sha'); // SHA hashes are fixed length, string is appropriate
    table.text('assemblyScriptSource'); // Source code can be long, TEXT is suitable
  });

  // Update the standard_invoice_template_code for existing standard templates
  await knex('standard_invoice_templates')
    .where('name', 'Detailed Template')
    .update({ standard_invoice_template_code: 'standard-detailed' });

  await knex('standard_invoice_templates')
    .where('name', 'Standard Template')
    .update({ standard_invoice_template_code: 'standard-default' });

  // Now, populate the assemblyScriptSource and sha fields from files
  await updateTemplateFromFile(
    knex,
    'standard-default',
    'src/invoice-templates/assemblyscript/standard/standard-default.ts' // Corrected path relative to server/ directory
  );

  await updateTemplateFromFile(
    knex,
    'standard-detailed',
    'src/invoice-templates/assemblyscript/standard/standard-detailed.ts' // Corrected path relative to server/ directory
  );
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // No need to explicitly nullify the codes before dropping the column,
  // but it could be done here if needed for specific rollback scenarios.
  // await knex('standard_invoice_templates')
  //   .whereIn('standard_invoice_template_code', ['standard-detailed', 'standard-default'])
  //   .update({ standard_invoice_template_code: null });

  // Drop the columns
  await knex.schema.alterTable('standard_invoice_templates', (table) => {
    table.dropColumn('standard_invoice_template_code');
    table.dropColumn('sha');
    table.dropColumn('assemblyScriptSource');
  });
};
