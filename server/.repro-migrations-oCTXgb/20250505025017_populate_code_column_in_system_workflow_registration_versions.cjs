/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Select version_id and definition from the table
  const versions = await knex('system_workflow_registration_versions')
    .select('version_id', 'definition');

  // Iterate through each version
  for (const version of versions) {
    if (version.definition) {
      try {
        // Attempt to parse the definition JSON
        const definitionObj = JSON.parse(version.definition);

        // Check if executeFn exists in the parsed object
        if (definitionObj && typeof definitionObj.executeFn === 'string') {
          const executeFnCode = definitionObj.executeFn;

          // Update the code column with the extracted executeFn value
          await knex('system_workflow_registration_versions')
            .where('version_id', version.version_id)
            .update({ code: executeFnCode });
        }
      } catch (error) {
        // Log parsing errors but continue the migration
        console.error(`Error parsing definition for version_id ${version.version_id}:`, error.message);
        // Optionally, you could update the row with an error marker or leave it null
      }
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  // Set the code column back to NULL for all rows
  return knex('system_workflow_registration_versions')
    .update({ code: null });
};
