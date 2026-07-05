/**
 * Seed test defaults for email provider testing
 * Ensures test database has proper inbound ticket defaults configured
 */

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export async function seedTestDefaults(db: Knex, tenantId: string): Promise<void> {
  console.log('     🌱 Seeding test inbound ticket defaults...');
  const scopedDb = tenantDb(db, tenantId);
  
  // Check if defaults already exist
  const existingDefaults = await scopedDb.table('inbound_ticket_defaults')
    .where({ is_default: true })
    .first();
    
  if (existingDefaults) {
    console.log('     ✓ Test defaults already exist');
    return;
  }
  
  // Get default IDs for required fields
  const [board, status, priority] = await Promise.all([
    scopedDb.table('boards').first(),
    scopedDb.table('statuses').first(),
    scopedDb.table('priorities').first()
  ]);
  
  if (!board || !status || !priority) {
    console.error('     ❌ Could not find required fields for ticket defaults');
    console.log('       Available boards:', await scopedDb.table('boards').select('board_id', 'name'));
    console.log('       Available statuses:', await scopedDb.table('statuses').select('status_id', 'name'));
    console.log('       Available priorities:', await scopedDb.table('priorities').select('priority_id', 'name'));
    throw new Error('Missing required fields for ticket defaults');
  }
  
  // Create test defaults with flat structure
  const testDefaults = {
    id: db.raw('gen_random_uuid()'),
    tenant: tenantId,
    short_name: 'email-general',
    display_name: 'Test Email Defaults',
    description: 'Default configuration for test email processing',
    board_id: board.board_id,
    status_id: status.status_id,
    priority_id: priority.priority_id,
    client_id: null,
    entered_by: null, // System-generated tickets
    category_id: null,
    subcategory_id: null,
    location_id: null,
    is_default: true, // Mark as the default for this tenant
    is_active: true,
    created_at: new Date(),
    updated_at: new Date()
  };
  
  await scopedDb.table('inbound_ticket_defaults').insert(testDefaults);
  
  console.log('     ✅ Created test inbound ticket defaults');
  console.log(`       - Board: ${board.name} (${board.board_id})`);
  console.log(`       - Status: ${status.name} (${status.status_id})`);
  console.log(`       - Priority: ${priority.name} (${priority.priority_id})`);
}
