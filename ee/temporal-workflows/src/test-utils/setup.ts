import { beforeAll, afterAll } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

beforeAll(async () => {
  console.log('Setting up test environment...');
  
  // Start Docker containers if not already running
  try {
    const { stdout } = await execAsync('docker-compose -f docker-compose.test.yml ps --format json');
    const containers = stdout.trim().split('\n').map(line => JSON.parse(line));
    const runningContainers = containers.filter(c => c.State === 'running');
    
    if (runningContainers.length < 3) {
      console.log('Starting Docker containers...');
      await execAsync('docker-compose -f docker-compose.test.yml up -d');
      
      // Wait for Temporal to be ready
      console.log('Waiting for Temporal to be ready...');
      let attempts = 0;
      const maxAttempts = 30;
      
      while (attempts < maxAttempts) {
        try {
          const { stdout: healthCheck } = await execAsync('curl -f http://localhost:8233/health || echo "not ready"');
          if (!healthCheck.includes('not ready')) {
            console.log('Temporal is ready!');
            break;
          }
        } catch (error) {
          // Expected when Temporal is not ready
        }
        
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        if (attempts === maxAttempts) {
          throw new Error('Temporal failed to start within timeout');
        }
      }
    }
  } catch (error) {
    console.error('Failed to setup test environment:', error);
    throw error;
  }
}, 60000); // 1 minute timeout

afterAll(async () => {
  // Keep containers running for multiple test runs
  console.log('Test environment cleanup complete (containers left running for reuse)');
});