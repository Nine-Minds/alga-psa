'use client';

import { Card } from '@alga-psa/ui/components/Card';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { JobDetail } from '@alga-psa/jobs';

interface JobStepHistoryProps {
  steps: JobDetail[];
}

export default function JobStepHistory({ steps }: JobStepHistoryProps) {
  const { t } = useTranslation('msp/jobs');
  const { formatDate } = useFormatters();

  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold text-[rgb(var(--color-text-900))] mb-6">
        {t('stepHistory.title', { defaultValue: 'Job Steps' })}
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
                {t(`shared.statusLabels.${step.status}`, {
                  defaultValue: step.status.charAt(0).toUpperCase() + step.status.slice(1),
                })}
              </div>
            </div>
            {step.processedAt && (
              <div className="text-sm text-[rgb(var(--color-text-600))] mb-1">
                <span className="font-medium">{t('stepHistory.labels.processed', { defaultValue: 'Processed:' })}</span> {formatDate(step.processedAt)}
              </div>
            )}
            {step.retryCount > 0 && (
              <div className="text-sm text-[rgb(var(--color-text-600))]">
                <span className="font-medium">{t('stepHistory.labels.retries', { defaultValue: 'Retries:' })}</span> {step.retryCount}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
