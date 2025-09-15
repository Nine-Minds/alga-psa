/**
 * Seed ITIL incident categories and subcategories
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.seed = async function(knex) {
  // Get existing standard categories to avoid duplicates
  const existingCategories = await knex('standard_categories')
    .select('category_name')
    .where('item_type', 'ticket');
  
  const existingNames = new Set(existingCategories.map(cat => cat.category_name));
  
  // ITIL standard incident categories
  const itilCategories = [
    {
      category_name: 'Hardware',
      item_type: 'ticket',
      display_order: 10,
      description: 'Hardware-related incidents and service requests',
      is_itil_standard: true
    },
    {
      category_name: 'Software',
      item_type: 'ticket', 
      display_order: 20,
      description: 'Software-related incidents and service requests',
      is_itil_standard: true
    },
    {
      category_name: 'Network',
      item_type: 'ticket',
      display_order: 30,
      description: 'Network connectivity and infrastructure incidents',
      is_itil_standard: true
    },
    {
      category_name: 'Security',
      item_type: 'ticket',
      display_order: 40,
      description: 'Security-related incidents and breaches',
      is_itil_standard: true
    },
    {
      category_name: 'Service Request',
      item_type: 'ticket',
      display_order: 50,
      description: 'Standard service requests and fulfillment',
      is_itil_standard: true
    },
    {
      category_name: 'Database',
      item_type: 'ticket',
      display_order: 60,
      description: 'Database-related incidents and maintenance',
      is_itil_standard: true
    },
    {
      category_name: 'Backup & Recovery',
      item_type: 'ticket',
      display_order: 70,
      description: 'Data backup and disaster recovery incidents',
      is_itil_standard: true
    },
    {
      category_name: 'Email & Communication',
      item_type: 'ticket',
      display_order: 80,
      description: 'Email and communication system incidents',
      is_itil_standard: true
    }
  ];
  
  // Filter out categories that already exist
  const newCategories = itilCategories.filter(cat => !existingNames.has(cat.category_name));
  
  if (newCategories.length > 0) {
    console.log(`Inserting ${newCategories.length} new ITIL categories...`);
    
    // First, check if standard_categories table has is_itil_standard column
    const hasItilColumn = await knex.schema.hasColumn('standard_categories', 'is_itil_standard');
    
    if (!hasItilColumn) {
      console.log('Adding is_itil_standard column to standard_categories...');
      await knex.schema.alterTable('standard_categories', function(table) {
        table.boolean('is_itil_standard').defaultTo(false).comment('Whether this is a standard ITIL category');
      });
    }
    
    await knex('standard_categories').insert(newCategories);
  } else {
    console.log('All ITIL categories already exist, skipping...');
  }
  
  // Now add subcategories for each ITIL category
  const subcategories = [
    // Hardware subcategories
    { parent: 'Hardware', name: 'Server', description: 'Server hardware issues' },
    { parent: 'Hardware', name: 'Desktop/Laptop', description: 'End-user device hardware issues' },
    { parent: 'Hardware', name: 'Network Equipment', description: 'Switches, routers, and network hardware' },
    { parent: 'Hardware', name: 'Printer', description: 'Printer and printing device issues' },
    { parent: 'Hardware', name: 'Storage', description: 'Storage device and disk issues' },
    { parent: 'Hardware', name: 'Mobile Device', description: 'Smartphones, tablets, and mobile hardware' },
    
    // Software subcategories
    { parent: 'Software', name: 'Application', description: 'Third-party and business applications' },
    { parent: 'Software', name: 'Operating System', description: 'OS-related issues and updates' },
    { parent: 'Software', name: 'Database', description: 'Database software issues' },
    { parent: 'Software', name: 'Security Software', description: 'Antivirus, firewalls, and security tools' },
    { parent: 'Software', name: 'Productivity Software', description: 'Office suites and productivity tools' },
    { parent: 'Software', name: 'Custom Application', description: 'Internally developed applications' },
    
    // Network subcategories
    { parent: 'Network', name: 'Connectivity', description: 'General network connectivity issues' },
    { parent: 'Network', name: 'VPN', description: 'Virtual Private Network issues' },
    { parent: 'Network', name: 'Wi-Fi', description: 'Wireless network connectivity' },
    { parent: 'Network', name: 'Internet', description: 'Internet connectivity and access' },
    { parent: 'Network', name: 'LAN/WAN', description: 'Local and Wide Area Network issues' },
    { parent: 'Network', name: 'DNS', description: 'Domain Name System issues' },
    
    // Security subcategories
    { parent: 'Security', name: 'Malware', description: 'Virus, malware, and ransomware incidents' },
    { parent: 'Security', name: 'Unauthorized Access', description: 'Security breach and unauthorized access' },
    { parent: 'Security', name: 'Data Breach', description: 'Data loss or exposure incidents' },
    { parent: 'Security', name: 'Phishing', description: 'Phishing and social engineering attacks' },
    { parent: 'Security', name: 'Policy Violation', description: 'Security policy violations' },
    { parent: 'Security', name: 'Account Lockout', description: 'User account lockout issues' },
    
    // Service Request subcategories
    { parent: 'Service Request', name: 'Access Request', description: 'Requests for system or application access' },
    { parent: 'Service Request', name: 'New User Setup', description: 'New employee onboarding and setup' },
    { parent: 'Service Request', name: 'Software Installation', description: 'Software installation and licensing' },
    { parent: 'Service Request', name: 'Equipment Request', description: 'Hardware and equipment requests' },
    { parent: 'Service Request', name: 'Information Request', description: 'Information and documentation requests' },
    { parent: 'Service Request', name: 'Password Reset', description: 'Password reset and recovery requests' }
  ];
  
  // Get parent category IDs
  const parentCategories = await knex('standard_categories')
    .select('standard_category_id', 'category_name')
    .where('item_type', 'ticket')
    .whereIn('category_name', ['Hardware', 'Software', 'Network', 'Security', 'Service Request']);
  
  const parentMap = {};
  parentCategories.forEach(cat => {
    parentMap[cat.category_name] = cat.standard_category_id;
  });
  
  // Check if standard_subcategories table exists, if not create the data structure
  const hasSubcategoriesTable = await knex.schema.hasTable('standard_subcategories');
  
  if (hasSubcategoriesTable) {
    // Prepare subcategory data
    const subcategoryData = subcategories.map((sub, index) => ({
      parent_category_id: parentMap[sub.parent],
      subcategory_name: sub.name,
      description: sub.description,
      display_order: (index + 1) * 10,
      is_active: true
    })).filter(sub => sub.parent_category_id); // Only include subcategories with valid parent
    
    // Check for existing subcategories to avoid duplicates
    const existingSubs = await knex('standard_subcategories')
      .select('subcategory_name', 'parent_category_id')
      .whereIn('parent_category_id', Object.values(parentMap));
    
    const existingSubNames = new Set(
      existingSubs.map(sub => `${sub.parent_category_id}-${sub.subcategory_name}`)
    );
    
    const newSubcategories = subcategoryData.filter(sub => 
      !existingSubNames.has(`${sub.parent_category_id}-${sub.subcategory_name}`)
    );
    
    if (newSubcategories.length > 0) {
      console.log(`Inserting ${newSubcategories.length} new ITIL subcategories...`);
      await knex('standard_subcategories').insert(newSubcategories);
    } else {
      console.log('All ITIL subcategories already exist, skipping...');
    }
  } else {
    console.log('standard_subcategories table does not exist, skipping subcategory insertion...');
  }
  
  console.log('ITIL categories and subcategories seed completed.');
};