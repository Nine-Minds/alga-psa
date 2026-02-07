import { beforeAll, afterAll } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as dotenv from 'dotenv';
import path from 'path';

const execAsync = promisify(exec);

// Load test environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.test') });

beforeAll(async () => {
  if (process.env.TEMPORAL_TEST_SKIP_ENV_BOOTSTRAP === '1') {
    console.log('Skipping Temporal test environment bootstrap (TEMPORAL_TEST_SKIP_ENV_BOOTSTRAP=1)');
    return;
  }

  console.log('Setting up test environment...');
  
  // Check if Temporal dev server is already running (started by test script)
  try {
    await execAsync('temporal workflow list');
    console.log('Temporal dev server is already running!');
    return;
  } catch (error) {
    // Temporal dev server not running, start Docker containers as fallback
    console.log('Temporal dev server not detected, starting Docker containers...');
  }
  
  // Start Docker containers if not already running
  try {
    const { stdout } = await execAsync('docker-compose -f docker-compose.test.yml ps --format json');
    let runningContainers = [];
    
    if (stdout.trim()) {
      const containers = stdout.trim().split('\n').map(line => JSON.parse(line));
      runningContainers = containers.filter(c => c.State === 'running');
    }
    
    if (runningContainers.length < 1) { // We have 1 service now (temporal only)
      console.log('Starting Docker containers...');
      await execAsync('docker-compose -f docker-compose.test.yml up -d');
      
      // Wait for Temporal to be ready
      console.log('Waiting for Temporal to be ready...');
      let attempts = 0;
      const maxAttempts = 30;
      
      while (attempts < maxAttempts) {
        try {
          await execAsync('temporal workflow list');
          console.log('Temporal is ready!');
          break;
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
