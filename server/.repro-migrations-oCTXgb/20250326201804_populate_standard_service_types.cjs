/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const standardServiceTypes = [
    { name: 'Managed Services' },
    { name: 'Project/Professional Services' },
    { name: 'Break-Fix and Reactive Support' },
    { name: 'Cloud and Hosting' },
    { name: 'Hardware and Software' },
    { name: 'Cybersecurity Services' },
    { name: 'Telecommunications' },
    { name: 'Backup and Disaster Recovery (BDR)' },
    { name: 'User Support and Training' },
    // Add the missing essential types
    { name: 'Hourly Time' },
    { name: 'Fixed Price' },
    { name: 'Usage Based' },
  ];

  // Insert the standard service types, ignoring conflicts on the unique name constraint
  await knex('standard_service_types')
      .insert(standardServiceTypes)
      .onConflict('name') // Specify the column with the unique constraint
      .ignore(); // Ignore rows that cause a conflict
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  const standardServiceTypeNames = [
    'Managed Services',
    'Project/Professional Services',
    'Break-Fix and Reactive Support',
    'Cloud and Hosting',
    'Hardware and Software',
    'Cybersecurity Services',
    'Telecommunications',
    'Backup and Disaster Recovery (BDR)',
    'User Support and Training',
    // Add the missing essential types for rollback
    'Hourly Time',
    'Fixed Price',
    'Usage Based',
  ];

  // Delete the standard service types added in the 'up' migration
  await knex('standard_service_types').whereIn('name', standardServiceTypeNames).del();
};