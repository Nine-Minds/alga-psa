const { execSync } = require('child_process');

try {
  // Run seeds
  console.log('Running all seeds...');
  execSync('NODE_ENV=migration npx knex --knexfile /app/server/knexfile.cjs seed:run', { 
    stdio: 'inherit'
  });

  console.log('Seeds completed successfully');
} catch (error) {
  console.error('Error during seeding:', error);
  process.exit(1);
}
