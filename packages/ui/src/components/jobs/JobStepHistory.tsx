'use client';

import { Card } from '@alga-psa/ui/components/Card';
import type { JobDetail } from 'server/src/services/job.service';

interface JobStepHistoryProps {
  steps: JobDetail[];
}

export default function JobStepHistory({ steps }: JobStepHistoryProps) {
  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold text-[rgb(var(--color-text-900))] mb-6">
        Job Steps
      </h3>
      <div className="space-y-4">
        {steps.map((step) => (
          <div 
            key={step.id} 
            className="p-4 bg-[rgb(var(--color-border-50))] rounded-lg border border-[rgb(var(--color-border-200))]"
          >
            <div className="flex justify-between items-center mb-2">
              <div className="font-medium text-[rgb(var(--color-text-900))]">
                {step.stepName}
              </div>
              <div className={`text-sm font-medium px-2 py-1 rounded ${
                step.status === 'completed' ? 'bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-600))]' :
                step.status === 'failed' ? 'bg-[rgb(var(--color-accent-50))] text-[rgb(var(--color-accent-600))]' : 
                'bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-700))]'
              }`}>
                {step.status}
              </div>
            </div>
            {step.processedAt && (
              <div className="text-sm text-[rgb(var(--color-text-600))] mb-1">
                <span className="font-medium">Processed:</span> {new Date(step.processedAt).toLocaleString()}
              </div>
            )}
            {step.retryCount > 0 && (
              <div className="text-sm text-[rgb(var(--color-text-600))]">
                <span className="font-medium">Retries:</span> {step.retryCount}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
