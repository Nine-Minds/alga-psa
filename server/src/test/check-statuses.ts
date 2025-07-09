import { getConnection } from '../lib/db/db';

async function checkStatuses() {
  const db = await getConnection();
  
  try {
    // Check columns in statuses table
    const columns = await db.raw(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'statuses'
      ORDER BY ordinal_position
    `);
    
    console.log('Statuses table columns:');
    console.log(columns.rows);
    
    // Check for existing statuses
    const statuses = await db('statuses')
      .where('item_type', 'project')
      .orderBy('order_number');
    
    console.log('\nExisting project statuses:');
    console.log(statuses);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.destroy();
  }
}

checkStatuses();