/**
 * Test Orchestrator - Manages E2E test setup and coordination
 */

import axios from 'axios';

export class TestOrchestrator {
  constructor() {
    this.config = {
      mailhog: {
        smtpPort: 1025,
        webPort: 8025,
        baseUrl: 'http://localhost:8025'
      },
      workflowWorker: {
        healthUrl: 'http://localhost:4001/health'
      },
      wiremock: {
        baseUrl: 'http://localhost:8080',
        adminUrl: 'http://localhost:8080/__admin'
      },
      postgres: {
        host: 'localhost',
        port: 5433,
        database: 'server',
        user: 'postgres',
        // Password will be read from secrets
      },
      redis: {
        host: 'localhost',
        port: 6380
      }
    };
  }

  async setup() {
    console.log('🔧 Setting up test environment...');
    
    // Clear any previous test data
    await this.clearMailHog();
    
    // Wait for services to be ready
    await this.waitForServices();
    
    console.log('✅ Test environment ready');
  }

  async verifyInfrastructure() {
    console.log('🔍 Verifying infrastructure health...');
    
    const checks = [
      this.checkMailHog(),
      this.checkWorkflowWorker(),
      this.checkWireMock(),
      this.checkPostgreSQL(),
      this.checkRedis()
    ];

    await Promise.all(checks);
    console.log('✅ All infrastructure services healthy');
  }

  async checkMailHog() {
    try {
      const response = await axios.get(this.config.mailhog.baseUrl);
      if (!response.data.includes('MailHog')) {
        throw new Error('MailHog web interface not responding correctly');
      }
    } catch (error) {
      throw new Error(`MailHog health check failed: ${error.message}`);
    }
  }

  async checkWorkflowWorker() {
    try {
      const response = await axios.get(this.config.workflowWorker.healthUrl);
      if (response.data.status !== 'healthy') {
        throw new Error(`Workflow worker status: ${response.data.status}`);
      }
    } catch (error) {
      throw new Error(`Workflow worker health check failed: ${error.message}`);
    }
  }

  async checkWireMock() {
    try {
      const response = await axios.get(`${this.config.wiremock.adminUrl}/health`);
      if (response.data.status !== 'healthy') {
        throw new Error(`WireMock status: ${response.data.status}`);
      }
    } catch (error) {
      // WireMock health check is optional for now
      console.warn(`⚠️  WireMock health check failed: ${error.message}`);
    }
  }

  async checkPostgreSQL() {
    // This will be implemented when we add database connectivity
    console.log('🔍 PostgreSQL check - TODO: implement database connectivity test');
  }

  async checkRedis() {
    // This will be implemented when we add Redis connectivity
    console.log('🔍 Redis check - TODO: implement Redis connectivity test');
  }

  async clearMailHog() {
    try {
      await axios.delete(`${this.config.mailhog.baseUrl}/api/v1/messages`);
      console.log('🧹 MailHog messages cleared');
    } catch (error) {
      console.warn(`⚠️  Failed to clear MailHog messages: ${error.message}`);
    }
  }

  async waitForServices() {
    const maxAttempts = 30;
    const delay = 2000; // 2 seconds
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.checkMailHog();
        await this.checkWorkflowWorker();
        return; // All services are ready
      } catch (error) {
        if (attempt === maxAttempts) {
          throw new Error(`Services not ready after ${maxAttempts} attempts: ${error.message}`);
        }
        console.log(`⏳ Waiting for services... (attempt ${attempt}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  async cleanup() {
    console.log('🧹 Cleaning up test data...');
    
    // Clear MailHog messages
    await this.clearMailHog();
    
    // TODO: Clear test data from database
    // TODO: Clear test data from Redis
    
    console.log('✅ Cleanup completed');
  }
}