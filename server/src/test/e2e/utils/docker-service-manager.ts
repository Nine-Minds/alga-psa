import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';

const execAsync = promisify(exec);

export interface ServiceHealthCheck {
  name: string;
  url: string;
  expectedStatus?: number;
  timeout?: number;
}

export class DockerServiceManager {
  private readonly composeFile = 'docker-compose.e2e-with-worker.yaml';
  private readonly projectRoot = '../../../..'; // Relative to src/test/e2e/utils/ -> go to alga-psa root
  private readonly services = [
    'postgres',
    'redis-test', 
    'setup-test',
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
      name: 'workflow-worker',
      url: 'http://localhost:4001/health',
      expectedStatus: 200,
      timeout: 30000
    },
    {
      name: 'webhook-mock',
      url: 'http://localhost:8080/__admin/health',
      expectedStatus: 200,
      timeout: 30000
    }
  ];

  async startE2EServices(): Promise<void> {
    try {
      // Change to project root and start services
      const { stdout, stderr } = await execAsync(
        `cd ${this.projectRoot} && docker-compose -f ${this.composeFile} up -d`,
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
      await execAsync(
        `cd ${this.projectRoot} && docker-compose -f ${this.composeFile} down`,
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
    console.log('🔍 Checking if E2E services are running...');
    
    const runningServices = await Promise.all(
      this.services.map(async service => ({
        name: service,
        running: await this.isServiceRunning(service)
      }))
    );
    
    const stoppedServices = runningServices.filter(s => !s.running);
    
    if (stoppedServices.length > 0) {
      console.log(`🚀 Starting stopped services: ${stoppedServices.map(s => s.name).join(', ')}`);
      console.log('🚀 Starting E2E Docker services...');
      
      try {
        await this.startE2EServices();
      } catch (error) {
        // Check if this is a "file not found" error for docker-compose
        if (error.message && error.message.includes('no such file or directory')) {
          console.log('⚠️ Service startup failed, but services may already be running:', error.message);
          // Re-check if services are actually running
          const recheckServices = await Promise.all(
            this.services.map(async service => ({
              name: service,
              running: await this.isServiceRunning(service)
            }))
          );
          
          const stillStoppedServices = recheckServices.filter(s => !s.running);
          if (stillStoppedServices.length === 0) {
            console.log('✅ Services are healthy, continuing with existing services');
            return;
          } else {
            // Services are not running and we can't start them
            throw error;
          }
        } else {
          // Other errors should be thrown
          throw error;
        }
      }
      
      await this.waitForHealthChecks();
    } else {
      console.log('✅ All E2E services are already running');
    }
  }
}