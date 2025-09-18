/**
 * Migration to add ITIL categories to standard_categories table
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // First, insert parent categories
  const parentCategoryNames = ['Hardware', 'Software', 'Network', 'Security', 'Service Request'];
  const parentIdMap = {};

  // Insert or update parent categories
  for (const categoryName of parentCategoryNames) {
    const existing = await knex('standard_categories')
      .where('category_name', categoryName)
      .whereNull('parent_category_uuid')
      .first();

    if (existing) {
      // Update existing to mark as ITIL standard
      await knex('standard_categories')
        .where('id', existing.id)
        .update({
          is_itil_standard: true,
          updated_at: knex.raw('NOW()')
        });
      parentIdMap[categoryName] = existing.id;
    } else {
      // Insert new parent category
      const [inserted] = await knex('standard_categories').insert({
        id: knex.raw('gen_random_uuid()'),
        category_name: categoryName,
        parent_category_uuid: null,
        is_itil_standard: true,
        created_at: knex.raw('NOW()'),
        updated_at: knex.raw('NOW()')
      }).returning(['id']);
      parentIdMap[categoryName] = inserted.id;
    }
  }

  // Define subcategories
  const subcategoryData = [
    // Hardware subcategories
    { parent: 'Hardware', name: 'Server' },
    { parent: 'Hardware', name: 'Desktop/Laptop' },
    { parent: 'Hardware', name: 'Network Equipment' },
    { parent: 'Hardware', name: 'Printer' },
    { parent: 'Hardware', name: 'Storage' },
    { parent: 'Hardware', name: 'Mobile Device' },

    // Software subcategories
    { parent: 'Software', name: 'Application' },
    { parent: 'Software', name: 'Operating System' },
    { parent: 'Software', name: 'Database' },
    { parent: 'Software', name: 'Security Software' },
    { parent: 'Software', name: 'Productivity Software' },
    { parent: 'Software', name: 'Custom Application' },

    // Network subcategories
    { parent: 'Network', name: 'Connectivity' },
    { parent: 'Network', name: 'VPN' },
    { parent: 'Network', name: 'Wi-Fi' },
    { parent: 'Network', name: 'Internet' },
    { parent: 'Network', name: 'LAN/WAN' },
    { parent: 'Network', name: 'Firewall' },

    // Security subcategories
    { parent: 'Security', name: 'Malware' },
    { parent: 'Security', name: 'Unauthorized Access' },
    { parent: 'Security', name: 'Data Breach' },
    { parent: 'Security', name: 'Phishing' },
    { parent: 'Security', name: 'Policy Violation' },
    { parent: 'Security', name: 'Account Lockout' },

    // Service Request subcategories
    { parent: 'Service Request', name: 'Access Request' },
    { parent: 'Service Request', name: 'New User Setup' },
    { parent: 'Service Request', name: 'Software Installation' },
    { parent: 'Service Request', name: 'Equipment Request' },
    { parent: 'Service Request', name: 'Information Request' },
    { parent: 'Service Request', name: 'Change Request' }
  ];

  // Insert subcategories (handling duplicates)
  for (const sub of subcategoryData) {
    const existing = await knex('standard_categories')
      .where('category_name', sub.name)
      .where('parent_category_uuid', parentIdMap[sub.parent])
      .first();

    if (existing) {
      // Update existing to mark as ITIL standard
      await knex('standard_categories')
        .where('id', existing.id)
        .update({
          is_itil_standard: true,
          updated_at: knex.raw('NOW()')
        });
    } else {
      // Insert new subcategory
      await knex('standard_categories').insert({
        id: knex.raw('gen_random_uuid()'),
        category_name: sub.name,
        parent_category_uuid: parentIdMap[sub.parent],
        is_itil_standard: true,
        created_at: knex.raw('NOW()'),
        updated_at: knex.raw('NOW()')
      });
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex('standard_categories')
    .where('is_itil_standard', true)
    .del();
};