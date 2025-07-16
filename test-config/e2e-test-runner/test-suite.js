#!/usr/bin/env node
/**
 * E2E Test Suite for Alga PSA Email Processing
 * 
 * This test suite validates the complete email processing workflow:
 * 1. Email ingestion via MailHog
 * 2. Workflow processing via workflow worker
 * 3. Ticket creation in the database
 */

import { TestOrchestrator } from './lib/test-orchestrator.js';
import { EmailProcessor } from './lib/email-processor.js';
import { WorkflowValidator } from './lib/workflow-validator.js';
import { DatabaseValidator } from './lib/database-validator.js';

class E2ETestSuite {
  constructor() {
    this.orchestrator = new TestOrchestrator();
    this.emailProcessor = new EmailProcessor();
    this.workflowValidator = new WorkflowValidator();
    this.databaseValidator = new DatabaseValidator();
    
    this.results = {
      total: 0,
      passed: 0,
      failed: 0,
      tests: []
    };
  }

  async runTest(name, testFn) {
    console.log(`\n🧪 Running test: ${name}`);
    this.results.total++;
    
    try {
      const startTime = Date.now();
      await testFn();
      const duration = Date.now() - startTime;
      
      console.log(`✅ PASSED: ${name} (${duration}ms)`);
      this.results.passed++;
      this.results.tests.push({ name, status: 'PASSED', duration });
    } catch (error) {
      console.log(`❌ FAILED: ${name}`);
      console.log(`   Error: ${error.message}`);
      this.results.failed++;
      this.results.tests.push({ name, status: 'FAILED', error: error.message });
    }
  }

  async run() {
    console.log('🚀 Starting Alga PSA E2E Test Suite');
    console.log('=====================================');

    // Setup
    await this.runTest('Setup Test Environment', async () => {
      await this.orchestrator.setup();
    });

    // Infrastructure Tests
    await this.runTest('Verify Infrastructure Health', async () => {
      await this.orchestrator.verifyInfrastructure();
    });

    // Email Processing Tests
    await this.runTest('Send Test Email', async () => {
      await this.emailProcessor.sendTestEmail({
        from: 'test@example.com',
        to: 'support@company.com',
        subject: 'E2E Test Email',
        body: 'This is a test email for E2E testing'
      });
    });

    await this.runTest('Verify Email Captured by MailHog', async () => {
      await this.emailProcessor.verifyEmailCaptured();
    });

    // Workflow Processing Tests
    await this.runTest('Verify Workflow Event Creation', async () => {
      await this.workflowValidator.verifyEventCreation();
    });

    await this.runTest('Verify Workflow Processing', async () => {
      await this.workflowValidator.verifyEventProcessing();
    });

    // Database Validation Tests
    await this.runTest('Verify Ticket Creation', async () => {
      await this.databaseValidator.verifyTicketCreation();
    });

    await this.runTest('Verify Email Threading', async () => {
      await this.databaseValidator.verifyEmailThreading();
    });

    // Cleanup
    await this.runTest('Cleanup Test Data', async () => {
      await this.orchestrator.cleanup();
    });

    // Print Results
    this.printResults();
  }

  printResults() {
    console.log('\n📊 Test Results Summary');
    console.log('=======================');
    console.log(`Total Tests: ${this.results.total}`);
    console.log(`Passed: ${this.results.passed}`);
    console.log(`Failed: ${this.results.failed}`);
    console.log(`Success Rate: ${((this.results.passed / this.results.total) * 100).toFixed(1)}%`);
    
    if (this.results.failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.results.tests
        .filter(test => test.status === 'FAILED')
        .forEach(test => {
          console.log(`   - ${test.name}: ${test.error}`);
        });
    }

    console.log('\n' + (this.results.failed === 0 ? '🎉 All tests passed!' : '💥 Some tests failed!'));
    process.exit(this.results.failed === 0 ? 0 : 1);
  }
}

// Run the test suite
if (import.meta.url === `file://${process.argv[1]}`) {
  const suite = new E2ETestSuite();
  suite.run().catch(error => {
    console.error('💥 Test suite failed to run:', error);
    process.exit(1);
  });
}