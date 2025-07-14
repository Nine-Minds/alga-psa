#!/usr/bin/env node

/**
 * Test Harness Management Script
 * 
 * This script provides commands to manage the persistent E2E test harness:
 * - start: Start all test services and keep them running
 * - stop: Stop all test services
 * - restart: Restart all test services
 * - status: Check status of all test services
 * - logs: Show logs from test services
 */

import { execSync, spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Docker compose file for E2E tests
const COMPOSE_FILE = path.join(projectRoot, 'docker-compose.e2e-with-worker.yaml');
const COMPOSE_PROJECT_NAME = 'alga-psa-e2e-test';

class TestHarness {
  constructor() {
    this.services = [
      { name: 'postgres', port: 5433, path: '/', expectedStatus: ['connection established', 'database system is ready'] },
      { name: 'redis-test', port: 6380, path: '/', expectedStatus: ['PONG'] },
      { name: 'mailhog', port: 8025, path: '/', expectedStatus: ['200'] },
      { name: 'workflow-worker-test', port: 4001, path: '/health', expectedStatus: ['200'] },
      { name: 'webhook-mock', port: 8080, path: '/__admin/health', expectedStatus: ['200'] }
    ];
  }

  /**
   * Execute docker-compose command
   */
  dockerCompose(args, options = {}) {
    const cmd = `docker-compose -f "${COMPOSE_FILE}" -p ${COMPOSE_PROJECT_NAME} ${args}`;
    console.log(`🐳 Running: ${cmd}`);
    
    if (options.stdio) {
      return execSync(cmd, { stdio: options.stdio, cwd: projectRoot });
    } else {
      return execSync(cmd, { encoding: 'utf8', cwd: projectRoot });
    }
  }

  /**
   * Start all test services
   */
  async start() {
    console.log('🚀 Starting persistent E2E test harness...\n');

    try {
      // Check if Docker is running
      try {
        execSync('docker info', { stdio: 'pipe' });
      } catch (error) {
        console.error('❌ Docker is not running. Please start Docker first.');
        process.exit(1);
      }

      // Stop any existing services
      console.log('🛑 Stopping any existing test services...');
      try {
        this.dockerCompose('down --remove-orphans');
      } catch (error) {
        // Ignore errors if nothing is running
      }

      // Build and start services
      console.log('🏗️  Building and starting test services...');
      this.dockerCompose('up -d --build', { stdio: 'inherit' });

      // Wait for services to be healthy
      console.log('\n⏳ Waiting for services to become healthy...');
      await this.waitForServices();

      console.log('\n✅ Test harness is ready!');
      console.log('\n📋 Service Status:');
      await this.status();

      console.log('\n🧪 You can now run tests with:');
      console.log('   npm test src/test/e2e/email-processing.test.ts');
      console.log('\n🔧 Use these commands to manage the harness:');
      console.log('   npm run test:harness:status  - Check service status');
      console.log('   npm run test:harness:logs    - View service logs');
      console.log('   npm run test:harness:stop    - Stop all services');

    } catch (error) {
      console.error('❌ Failed to start test harness:', error.message);
      process.exit(1);
    }
  }

  /**
   * Stop all test services
   */
  stop() {
    console.log('🛑 Stopping E2E test harness...\n');
    
    try {
      this.dockerCompose('down --remove-orphans --volumes');
      console.log('✅ Test harness stopped successfully');
    } catch (error) {
      console.error('❌ Failed to stop test harness:', error.message);
      process.exit(1);
    }
  }

  /**
   * Restart all test services
   */
  async restart() {
    console.log('🔄 Restarting E2E test harness...\n');
    this.stop();
    await new Promise(resolve => setTimeout(resolve, 2000)); // Brief pause
    await this.start();
  }

  /**
   * Check status of all test services
   */
  async status() {
    console.log('📊 Test Harness Service Status:\n');

    try {
      const output = this.dockerCompose('ps --format json');
      const containers = JSON.parse(`[${output.trim().split('\n').join(',')}]`);

      for (const service of this.services) {
        const container = containers.find(c => c.Service === service.name);
        
        if (!container) {
          console.log(`❌ ${service.name.padEnd(20)} - Not running`);
          continue;
        }

        const isRunning = container.State === 'running';
        const healthStatus = await this.checkServiceHealth(service);
        
        const status = isRunning && healthStatus.healthy ? '✅' : '❌';
        const details = isRunning ? 
          (healthStatus.healthy ? 'Healthy' : `Unhealthy: ${healthStatus.error}`) : 
          'Not running';
        
        console.log(`${status} ${service.name.padEnd(20)} - ${details}`);
      }

    } catch (error) {
      console.error('❌ Failed to check service status:', error.message);
    }
  }

  /**
   * Show logs from test services
   */
  logs(serviceName = null) {
    console.log('📜 Test Harness Logs:\n');
    
    try {
      const args = serviceName ? `logs -f ${serviceName}` : 'logs -f';
      this.dockerCompose(args, { stdio: 'inherit' });
    } catch (error) {
      console.error('❌ Failed to show logs:', error.message);
    }
  }

  /**
   * Wait for all services to become healthy
   */
  async waitForServices(timeout = 120000) {
    const startTime = Date.now();
    const checkInterval = 2000; // Check every 2 seconds

    while (Date.now() - startTime < timeout) {
      let allHealthy = true;

      for (const service of this.services) {
        const health = await this.checkServiceHealth(service);
        if (!health.healthy) {
          allHealthy = false;
          console.log(`⏳ Waiting for ${service.name}... (${health.error})`);
          break;
        }
      }

      if (allHealthy) {
        return;
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    throw new Error(`Services did not become healthy within ${timeout}ms`);
  }

  /**
   * Check health of a specific service
   */
  async checkServiceHealth(service) {
    try {
      const response = await fetch(`http://localhost:${service.port}${service.path}`, {
        method: 'GET',
        timeout: 5000
      });

      if (response.ok) {
        return { healthy: true };
      } else {
        return { healthy: false, error: `HTTP ${response.status}` };
      }
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }

  /**
   * Reset test data without restarting services
   */
  async resetData() {
    console.log('🧹 Resetting test data...\n');
    
    try {
      // Run database reset through the setup container
      this.dockerCompose('exec setup-test npm run db:reset');
      console.log('✅ Test data reset successfully');
    } catch (error) {
      console.error('❌ Failed to reset test data:', error.message);
    }
  }
}

// CLI Interface
const harness = new TestHarness();
const command = process.argv[2];

switch (command) {
  case 'start':
    await harness.start();
    break;
  
  case 'stop':
    harness.stop();
    break;
  
  case 'restart':
    await harness.restart();
    break;
  
  case 'status':
    await harness.status();
    break;
  
  case 'logs':
    const serviceName = process.argv[3];
    harness.logs(serviceName);
    break;
  
  case 'reset-data':
    await harness.resetData();
    break;
  
  default:
    console.log('🧪 E2E Test Harness Management\n');
    console.log('Usage: npm run test:harness:<command>\n');
    console.log('Commands:');
    console.log('  start      - Start all test services and keep them running');
    console.log('  stop       - Stop all test services');
    console.log('  restart    - Restart all test services');
    console.log('  status     - Check status of all test services');
    console.log('  logs [svc] - Show logs (optionally for specific service)');
    console.log('  reset-data - Reset test data without restarting services');
    console.log('\nExamples:');
    console.log('  npm run test:harness:start');
    console.log('  npm run test:harness:status');
    console.log('  npm run test:harness:logs mailhog');
    break;
}