import { getConnection } from '../lib/db/db';

async function checkSchema() {
  const db = await getConnection();
  
  try {
    // Check columns in statuses table
    const result = await db.raw(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'statuses'
      ORDER BY ordinal_position
    `);
    
    console.log('Statuses table columns:');
    console.log(result.rows);
    
    // Check if table has any rows
    const count = await db('statuses').count('* as count');
    console.log('\nRow count:', count[0].count);
    
    // Sample row if exists
    const sample = await db('statuses').first();
    console.log('\nSample row:', sample);
    
  } catch (error) {
    console.error('Error checking schema:', error);
  } finally {
    await db.destroy();
  }
}

checkSchema();