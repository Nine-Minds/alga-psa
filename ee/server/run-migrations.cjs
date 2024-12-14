const { execSync } = require('child_process');

try {
  // Run migrations
  console.log('Running all migrations...');
  execSync('NODE_ENV=migration npx knex --knexfile /app/server/knexfile.cjs migrate:latest', { 
    stdio: 'inherit'
  });

  console.log('Migrations completed successfully');
} catch (error) {
  console.error('Error during migration:', error);
  process.exit(1);
}
