/**
 * Seed ITIL priorities
 * These are standard ITIL priority levels calculated from Impact × Urgency
 */

exports.seed = async function(knex) {
  // Check if ITIL priorities already exist
  const existingPriorities = await knex('itil_priorities').select('*');

  if (existingPriorities.length > 0) {
    console.log('ITIL priorities already seeded, skipping...');
    return;
  }

  // Insert standard ITIL priorities
  const itilPriorities = [
    {
      priority_level: 1,
      priority_name: 'Critical',
      color: '#DC2626', // Red
      description: 'Immediate action required. Major incident affecting critical business functions.',
      target_resolution_hours: 1
    },
    {
      priority_level: 2,
      priority_name: 'High',
      color: '#EA580C', // Orange
      description: 'Urgent action required. Significant impact on business operations.',
      target_resolution_hours: 4
    },
    {
      priority_level: 3,
      priority_name: 'Medium',
      color: '#F59E0B', // Amber
      description: 'Timely action required. Moderate impact on business operations.',
      target_resolution_hours: 24
    },
    {
      priority_level: 4,
      priority_name: 'Low',
      color: '#3B82F6', // Blue
      description: 'Non-urgent. Minor impact on business operations.',
      target_resolution_hours: 72
    },
    {
      priority_level: 5,
      priority_name: 'Planning',
      color: '#6B7280', // Gray
      description: 'Scheduled work. Minimal or no immediate impact.',
      target_resolution_hours: 168 // 1 week
    }
  ];

  await knex('itil_priorities').insert(itilPriorities);
  console.log('ITIL priorities seeded successfully');
};