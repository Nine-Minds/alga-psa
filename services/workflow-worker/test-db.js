import { getAdminConnection } from '@alga-psa/db/admin';

async function testConnection() {
  console.log('Environment variables:');
  console.log('DB_HOST:', process.env.DB_HOST);
  console.log('DB_NAME_SERVER:', process.env.DB_NAME_SERVER);
  console.log('DB_PORT:', process.env.DB_PORT);
  console.log('NODE_ENV:', process.env.NODE_ENV);
  
  try {
    const db = await getAdminConnection();
    const result = await db.raw('SELECT current_database()');
    console.log('Connected to database:', result.rows[0].current_database);
    
    const tables = await db.raw("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'workflow%' ORDER BY tablename");
    console.log('Workflow tables:', tables.rows.map(r => r.tablename));
    
    await db.destroy();
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testConnection();
