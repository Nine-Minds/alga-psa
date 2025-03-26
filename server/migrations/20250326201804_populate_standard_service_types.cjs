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
  ];

  // Insert the standard service types
  await knex('standard_service_types').insert(standardServiceTypes);
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
  ];

  // Delete the standard service types added in the 'up' migration
  await knex('standard_service_types').whereIn('name', standardServiceTypeNames).del();
};
