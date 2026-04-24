"use client";

import React from 'react';
import { useParams } from 'next/navigation';
import RunStudioShell from '@enterprise/components/workflow-run-studio/RunStudioShell';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export default function WorkflowRunStudioPage() {
  const { t } = useTranslation('common');
  const params = useParams();
  const runId = typeof params?.runId === 'string' ? params.runId : Array.isArray(params?.runId) ? params.runId[0] : '';

  if (!runId) {
    return <div className="p-6 text-sm text-gray-500">{t('pages.errors.missingRunId')}</div>;
  }

  return <RunStudioShell runId={runId} />;
}
