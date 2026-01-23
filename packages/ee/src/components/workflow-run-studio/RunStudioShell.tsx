'use client';

import React from 'react';

export default function RunStudioShell({ runId }: { runId: string }) {
  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="text-center max-w-2xl">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Enterprise Feature</h2>
        <p className="text-gray-600">
          Workflow run studio is only available in the Enterprise Edition.
        </p>
        <p className="text-sm text-gray-500 mt-3">Run id: {runId || '—'}</p>
      </div>
    </div>
  );
}

