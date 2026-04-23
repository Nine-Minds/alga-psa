"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { DynamicWorkflowComponent } from '@alga-psa/workflows/components/WorkflowComponentLoader';
import type { WorkflowProps } from '@alga-psa/workflows/components/WorkflowComponentLoader';
import { isExperimentalFeatureEnabled } from '@alga-psa/tenancy/actions';
import { TIER_FEATURES, FEATURE_MINIMUM_TIER } from '@alga-psa/types';
import { useTier } from 'server/src/context/TierContext';
import { FeatureUpgradeNotice } from '@alga-psa/ui/components/tier-gating/FeatureUpgradeNotice';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface WorkflowAutomationGateProps {
  workflowProps: WorkflowProps;
}

export default function WorkflowAutomationGate({ workflowProps }: WorkflowAutomationGateProps) {
  const { t } = useTranslation('msp/workflows');
  const router = useRouter();
  const { status } = useSession();
  const { hasFeature } = useTier();
  const [workflowAutomationEnabled, setWorkflowAutomationEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    if (status === 'loading') {
      return;
    }

    if (status === 'unauthenticated') {
      router.push('/auth/msp/signin');
      return;
    }

    let isMounted = true;

    const bootstrap = async () => {
      try {
        const enabled = await isExperimentalFeatureEnabled('workflowAutomation');
        if (isMounted) {
          setWorkflowAutomationEnabled(enabled);
        }
      } catch (error) {
        console.error('[WorkflowAutomationGate] Failed to check workflowAutomation feature flag', error);
        if (isMounted) {
          setWorkflowAutomationEnabled(false);
        }
      }
    };

    void bootstrap();
    return () => {
      isMounted = false;
    };
  }, [router, status]);

  if (status === 'loading' || workflowAutomationEnabled === null) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingIndicator
          layout="stacked"
          text={t('automationGate.loading', { defaultValue: 'Loading workflow automation...' })}
          spinnerProps={{ size: 'md' }}
        />
      </div>
    );
  }

  if (!hasFeature(TIER_FEATURES.WORKFLOW_DESIGNER)) {
    return (
      <div className="h-full p-6">
        <FeatureUpgradeNotice
          featureName={t('automationGate.featureName', { defaultValue: 'Workflow Automation' })}
          requiredTier={FEATURE_MINIMUM_TIER[TIER_FEATURES.WORKFLOW_DESIGNER]}
        />
      </div>
    );
  }

  if (!workflowAutomationEnabled) {
    return (
      <div className="h-full">
        <Card className="p-6">
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                {t('automationGate.featureName', { defaultValue: 'Workflow Automation' })}
              </h2>
              <p className="text-sm text-gray-600">
                {t('automationGate.notEnabled', { defaultValue: 'This feature is experimental and is not enabled for your tenant.' })}
              </p>
            </div>
            <Alert variant="warning">
              <AlertTitle>{t('automationGate.experimental', { defaultValue: 'Experimental' })}</AlertTitle>
              <AlertDescription>
                {t('automationGate.enableHint', { defaultValue: 'Enable Workflow Automation in Settings to access workflow automation features.' })}
              </AlertDescription>
            </Alert>
            <div className="flex items-center gap-3">
              <Button id="enable-workflow-automation" asChild>
                <Link href="/msp/settings?tab=experimental-features">
                  {t('automationGate.goToExperimental', { defaultValue: 'Go to Experimental Features' })}
                </Link>
              </Button>
              <Link href="/msp/settings?tab=experimental-features" className="text-sm text-primary-600 hover:underline">
                {t('automationGate.openSettings', { defaultValue: 'Open settings' })}
              </Link>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-full">
      <DynamicWorkflowComponent {...workflowProps} />
    </div>
  );
}
