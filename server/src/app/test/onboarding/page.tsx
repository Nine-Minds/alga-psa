'use client';

import { useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { OnboardingWizard } from '@alga-psa/onboarding/components';

export default function OnboardingTestPage() {
  const [showWizard, setShowWizard] = useState(false);
  const [completedData, setCompletedData] = useState<any>(null);

  // Only allow in development
  if (process.env.NODE_ENV !== 'development') {
    return (
      <div className="container mx-auto p-8">
        <h1 className="text-2xl font-bold mb-4">Access Denied</h1>
        <p>This page is only available in development mode.</p>
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
            <Button id="launch-wizard" onClick={() => setShowWizard(true)}>
              Launch Onboarding Wizard
            </Button>
            
            <Button 
              id="launch-prefilled"
              variant="outline"
              onClick={() => {
                setShowWizard(true);
                // This will be handled by the initialData prop
              }}
            >
              Launch with Pre-filled Data
            </Button>

            {completedData && (
              <Button 
                id="clear-results"
                variant="ghost"
                onClick={() => setCompletedData(null)}
              >
                Clear Results
              </Button>
            )}
          </div>

          <div className="text-sm text-gray-600">
            <p>Test mode is enabled - no API calls will be made.</p>
            <p>Debug mode shows additional information in the wizard.</p>
          </div>
        </div>
      </Card>

      {completedData && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Completed Data</h2>
          <div className="bg-gray-100 p-4 rounded overflow-auto max-h-96">
            <pre className="text-sm">
              {JSON.stringify(completedData, null, 2)}
            </pre>
          </div>
        </Card>
      )}

      <OnboardingWizard
        open={showWizard}
        onOpenChange={setShowWizard}
        testMode={true}
        debugMode={true}
        initialData={
          // Pre-fill some test data when using the second button
          showWizard && window.location.hash === '#prefilled' ? {
            firstName: 'Test',
            lastName: 'User',
            clientName: 'Test Client',
            email: 'test@example.com'
          } : undefined
        }
        onComplete={(data) => {
          console.log('Wizard completed:', data);
          setCompletedData(data);
          setShowWizard(false);
        }}
      />
    </div>
  );
}
