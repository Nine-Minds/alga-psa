'use client';

import { useState } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Card } from 'server/src/components/ui/Card';
import { OnboardingWizard } from 'server/src/components/onboarding/OnboardingWizard';

export default function OnboardingTestPage() {
  const [showWizard, setShowWizard] = useState(false);
  const [completedData, setCompletedData] = useState<any>(null);

  // Only allow in development
  if (process.env.NODE_ENV !== 'development') {
    return (
      <div className="container mx-auto p-8">
        <Card className="p-6">
          <h1 className="text-xl font-semibold mb-4">Access Denied</h1>
          <p>This page is only available in development mode.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6">Onboarding Wizard Test Harness</h1>
      
      <Card className="p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Test Controls</h2>
        <div className="space-y-4">
          <div className="space-x-4">
            <Button onClick={() => setShowWizard(true)}>
              Launch Onboarding Wizard
            </Button>
            
            <Button 
              variant="outline"
              onClick={() => {
                setShowWizard(true);
                // You could pass different props for different test scenarios
              }}
            >
              Launch with Debug Mode
            </Button>
          </div>

          <p className="text-sm text-gray-600">
            Click the button above to test the onboarding wizard flow. The wizard runs in test mode, 
            so no actual data will be saved to the database.
          </p>
        </div>
      </Card>

      {completedData && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Completed Data</h2>
          <div className="bg-gray-50 p-4 rounded">
            <pre className="text-xs overflow-auto whitespace-pre-wrap">
              {JSON.stringify(completedData, null, 2)}
            </pre>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            className="mt-4"
            onClick={() => setCompletedData(null)}
          >
            Clear Data
          </Button>
        </Card>
      )}

      <OnboardingWizard
        open={showWizard}
        onOpenChange={setShowWizard}
        testMode={true}
        debugMode={showWizard} // Enable debug mode when launched
        initialData={{
          // Pre-fill some test data if needed
          companyName: 'Test Company',
          email: 'test@example.com'
        }}
        onComplete={(data) => {
          console.log('Wizard completed:', data);
          setCompletedData(data);
          setShowWizard(false);
        }}
      />
    </div>
  );
}