"use client";

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { DynamicWorkflowComponent } from '@alga-psa/workflows/components/WorkflowComponentLoader';
import type { WorkflowProps } from '@alga-psa/workflows/components/WorkflowComponentLoader';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface WorkflowAutomationGateProps {
  workflowProps: WorkflowProps;
}

export default function WorkflowAutomationGate({ workflowProps }: WorkflowAutomationGateProps) {
  const { t } = useTranslation('msp/workflows');
  const router = useRouter();
  const { status } = useSession();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/msp/signin');
    }
  }, [router, status]);

  if (status === 'loading' || status === 'unauthenticated') {
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

  return (
    <div className="h-full">
      <DynamicWorkflowComponent {...workflowProps} />
    </div>
  );
}
