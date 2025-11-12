'use client';

import { useState } from 'react';
import { Calendar, Filter, RefreshCw } from 'lucide-react';

import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Button } from 'server/src/components/ui/Button';

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

const DEFAULT_SEGMENTS: FilterOption[] = [
  { value: 'all', label: 'All customers' },
  { value: 'managed', label: 'Managed clients' },
  { value: 'project', label: 'Project-only clients' },
];

const DEFAULT_TEMPLATES: FilterOption[] = [
  { value: 'all', label: 'All templates' },
  { value: 'default', label: 'Phase 1 CSAT template' },
];

const DEFAULT_TIMEFRAMES: FilterOption[] = [
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '365d', label: 'Year to date' },
];

export default function FilterPanel({
  segments = DEFAULT_SEGMENTS,
  templates = DEFAULT_TEMPLATES,
  timeframes = DEFAULT_TIMEFRAMES,
  onApply,
}: AnalyticsFilterPanelProps) {
  const [segment, setSegment] = useState<string>(segments[0]?.value ?? 'all');
  const [template, setTemplate] = useState<string>(templates[0]?.value ?? 'all');
  const [timeframe, setTimeframe] = useState<string>(timeframes[0]?.value ?? '30d');

  const handleApply = () => {
    onApply?.({
      segment,
      template,
      timeframe,
    });
  };

  const handleReset = () => {
    setSegment(segments[0]?.value ?? 'all');
    setTemplate(templates[0]?.value ?? 'all');
    setTimeframe(timeframes[0]?.value ?? '30d');
    onApply?.({
      segment: segments[0]?.value ?? 'all',
      template: templates[0]?.value ?? 'all',
      timeframe: timeframes[0]?.value ?? '30d',
    });
  };

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <CustomSelect
          label="Customer Segment"
          value={segment}
          onValueChange={setSegment}
          options={segments}
        />
        <CustomSelect
          label="Survey Template"
          value={template}
          onValueChange={setTemplate}
          options={templates}
        />
        <CustomSelect
          label="Timeframe"
          value={timeframe}
          onValueChange={setTimeframe}
          options={timeframes}
        />
        <div>
          <span className="mb-1 block text-sm font-medium text-gray-700">Calendar View</span>
          <Button id="calendar-view" variant="outline" className="w-full justify-start">
            <Calendar className="mr-2 h-4 w-4" />
            Coming soon
          </Button>
        </div>
      </div>
      <div className="flex gap-2">
        <Button id="reset-filters" variant="outline" onClick={handleReset}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Reset
        </Button>
        <Button id="apply-filters" onClick={handleApply}>
          <Filter className="mr-2 h-4 w-4" />
          Apply Filters
        </Button>
      </div>
    </div>
  );
}
