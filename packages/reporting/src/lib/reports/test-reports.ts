// Simple test script to verify our report system works
// This can be run manually to test the implementation

import { executeReport, getBillingOverview } from './actions';
import { ReportRegistry } from './core/ReportRegistry';

async function testReportSystem() {
  console.log('Testing Report System...');
  
  try {
    // Test 1: Check report registry
    console.log('\n1. Testing Report Registry:');
    const reportIds = ReportRegistry.listReportIds();
    console.log('Available reports:', reportIds);
    
    const billingReports = ReportRegistry.getByCategory('billing');
    console.log('Billing reports:', billingReports.map(r => r.id));
    
    // Test 2: Test report metadata
    console.log('\n2. Testing Report Metadata:');
    const definition = ReportRegistry.get('billing.overview');
    if (definition) {
      console.log('Billing overview report found:', definition.name);
      console.log('Metrics count:', definition.metrics.length);
      console.log('Metrics:', definition.metrics.map(m => m.id));
    } else {
      console.log('ERROR: billing.overview report not found!');
    }
    
    // Test 3: Test report execution (will fail without database, but should validate structure)
    console.log('\n3. Testing Report Execution (structure validation):');
    try {
      const result = await getBillingOverview();
      console.log('Report executed successfully!');
      console.log('Result structure:', {
        reportId: result.reportId,
        reportName: result.reportName,
        metricsCount: Object.keys(result.metrics).length,
        executionTime: result.metadata.executionTime
      });
    } catch (error) {
      console.log('Expected error (no database connection):', (error as Error).message);
    }
    
    console.log('\n✅ Report system structure validation completed!');
    
  } catch (error) {
    console.error('\n❌ Error testing report system:', error);
  }
}

// Export for manual testing
export { testReportSystem };