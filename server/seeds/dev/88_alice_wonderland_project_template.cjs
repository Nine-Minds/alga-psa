/**
 * Seed an Alice in Wonderland themed project template for dev environment
 * "Down the Rabbit Hole: A Curiouser and Curiouser Migration"
 *
 * NOTE: estimated_hours is stored in MINUTES (not hours) in the database
 */
const crypto = require('crypto');

// Use Node.js built-in crypto.randomUUID() instead of uuid package
const uuidv4 = () => crypto.randomUUID();

const TEMPLATE_NAME = 'Down the Rabbit Hole Migration';
const TEMPLATE_CATEGORY = 'Wonderland';
const TEMPLATE_DESCRIPTION = 'A most curious project template for navigating the peculiar landscape of system migrations. As the Cheshire Cat would say, "We\'re all mad here" - but this template will keep you from losing your head!';

// Standard status definitions with colors
const STANDARD_STATUSES = [
  { name: 'To Do', color: '#6B7280', is_closed: false, order_number: 1 },
  { name: 'In Progress', color: '#3B82F6', is_closed: false, order_number: 2 },
  { name: 'Blocked', color: '#EF4444', is_closed: false, order_number: 3 },
  { name: 'Done', color: '#10B981', is_closed: true, order_number: 4 }
];

/**
 * Convert hours to minutes for database storage
 */
const hoursToMinutes = (hours) => Math.round(hours * 60);

/**
 * Build the template data structure
 * NOTE: estimated_hours values are in MINUTES
 */
function buildTemplateData(tenant, templateId, statusMappingIds) {
  const phase1Id = uuidv4(); // Down the Rabbit Hole
  const phase2Id = uuidv4(); // The Pool of Tears
  const phase3Id = uuidv4(); // A Mad Tea-Party
  const phase4Id = uuidv4(); // The Queen's Croquet-Ground

  const toDoStatusMappingId = statusMappingIds[0];

  const phases = [
    {
      tenant,
      template_phase_id: phase1Id,
      template_id: templateId,
      phase_name: 'Down the Rabbit Hole',
      description: 'The curious beginning where we tumble into the unknown depths of legacy systems, falling past shelves of old documentation and jars labeled "ORANGE MARMALADE" (but actually containing deprecated configs).',
      duration_days: 5,
      start_offset_days: 0,
      order_key: 'a0'
    },
    {
      tenant,
      template_phase_id: phase2Id,
      template_id: templateId,
      phase_name: 'The Pool of Tears',
      description: 'Where we swim through the accumulated technical debt of years past, occasionally bumping into a Mouse who knows the driest thing - proper database normalization.',
      duration_days: 7,
      start_offset_days: 5,
      order_key: 'a1'
    },
    {
      tenant,
      template_phase_id: phase3Id,
      template_id: templateId,
      phase_name: 'A Mad Tea-Party',
      description: 'The chaotic middle phase where nothing makes sense, time seems broken (especially timestamps), and the Hatter keeps asking "Why is a raven like a writing desk?" (Answer: Neither should store production credentials).',
      duration_days: 10,
      start_offset_days: 12,
      order_key: 'a2'
    },
    {
      tenant,
      template_phase_id: phase4Id,
      template_id: templateId,
      phase_name: 'The Queen\'s Croquet-Ground',
      description: 'Final validation where we play croquet with flamingo-shaped test scripts and hedgehog data packets, hoping the Queen doesn\'t shout "Off with their heads!" at our error logs.',
      duration_days: 5,
      start_offset_days: 22,
      order_key: 'a3'
    }
  ];

  const tasks = [
    // Phase 1: Down the Rabbit Hole
    {
      tenant,
      template_task_id: uuidv4(),
      template_phase_id: phase1Id,
      task_name: 'Follow the White Rabbit (Initial Discovery)',
      description: 'Chase that mysterious white rabbit of a legacy system through the meadow of undocumented code. Don\'t be late!',
      estimated_hours: hoursToMinutes(3),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a0'
    },
    {
      tenant,
      template_task_id: uuidv4(),
      template_phase_id: phase1Id,
      task_name: 'Drink the "DRINK ME" Bottle (Shrink Scope)',
      description: 'Carefully consume the requirements document to shrink the project scope to a manageable size. Warning: May cause sudden feelings of smallness.',
      estimated_hours: hoursToMinutes(2),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a1'
    },
    {
      tenant,
      template_task_id: uuidv4(),
      template_phase_id: phase1Id,
      task_name: 'Eat the "EAT ME" Cake (Expand Infrastructure)',
      description: 'Consume the infrastructure planning documents to grow large enough to reach the key of cloud scalability on that impossibly high table.',
      estimated_hours: hoursToMinutes(4),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a2'
    },
    {
      tenant,
      template_task_id: uuidv4(),
      template_phase_id: phase1Id,
      task_name: 'Find the Golden Key (API Credentials)',
      description: 'Locate and secure all API keys, tokens, and secrets. The tiny door to the beautiful garden awaits!',
      estimated_hours: hoursToMinutes(2),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a3'
    },
    {
      tenant,
      template_task_id: uuidv4(),
      template_phase_id: phase1Id,
      task_name: 'Document the Fall (Technical Assessment)',
      description: 'Record everything observed during the fall - the cupboards, bookshelves, maps, and pictures. Future Alice will thank you.',
      estimated_hours: hoursToMinutes(3),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a4'
    },

    // Phase 2: The Pool of Tears
    {
      tenant,
      template_task_id: uuidv4(),
      template_phase_id: phase2Id,
      task_name: 'Cry a Pool of Data (Export Legacy Data)',
      description: 'Shed enough tears (data exports) to fill an entire pool. Mind the Mouse - he hates getting wet with unvalidated records.',
      estimated_hours: hoursToMinutes(4),
      duration_days: 2,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a0'
    },
    {
      tenant,
      template_task_id: uuidv4(),
      template_phase_id: phase2Id,
      task_name: 'Swim with the Dodo (Stakeholder Alignment)',
      description: 'Join the Caucus-race with stakeholders where everybody runs in circles until everyone has won and all must have prizes (sign-offs).',
      estimated_hours: hoursToMinutes(3),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a1'
    },
    {
      tenant,
      template_task_id: uuidv4(),
      template_phase_id: phase2Id,
      task_name: 'Learn from the Mouse (Historical Data Tales)',
      description: 'Listen to the Mouse\'s long and sad tale about William the Conqueror... er, I mean, the history of your data schema migrations.',
      estimated_hours: hoursToMinutes(2),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a2'
    },
    {
      tenant,
      template_task_id: uuidv4(),
      template_phase_id: phase2Id,
      task_name: 'Dry Off with the Caucus Race (Data Validation)',
      description: 'Run around validating data until you\'re dry (or until all records pass validation - whichever comes first).',
      estimated_hours: hoursToMinutes(5),
      duration_days: 2,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a3'
    },
    {
      tenant,
      template_task_id: uuidv4(),
      template_phase_id: phase2Id,
      task_name: 'Find the Thimble Prize (Quick Wins)',
      description: 'Identify and celebrate small victories. Alice\'s own thimble, presented with great ceremony!',
      estimated_hours: hoursToMinutes(1),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a4'
    },

    // Phase 3: A Mad Tea-Party
    {
      tenant,
      template_task_id: uuidv4(),
      template_phase_id: phase3Id,
      task_name: 'Set the Table (Environment Setup)',
      description: 'Arrange the teacups (containers), teapots (services), and ensure the Dormouse (monitoring) is properly positioned in the teapot.',
      estimated_hours: hoursToMinutes(4),
      duration_days: 2,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a0'
    },
    {
      tenant,
      template_task_id: uuidv4(),
      template_phase_id: phase3Id,
      task_name: 'Riddles with the Hatter (Problem Solving)',
      description: 'Answer impossible riddles like "Why is a microservice like a writing desk?" and "Have you guessed the null pointer yet?"',
      estimated_hours: hoursToMinutes(6),
      duration_days: 2,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a1'
    },
    {
      tenant,
      template_task_id: uuidv4(),
      template_phase_id: phase3Id,
      task_name: 'Move Down! Move Down! (Data Migration)',
      description: 'Keep moving seats around the table (shuffling data between systems) because there\'s always clean cups further down!',
      estimated_hours: hoursToMinutes(8),
      duration_days: 3,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a2'
    },
    {
      tenant,
      template_task_id: uuidv4(),
      template_phase_id: phase3Id,
      task_name: 'Wake the Dormouse (Activate Monitoring)',
      description: 'Poke the Dormouse repeatedly to ensure all monitoring and alerting systems are actually awake. "Twinkle, twinkle, little bat..."',
      estimated_hours: hoursToMinutes(3),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a3'
    },
    {
      tenant,
      template_task_id: uuidv4(),
      template_phase_id: phase3Id,
      task_name: 'Fix the Watch (Timestamp Synchronization)',
      description: 'The Hatter\'s watch is two days wrong! Butter in the works, perhaps. Ensure all system clocks and timestamps are properly synchronized.',
      estimated_hours: hoursToMinutes(2),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a4'
    },
    {
      tenant,
      template_task_id: uuidv4(),
      template_phase_id: phase3Id,
      task_name: 'No Room! No Room! (Capacity Planning)',
      description: 'Despite the March Hare\'s protests, find room at the table for all the data. There\'s PLENTY of room if you plan properly!',
      estimated_hours: hoursToMinutes(3),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a5'
    },

    // Phase 4: The Queen's Croquet-Ground
    {
      tenant,
      template_task_id: uuidv4(),
      template_phase_id: phase4Id,
      task_name: 'Paint the Roses Red (Fix Critical Bugs)',
      description: 'Quick! Paint over all the white roses (bugs) before the Queen sees them! "We planted white bugs by mistake..."',
      estimated_hours: hoursToMinutes(4),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a0'
    },
    {
      tenant,
      template_task_id: uuidv4(),
      template_phase_id: phase4Id,
      task_name: 'Play Croquet (User Acceptance Testing)',
      description: 'Play the most confusing game of croquet ever with live flamingo test scripts and hedgehog test data that keep wandering off.',
      estimated_hours: hoursToMinutes(4),
      duration_days: 2,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a1'
    },
    {
      tenant,
      template_task_id: uuidv4(),
      template_phase_id: phase4Id,
      task_name: 'Consult the Cheshire Cat (Get Expert Advice)',
      description: '"Would you tell me which way I ought to go from here?" Get guidance on the path to production. Remember: We\'re all mad here.',
      estimated_hours: hoursToMinutes(2),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a2'
    },
    {
      tenant,
      template_task_id: uuidv4(),
      template_phase_id: phase4Id,
      task_name: 'Survive the Queen\'s Verdict (Go-Live Approval)',
      description: 'Present your work to the Queen. Pray she doesn\'t shout "Off with their heads!" Accept that sentence first, verdict afterwards.',
      estimated_hours: hoursToMinutes(2),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a3'
    },
    {
      tenant,
      template_task_id: uuidv4(),
      template_phase_id: phase4Id,
      task_name: 'Wake Up (Go Live & Celebrate)',
      description: '"You\'re nothing but a pack of cards!" Wake up on the bank with your sister, realizing the curious dream is now production reality.',
      estimated_hours: hoursToMinutes(1),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a4'
    }
  ];

  return { phases, tasks };
}

/**
 * Find existing statuses or create if missing, then create status mappings for template
 * Uses: To Do, In Progress, Blocked, Done
 */
async function getOrCreateStandardStatusMappings(knex, tenant, templateId) {
  const statusMappings = [];
  const statusMappingIds = [];

  for (const standardStatus of STANDARD_STATUSES) {
    // Look up existing status by name (case-insensitive)
    let status = await knex('statuses')
      .where({ tenant, status_type: 'project_task' })
      .whereRaw('LOWER(name) = LOWER(?)', [standardStatus.name])
      .first();

    // Create only if not found (fallback for missing statuses like "Blocked")
    if (!status) {
      const maxOrder = await knex('statuses')
        .where({ tenant, status_type: 'project_task' })
        .max('order_number as max')
        .first();

      const newStatusId = uuidv4();
      await knex('statuses').insert({
        tenant,
        status_id: newStatusId,
        name: standardStatus.name,
        status_type: 'project_task',
        is_closed: standardStatus.is_closed,
        order_number: (maxOrder?.max || 0) + 1,
        color: standardStatus.color,
        created_by: null
      });
      status = { status_id: newStatusId, color: standardStatus.color };
      console.log(`    Created missing status "${standardStatus.name}" for tenant`);
    }

    // Create status mapping for template
    const mappingId = uuidv4();
    statusMappings.push({
      tenant,
      template_status_mapping_id: mappingId,
      template_id: templateId,
      status_id: status.status_id,
      custom_status_name: null,
      custom_status_color: standardStatus.color,
      display_order: standardStatus.order_number
    });
    statusMappingIds.push(mappingId);
  }

  return { mappings: statusMappings, mappingIds: statusMappingIds };
}

exports.seed = async function (knex) {
  const tenant = await knex('tenants').select('tenant').first();
  if (!tenant) {
    console.log('No tenant found, skipping Alice in Wonderland project template seed');
    return;
  }

  const tenantId = tenant.tenant;

  // Check if template already exists
  const existing = await knex('project_templates')
    .where({
      tenant: tenantId,
      template_name: TEMPLATE_NAME
    })
    .first();

  if (existing) {
    console.log('Alice in Wonderland project template already exists, skipping');
    return;
  }

  // Get a user for created_by (optional, can be null for system templates)
  const user = await knex('users')
    .where('tenant', tenantId)
    .first();

  const templateId = uuidv4();

  // Get or create standard status mappings (To Do, In Progress, Done)
  const { mappings: statusMappings, mappingIds: statusMappingIds } =
    await getOrCreateStandardStatusMappings(knex, tenantId, templateId);

  // Insert in correct order: template first, then status mappings, then phases, then tasks
  await knex('project_templates').insert({
    tenant: tenantId,
    template_id: templateId,
    template_name: TEMPLATE_NAME,
    description: TEMPLATE_DESCRIPTION,
    category: TEMPLATE_CATEGORY,
    created_by: user?.user_id || null,
    use_count: 0
  });

  await knex('project_template_status_mappings').insert(statusMappings);

  // Build and insert phases and tasks
  const data = buildTemplateData(tenantId, templateId, statusMappingIds);

  await knex('project_template_phases').insert(data.phases);
  await knex('project_template_tasks').insert(data.tasks);

  console.log('Created Alice in Wonderland project template: "Down the Rabbit Hole Migration"');
  console.log('  "Curiouser and curiouser!" - Alice');
};
