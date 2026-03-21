'use client';

import { useMemo, useState } from 'react';
import { Calendar, Filter, XCircle } from 'lucide-react';

import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

type FilterOption = {
  value: string;
  label: string;
};

export type AnalyticsFilterPanelProps = {
  segments?: FilterOption[];
  templates?: FilterOption[];
  timeframes?: FilterOption[];
  onApply?: (filters: { segment?: string; template?: string; timeframe?: string }) => void;
};

export default function FilterPanel({
  segments,
  templates,
  timeframes,
  onApply,
}: AnalyticsFilterPanelProps) {
  const { t } = useTranslation('msp/surveys');

  const defaultSegments = useMemo<FilterOption[]>(
    () => [
      { value: 'all', label: t('analytics.filters.defaults.segments.all', { defaultValue: 'All customers' }) },
      { value: 'managed', label: t('analytics.filters.defaults.segments.managed', { defaultValue: 'Managed clients' }) },
      { value: 'project', label: t('analytics.filters.defaults.segments.project', { defaultValue: 'Project-only clients' }) },
    ],
    [t]
  );
  const defaultTemplates = useMemo<FilterOption[]>(
    () => [
      { value: 'all', label: t('analytics.filters.defaults.templates.all', { defaultValue: 'All templates' }) },
      { value: 'default', label: t('analytics.filters.defaults.templates.default', { defaultValue: 'Phase 1 CSAT template' }) },
    ],
    [t]
  );
  const defaultTimeframes = useMemo<FilterOption[]>(
    () => [
      { value: '30d', label: t('analytics.filters.defaults.timeframes.30d', { defaultValue: 'Last 30 days' }) },
      { value: '90d', label: t('analytics.filters.defaults.timeframes.90d', { defaultValue: 'Last 90 days' }) },
      { value: '365d', label: t('analytics.filters.defaults.timeframes.365d', { defaultValue: 'Year to date' }) },
    ],
    [t]
  );

  const segmentOptions = segments ?? defaultSegments;
  const templateOptions = templates ?? defaultTemplates;
  const timeframeOptions = timeframes ?? defaultTimeframes;

  const [segment, setSegment] = useState<string>(segmentOptions[0]?.value ?? 'all');
  const [template, setTemplate] = useState<string>(templateOptions[0]?.value ?? 'all');
  const [timeframe, setTimeframe] = useState<string>(timeframeOptions[0]?.value ?? '30d');

  const handleApply = () => {
    onApply?.({ segment, template, timeframe });
  };

  const handleReset = () => {
    const nextSegment = segmentOptions[0]?.value ?? 'all';
    const nextTemplate = templateOptions[0]?.value ?? 'all';
    const nextTimeframe = timeframeOptions[0]?.value ?? '30d';
    setSegment(nextSegment);
    setTemplate(nextTemplate);
    setTimeframe(nextTimeframe);
    onApply?.({
      segment: nextSegment,
      template: nextTemplate,
      timeframe: nextTimeframe,
    });
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]">
      <CustomSelect
        label={t('analytics.filters.labels.customerSegment', { defaultValue: 'Customer Segment' })}
        value={segment}
        onValueChange={setSegment}
        options={segmentOptions}
      />
      <CustomSelect
        label={t('analytics.filters.labels.surveyTemplate', { defaultValue: 'Survey Template' })}
        value={template}
        onValueChange={setTemplate}
        options={templateOptions}
      />
      <CustomSelect
        label={t('analytics.filters.labels.timeframe', { defaultValue: 'Timeframe' })}
        value={timeframe}
        onValueChange={setTimeframe}
        options={timeframeOptions}
      />
      <div>
        <span className="mb-1 block text-sm font-medium text-[rgb(var(--color-text-700))]">
          {t('analytics.filters.labels.calendarView', { defaultValue: 'Calendar View' })}
        </span>
        <Button id="calendar-view" variant="outline" className="w-full justify-start">
          <Calendar className="mr-2 h-4 w-4" />
          {t('analytics.filters.actions.calendar', { defaultValue: 'Coming soon' })}
        </Button>
      </div>
      <div className="flex items-end gap-2">
        <Button id="reset-filters" variant="outline" onClick={handleReset}>
          <XCircle className="mr-2 h-4 w-4" />
          {t('analytics.filters.actions.reset', { defaultValue: 'Reset' })}
        </Button>
        <Button id="apply-filters" onClick={handleApply}>
          <Filter className="mr-2 h-4 w-4" />
          {t('analytics.filters.actions.apply', { defaultValue: 'Apply Filters' })}
        </Button>
      </div>
    </div>
  );
}
