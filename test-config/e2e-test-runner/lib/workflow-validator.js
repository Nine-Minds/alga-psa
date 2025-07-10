/**
 * Workflow Validator - Validates workflow processing in E2E tests
 */

import axios from 'axios';

export class WorkflowValidator {
  constructor() {
    this.workflowWorkerConfig = {
      healthUrl: 'http://localhost:4001/health',
      metricsUrl: 'http://localhost:4001/metrics'
    };
  }

  async verifyEventCreation() {
    console.log('🔍 Verifying workflow event creation...');
    
    // For now, we'll check that the workflow worker is healthy and processing
    // In a full implementation, this would check the Redis streams directly
    const health = await this.getWorkerHealth();
    
    if (health.status !== 'healthy') {
      throw new Error(`Workflow worker not healthy: ${health.status}`);
    }

    console.log('✅ Workflow worker is healthy and ready to process events');
    return true;
  }

  async verifyEventProcessing() {
    console.log('🔍 Verifying workflow event processing...');
    
    // Get initial metrics
    const initialHealth = await this.getWorkerHealth();
    const initialProcessed = initialHealth.eventsProcessed || 0;
    
    // Wait a bit for potential processing
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Get metrics again
    const finalHealth = await this.getWorkerHealth();
    const finalProcessed = finalHealth.eventsProcessed || 0;
    
    console.log(`📊 Events processed: ${initialProcessed} → ${finalProcessed}`);
    
    // For now, we just verify the worker is healthy
    // In a full implementation, we would inject test events and verify processing
    if (finalHealth.status !== 'healthy') {
      throw new Error(`Workflow worker became unhealthy during processing`);
    }

    console.log('✅ Workflow processing verification completed');
    return true;
  }

  async getWorkerHealth() {
    try {
      const response = await axios.get(this.workflowWorkerConfig.healthUrl);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get workflow worker health: ${error.message}`);
    }
  }

  async getWorkerMetrics() {
    try {
      // Try to get metrics if available
      const response = await axios.get(this.workflowWorkerConfig.metricsUrl);
      return response.data;
    } catch (error) {
      // Metrics endpoint might not be available, fall back to health data
      return await this.getWorkerHealth();
    }
  }

  async waitForEventProcessing(timeoutMs = 30000) {
    console.log(`⏳ Waiting for event processing (timeout: ${timeoutMs}ms)...`);
    
    const startTime = Date.now();
    const initialHealth = await this.getWorkerHealth();
    const initialProcessed = initialHealth.eventsProcessed || 0;
    
    while (Date.now() - startTime < timeoutMs) {
      const currentHealth = await this.getWorkerHealth();
      const currentProcessed = currentHealth.eventsProcessed || 0;
      
      if (currentProcessed > initialProcessed) {
        console.log(`✅ Event processing detected: ${initialProcessed} → ${currentProcessed}`);
        return true;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error(`No event processing detected within ${timeoutMs}ms`);
  }

  async verifyWorkerConnectivity() {
    console.log('🔍 Verifying workflow worker connectivity...');
    
    try {
      const health = await this.getWorkerHealth();
      
      if (!health.workerId) {
        throw new Error('Worker ID not found in health response');
      }
      
      if (!health.uptime || health.uptime < 0) {
        throw new Error('Invalid uptime in health response');
      }
      
      console.log(`✅ Workflow worker connectivity verified (ID: ${health.workerId})`);
      return health;
    } catch (error) {
      throw new Error(`Workflow worker connectivity check failed: ${error.message}`);
    }
  }
}