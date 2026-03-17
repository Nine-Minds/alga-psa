'use client';

import React, { useEffect, useState } from 'react';
import DonutChart from '@alga-psa/projects/components/DonutChart';
import HoursProgressBar from '@alga-psa/projects/components/HoursProgressBar';
import { calculateProjectCompletion, type ProjectCompletionMetrics } from '@alga-psa/projects/lib/projectUtils';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export function ClientPortalProjectMetrics({ projectId }: { projectId: string }) {
  const { t } = useTranslation('features/projects');
  const [metrics, setMetrics] = useState<ProjectCompletionMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const projectMetrics = await calculateProjectCompletion(projectId);
        setMetrics(projectMetrics);
      } catch (error) {
        console.error('Error fetching project metrics:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
  }, [projectId]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-gray-50 p-4 rounded-lg animate-pulse h-36" />
        <div className="bg-gray-50 p-4 rounded-lg animate-pulse h-36" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
      <div className="bg-gray-50 p-4 rounded-lg">
        <h3 className="text-lg font-semibold mb-4">{t('taskCompletion', 'Task Completion')}</h3>
        <div className="flex items-center">
          <div className="mr-4">
            <DonutChart
              percentage={metrics?.taskCompletionPercentage || 0}
              tooltipContent="Shows the percentage of completed tasks across the entire project"
            />
          </div>
          <div>
            <p className="font-medium">
              {t('percentComplete', '{{percent}}% Complete', { percent: Math.round(metrics?.taskCompletionPercentage || 0) })}
            </p>
            <p className="text-sm text-gray-600">
              {t('tasksCompleted', '{{completed}} of {{total}} tasks completed', {
                completed: metrics?.completedTasks || 0,
                total: metrics?.totalTasks || 0,
              })}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-gray-50 p-4 rounded-lg">
        <h3 className="text-lg font-semibold mb-4">{t('budgetHours', 'Budget Hours')}</h3>
        <div className="flex flex-col">
          <div className="flex flex-col mb-1">
            <p className="font-medium">
              {t('budgetUsed', '{{percent}}% of Budget Used', { percent: Math.round(metrics?.hoursCompletionPercentage || 0) })}
            </p>
            <p className="text-sm text-gray-600">
              {t('hoursUsed', '{{spent}} of {{budgeted}} hours', {
                spent: (metrics?.spentHours || 0).toFixed(1),
                budgeted: (metrics?.budgetedHours || 0).toFixed(1),
              })}
            </p>
          </div>
          <HoursProgressBar
            percentage={metrics?.hoursCompletionPercentage || 0}
            width={'100%'}
            height={8}
            showTooltip={true}
            tooltipContent={
              <div className="p-2">
                <p className="font-medium">{t('hoursUsage', 'Hours Usage')}</p>
                <p className="text-sm">
                  {t('hoursUsedDetail', '{{spent}} of {{budgeted}} hours used', {
                    spent: (metrics?.spentHours || 0).toFixed(1),
                    budgeted: (metrics?.budgetedHours || 0).toFixed(1),
                  })}
                </p>
                <p className="text-sm">
                  {t('hoursRemaining', '{{remaining}} hours remaining', {
                    remaining: (metrics?.remainingHours || 0).toFixed(1),
                  })}
                </p>
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
}
