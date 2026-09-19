/**
 * Migration to populate ITIL standard categories in standard_categories table
 * These are standard ITIL service categories used for incident classification
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Define parent categories with high display_order to separate from custom categories
  const parentCategories = [
    { name: 'Hardware', order: 1000 },
    { name: 'Software', order: 1001 },
    { name: 'Network', order: 1002 },
    { name: 'Security', order: 1003 },
    { name: 'Service Request', order: 1004 }
  ];

  const parentIdMap = {};

  // Insert parent categories
  for (const category of parentCategories) {
    // Check if already exists
    const existing = await knex('standard_categories')
      .where('category_name', category.name)
      .whereNull('parent_category_uuid')
      .first();

    if (existing) {
      // Update to mark as ITIL standard
      await knex('standard_categories')
        .where('id', existing.id)
        .update({
          is_itil_standard: true,
          display_order: category.order,
          updated_at: knex.fn.now()
        });
      parentIdMap[category.name] = existing.id;
    } else {
      // Insert new parent category
      const [inserted] = await knex('standard_categories')
        .insert({
          id: knex.raw('gen_random_uuid()'),
          category_name: category.name,
          parent_category_uuid: null,
          is_itil_standard: true,
          display_order: category.order,
          created_at: knex.fn.now(),
          updated_at: knex.fn.now()
        })
        .returning(['id']);
      parentIdMap[category.name] = inserted.id;
    }
  }

  // Define subcategories with their parent relationships
  const subcategories = [
    // Hardware subcategories
    { parent: 'Hardware', name: 'Server', order: 1000 },
    { parent: 'Hardware', name: 'Desktop/Laptop', order: 1001 },
    { parent: 'Hardware', name: 'Network Equipment', order: 1002 },
    { parent: 'Hardware', name: 'Printer', order: 1003 },
    { parent: 'Hardware', name: 'Storage', order: 1004 },
    { parent: 'Hardware', name: 'Mobile Device', order: 1005 },

    // Software subcategories
    { parent: 'Software', name: 'Operating System', order: 1010 },
    { parent: 'Software', name: 'Business Application', order: 1011 },
    { parent: 'Software', name: 'Database', order: 1012 },
    { parent: 'Software', name: 'Email/Collaboration', order: 1013 },
    { parent: 'Software', name: 'Security Software', order: 1014 },
    { parent: 'Software', name: 'Custom Application', order: 1015 },

    // Network subcategories
    { parent: 'Network', name: 'Connectivity', order: 1020 },
    { parent: 'Network', name: 'VPN', order: 1021 },
    { parent: 'Network', name: 'Wi-Fi', order: 1022 },
    { parent: 'Network', name: 'Internet Access', order: 1023 },
    { parent: 'Network', name: 'LAN/WAN', order: 1024 },
    { parent: 'Network', name: 'Firewall', order: 1025 },

    // Security subcategories
    { parent: 'Security', name: 'Malware/Virus', order: 1030 },
    { parent: 'Security', name: 'Unauthorized Access', order: 1031 },
    { parent: 'Security', name: 'Data Breach', order: 1032 },
    { parent: 'Security', name: 'Phishing/Spam', order: 1033 },
    { parent: 'Security', name: 'Policy Violation', order: 1034 },
    { parent: 'Security', name: 'Account Lockout', order: 1035 },

    // Service Request subcategories
    { parent: 'Service Request', name: 'Access Request', order: 1040 },
    { parent: 'Service Request', name: 'New User Setup', order: 1041 },
    { parent: 'Service Request', name: 'Software Installation', order: 1042 },
    { parent: 'Service Request', name: 'Equipment Request', order: 1043 },
    { parent: 'Service Request', name: 'Information Request', order: 1044 },
    { parent: 'Service Request', name: 'Change Request', order: 1045 }
  ];

  // Insert subcategories
  for (const sub of subcategories) {
    const parentId = parentIdMap[sub.parent];

    // Check if already exists
    const existing = await knex('standard_categories')
      .where('category_name', sub.name)
      .where('parent_category_uuid', parentId)
      .first();

    if (existing) {
      // Update to mark as ITIL standard
      await knex('standard_categories')
        .where('id', existing.id)
        .update({
          is_itil_standard: true,
          display_order: sub.order,
          updated_at: knex.fn.now()
        });
    } else {
      // Insert new subcategory
      await knex('standard_categories').insert({
        id: knex.raw('gen_random_uuid()'),
        category_name: sub.name,
        parent_category_uuid: parentId,
        is_itil_standard: true,
        display_order: sub.order,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      });
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Remove all ITIL standard categories
  await knex('standard_categories')
    .where('is_itil_standard', true)
    .del();

  // Reset the is_itil_standard flag on remaining categories
  await knex('standard_categories')
    .update({
      is_itil_standard: false
    });
};