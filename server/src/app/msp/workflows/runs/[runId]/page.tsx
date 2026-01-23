"use client";

import React from 'react';
import { useParams } from 'next/navigation';
import RunStudioShell from '@ee/components/workflow-run-studio/RunStudioShell';

export default function WorkflowRunStudioPage() {
  const params = useParams();
  const runId = typeof params?.runId === 'string' ? params.runId : Array.isArray(params?.runId) ? params.runId[0] : '';

  if (!runId) {
    return <div className="p-6 text-sm text-gray-500">Missing run id.</div>;
  }

  return <RunStudioShell runId={runId} />;
}
