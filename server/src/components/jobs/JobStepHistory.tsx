'use client';

import { Card } from '@/components/ui/Card';
import type { JobDetail } from '@/services/job.service';

interface JobStepHistoryProps {
  steps: JobDetail[];
}

export default function JobStepHistory({ steps }: JobStepHistoryProps) {
  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-6">Job Steps</h3>
      <div className="space-y-4">
        {steps.map((step) => (
          <div key={step.id} className="p-4 bg-gray-50 rounded-lg">
            <div className="flex justify-between items-center mb-2">
              <div className="font-medium text-gray-900">{step.stepName}</div>
              <div className={`text-sm font-medium px-2 py-1 rounded ${
                step.status === 'completed' ? 'bg-green-100 text-green-700' :
                step.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'
              }`}>
                {step.status}
              </div>
            </div>
            {step.processedAt && (
              <div className="text-sm text-gray-600 mb-1">
                <span className="font-medium">Processed:</span> {new Date(step.processedAt).toLocaleString()}
              </div>
            )}
            {step.retryCount > 0 && (
              <div className="text-sm text-gray-600">
                <span className="font-medium">Retries:</span> {step.retryCount}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
