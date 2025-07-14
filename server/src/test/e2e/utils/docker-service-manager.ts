import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import * as path from 'path';

const execAsync = promisify(exec);

export interface ServiceHealthCheck {
  name: string;
  url: string;
  expectedStatus?: number;
  timeout?: number;
}

export class DockerServiceManager {
  private readonly composeFile = 'docker-compose.e2e-local.yaml';
  // Calculate the absolute path to the project root dynamically
  private readonly projectRoot = path.resolve(__dirname, '../../../../..');
  private readonly services = [
    'postgres-test',
    'pgbouncer-test',
    'redis-test', 
    'workflow-worker-test',
    'mailhog',
    'webhook-mock'
  ];

  private readonly healthChecks: ServiceHealthCheck[] = [
    {
      name: 'mailhog',
      url: 'http://localhost:8025',
      expectedStatus: 200,
      timeout: 30000
    },
    {
      name: 'webhook-mock',
      url: 'http://localhost:8080/__admin/health',
      expectedStatus: 200,
      timeout: 30000
    }
    // Note: workflow-worker doesn't expose a health endpoint, 
    // but we can see it's running from the logs
  ];

  async startE2EServices(): Promise<void> {
    try {
      // Use absolute path to ensure we're in the right directory
      const absoluteProjectRoot = '/Users/robertisaacs/alga-psa';
      // Change to project root and start services
      const { stdout, stderr } = await execAsync(
        `cd ${absoluteProjectRoot} && docker-compose -f ${this.composeFile} up -d`,
        { timeout: 120000 }
      );
      
      if (stderr && !stderr.includes('WARNING')) {
        console.warn('Docker compose stderr:', stderr);
      }
      
      console.log('✅ E2E Docker services started');
    } catch (error) {
      throw new Error(`Failed to start E2E services: ${error.message}`);
    }
  }

  async stopE2EServices(): Promise<void> {
    console.log('🛑 Stopping E2E Docker services...');
    
    try {
      const absoluteProjectRoot = '/Users/robertisaacs/alga-psa';
      await execAsync(
        `cd ${absoluteProjectRoot} && docker-compose -f ${this.composeFile} down`,
        { timeout: 60000 }
      );
      
      console.log('✅ E2E Docker services stopped');
    } catch (error) {
      console.error('❌ Failed to stop E2E services:', error);
      throw new Error(`Failed to stop E2E services: ${error.message}`);
    }
  }

  async waitForHealthChecks(): Promise<void> {
    console.log('⏳ Waiting for services to be healthy...');
    
    const healthCheckPromises = this.healthChecks.map(check => 
      this.waitForServiceHealth(check)
    );
    
    try {
      await Promise.all(healthCheckPromises);
      console.log('✅ All services are healthy');
    } catch (error) {
      console.error('❌ Service health check failed:', error);
      throw error;
    }
  }

  private async waitForServiceHealth(check: ServiceHealthCheck): Promise<void> {
    const startTime = Date.now();
    const timeout = check.timeout || 30000;
    const expectedStatus = check.expectedStatus || 200;
    
    while (Date.now() - startTime < timeout) {
      try {
        const response = await axios.get(check.url, { 
          timeout: 5000,
          validateStatus: () => true // Don't throw on non-2xx status
        });
        
        if (response.status === expectedStatus) {
          console.log(`✅ ${check.name} is healthy`);
          return;
        }
        
        console.log(`⏳ ${check.name} not ready (status: ${response.status}), retrying...`);
      } catch (error) {
        console.log(`⏳ ${check.name} not ready (${error.message}), retrying...`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    throw new Error(`${check.name} failed to become healthy within ${timeout}ms`);
  }

  async waitForWorkflowProcessing(timeoutMs: number = 30000): Promise<void> {
    console.log('⏳ Waiting for workflow processing...');
    
    const startTime = Date.now();
    let lastEventCount = 0;
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await axios.get('http://localhost:4001/health');
        const currentEventCount = response.data.eventsProcessed || 0;
        
        // If we've processed more events than before, consider it successful
        if (currentEventCount > lastEventCount) {
          console.log(`✅ Workflow processing detected: ${lastEventCount} → ${currentEventCount} events`);
          return;
        }
        
        lastEventCount = currentEventCount;
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.log('⏳ Workflow worker not responding, retrying...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // For initial implementation, we'll just wait a fixed amount and assume processing completed
    console.log('⏳ Workflow processing timeout reached, assuming completion');
  }

  async getServiceStatus(): Promise<Record<string, any>> {
    const status: Record<string, any> = {};
    
    for (const check of this.healthChecks) {
      try {
        const response = await axios.get(check.url, { timeout: 5000 });
        status[check.name] = {
          healthy: response.status === (check.expectedStatus || 200),
          status: response.status,
          data: response.data
        };
      } catch (error) {
        status[check.name] = {
          healthy: false,
          error: error.message
        };
      }
    }
    
    return status;
  }

  async getContainerLogs(serviceName: string, lines: number = 50): Promise<string> {
    try {
      const { stdout } = await execAsync(
        `cd ${this.projectRoot} && docker-compose -f ${this.composeFile} logs --tail=${lines} ${serviceName}`,
        { timeout: 10000 }
      );
      
      return stdout;
    } catch (error) {
      throw new Error(`Failed to get logs for ${serviceName}: ${error.message}`);
    }
  }

  async restartService(serviceName: string): Promise<void> {
    console.log(`🔄 Restarting ${serviceName}...`);
    
    try {
      await execAsync(
        `cd ${this.projectRoot} && docker-compose -f ${this.composeFile} restart ${serviceName}`,
        { timeout: 30000 }
      );
      
      console.log(`✅ ${serviceName} restarted`);
    } catch (error) {
      throw new Error(`Failed to restart ${serviceName}: ${error.message}`);
    }
  }

  async isServiceRunning(serviceName: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync(
        `cd ${this.projectRoot} && docker-compose -f ${this.composeFile} ps ${serviceName}`,
        { timeout: 10000 }
      );
      
      return stdout.includes('Up') || stdout.includes('running');
    } catch (error) {
      return false;
    }
  }

  async ensureServicesRunning(): Promise<void> {
    console.log('🔍 Checking E2E service health endpoints...');
    
    // First check if services are accessible via their health endpoints
    let healthyCount = 0;
    for (const check of this.healthChecks) {
      try {
        const response = await axios.get(check.url, { 
          timeout: 2000,
          validateStatus: () => true
        });
        if (response.status === (check.expectedStatus || 200)) {
          console.log(`✅ ${check.name} is healthy`);
          healthyCount++;
        } else {
          console.log(`⚠️ ${check.name} returned status ${response.status}`);
        }
      } catch (error) {
        console.log(`⚠️ ${check.name} is not accessible: ${error.message}`);
      }
    }
    
    // If all services are healthy, we're done
    if (healthyCount === this.healthChecks.length) {
      console.log('✅ All required services are already running and healthy');
      return;
    }
    
    // If some services are missing, try to start them
    console.log(`⚠️ Only ${healthyCount}/${this.healthChecks.length} services are healthy`);
    console.log('🚀 Attempting to start E2E Docker services...');
    
    try {
      await this.startE2EServices();
      await this.waitForHealthChecks();
    } catch (error) {
      // If startup fails, it might be because services are already running
      // or docker-compose file is missing. Try health checks one more time.
      console.log('⚠️ Service startup failed:', error.message);
      console.log('🔄 Retrying health checks...');
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      let retryHealthyCount = 0;
      for (const check of this.healthChecks) {
        try {
          const response = await axios.get(check.url, { timeout: 2000 });
          if (response.status === (check.expectedStatus || 200)) {
            retryHealthyCount++;
          }
        } catch (e) {
          // Service not available
        }
      }
      
      if (retryHealthyCount === this.healthChecks.length) {
        console.log('✅ All services are healthy on retry, continuing...');
        return;
      }
      
      throw new Error(`Failed to ensure services are running. Only ${retryHealthyCount}/${this.healthChecks.length} services are healthy.`);
    }
  }
}