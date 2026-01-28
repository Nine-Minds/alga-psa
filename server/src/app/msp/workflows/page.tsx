"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { getCurrentUser } from '@alga-psa/users/actions';
import { DynamicWorkflowComponent } from '@alga-psa/workflows/components/WorkflowComponentLoader';
import { isExperimentalFeatureEnabled } from '@alga-psa/tenancy/actions';

export default function WorkflowsPage() {
  const router = useRouter();
  const [workflowAutomationEnabled, setWorkflowAutomationEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const user = await getCurrentUser();
        if (!user) {
          router.push('/auth/msp/signin');
          return;
        }
      } catch (error) {
        console.error('Authentication check failed:', error);
        router.push('/auth/msp/signin');
        return;
      }

      try {
        const enabled = await isExperimentalFeatureEnabled('workflowAutomation');
        setWorkflowAutomationEnabled(enabled);
      } catch (error) {
        console.error('[WorkflowsPage] Failed to check workflowAutomation feature flag', error);
        setWorkflowAutomationEnabled(false);
      }
    };

    void bootstrap();
  }, [router]);

  if (workflowAutomationEnabled === null) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingIndicator layout="stacked" text="Loading workflow automation..." spinnerProps={{ size: 'md' }} />
      </div>
    );
  }

  if (!workflowAutomationEnabled) {
    return (
      <div className="h-full">
        <Card className="p-6">
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Workflow Automation</h2>
              <p className="text-sm text-gray-600">
                This feature is experimental and is not enabled for your tenant.
              </p>
            </div>
            <Alert
              variant="warning"
              className="text-[rgba(255,174,0,1)] [&>svg]:text-[rgba(255,174,0,1)]"
            >
              <AlertTitle>Experimental</AlertTitle>
              <AlertDescription>
                Enable Workflow Automation in Settings to access workflow automation features.
              </AlertDescription>
            </Alert>
            <div className="flex items-center gap-3">
              <Button id="enable-workflow-automation" asChild>
                <Link href="/msp/settings?tab=experimental-features">Go to Experimental Features</Link>
              </Button>
              <Link href="/msp/settings?tab=experimental-features" className="text-sm text-primary-600 hover:underline">
                Open settings
              </Link>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-full">
      <DynamicWorkflowComponent />
    </div>
  );
}
