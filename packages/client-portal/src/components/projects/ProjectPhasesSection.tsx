'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getClientProjectPhases } from '@alga-psa/client-portal/actions';
import { format } from 'date-fns';
import { getDateFnsLocale } from '@alga-psa/ui';

interface Phase {
  phase_id: string;
  phase_name: string;
  description: string | null;
  start_date: Date | null;
  end_date: Date | null;
  completion_percentage?: number;
}

interface ProjectPhasesSectionProps {
  projectId: string;
  showCompletion: boolean;
}

export default function ProjectPhasesSection({ projectId, showCompletion }: ProjectPhasesSectionProps) {
  const { t, i18n } = useTranslation('features/projects');
  const dateLocale = getDateFnsLocale(i18n.language);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPhases = async () => {
      try {
        const result = await getClientProjectPhases(projectId);
        if (result?.phases) {
          setPhases(result.phases);
        }
      } catch (err) {
        console.error('Error fetching project phases:', err);
        setError('Failed to load project phases');
      } finally {
        setLoading(false);
      }
    };

    fetchPhases();
  }, [projectId]);

  if (loading) {
    return (
      <div className="bg-[rgb(var(--color-border-50))] p-4 rounded-lg">
        <div className="animate-pulse">
          <div className="h-5 bg-[rgb(var(--color-border-200))] rounded w-1/3 mb-4"></div>
          <div className="space-y-3">
            <div className="h-20 bg-[rgb(var(--color-border-200))] rounded"></div>
            <div className="h-20 bg-[rgb(var(--color-border-200))] rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 p-4 rounded-lg">
        <p className="text-red-600 text-sm">{error}</p>
      </div>
    );
  }

  if (phases.length === 0) {
    return (
      <div className="bg-[rgb(var(--color-border-50))] p-4 rounded-lg">
        <h3 className="text-lg font-semibold mb-2">{t('phases.title', 'Project Phases')}</h3>
        <p className="text-[rgb(var(--color-text-600))] text-sm">{t('phases.noPhases', 'No phases to display')}</p>
      </div>
    );
  }

  return (
    <div className="bg-[rgb(var(--color-border-50))] p-4 rounded-lg mb-6">
      <h3 className="text-lg font-semibold mb-4">{t('phases.title', 'Project Phases')}</h3>
      <div className="space-y-3">
        {phases.map((phase) => (
          <div key={phase.phase_id} className="bg-[rgb(var(--color-card))] p-4 rounded-lg border border-[rgb(var(--color-border-200))]">
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1">
                <h4 className="font-medium text-[rgb(var(--color-text-900))]">{phase.phase_name}</h4>
                {phase.description && (
                  <p className="text-sm text-[rgb(var(--color-text-600))] mt-1">{phase.description}</p>
                )}
              </div>
              {showCompletion && phase.completion_percentage !== undefined && (
                <div className="ml-4 text-right">
                  <div className="text-lg font-semibold text-purple-600">
                    {phase.completion_percentage}%
                  </div>
                  <div className="text-xs text-[rgb(var(--color-text-500))]">
                    {t('phases.completion', 'Complete')}
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-4 text-sm text-[rgb(var(--color-text-600))] mt-2">
              {phase.start_date && (
                <div>
                  <span className="font-medium">{t('startDate', 'Start Date')}:</span>{' '}
                  {format(new Date(phase.start_date), 'PPP', { locale: dateLocale })}
                </div>
              )}
              {phase.end_date && (
                <div>
                  <span className="font-medium">{t('endDate', 'End Date')}:</span>{' '}
                  {format(new Date(phase.end_date), 'PPP', { locale: dateLocale })}
                </div>
              )}
            </div>
            {showCompletion && phase.completion_percentage !== undefined && (
              <div className="mt-3">
                <div className="w-full bg-[rgb(var(--color-border-200))] rounded-full h-2">
                  <div
                    className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${phase.completion_percentage}%` }}
                  ></div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
