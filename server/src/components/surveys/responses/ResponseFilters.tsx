'use client';

import { useCallback, useEffect, useState } from 'react';
import { Filter } from 'lucide-react';

import type { SurveyFilterOptions } from 'server/src/lib/actions/survey-actions/surveyResponseFilterActions';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Button } from 'server/src/components/ui/Button';
import { DateRangePicker, type DateRange } from 'server/src/components/ui/DateRangePicker';

export type ResponseFilterState = {
  templateId?: string;
  technicianId?: string;
  clientId?: string;
  dateRange?: DateRange | null;
};

type ResponseFiltersProps = {
  options: SurveyFilterOptions;
  initialFilters?: ResponseFilterState;
  onApply?: (filters: ResponseFilterState) => void;
  onReset?: () => void;
};

export default function ResponseFilters({ options, initialFilters, onApply, onReset }: ResponseFiltersProps) {
  const createEmptyRange = useCallback((): DateRange => ({ from: undefined, to: undefined }), []);

  const [templateId, setTemplateId] = useState<string>(initialFilters?.templateId ?? '');
  const [technicianId, setTechnicianId] = useState<string>(initialFilters?.technicianId ?? '');
  const [clientId, setClientId] = useState<string>(initialFilters?.clientId ?? '');
  const [dateRange, setDateRange] = useState<DateRange>(
    initialFilters?.dateRange ?? createEmptyRange()
  );

  useEffect(() => {
    setTemplateId(initialFilters?.templateId ?? '');
    setTechnicianId(initialFilters?.technicianId ?? '');
    setClientId(initialFilters?.clientId ?? '');
    setDateRange(initialFilters?.dateRange ?? createEmptyRange());
  }, [createEmptyRange, initialFilters]);

  const handleApply = () => {
    onApply?.({
      templateId: templateId || undefined,
      technicianId: technicianId || undefined,
      clientId: clientId || undefined,
      dateRange,
    });
  };

  const handleReset = () => {
    setTemplateId('');
    setTechnicianId('');
    setClientId('');
    setDateRange(createEmptyRange());
    onReset?.();
  };

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <CustomSelect
          options={[{ value: '', label: 'All templates' }, ...options.templates]}
          value={templateId}
          onValueChange={setTemplateId}
          placeholder="All templates"
          label="Template"
        />
        <CustomSelect
          options={[{ value: '', label: 'All technicians' }, ...options.technicians]}
          value={technicianId}
          onValueChange={setTechnicianId}
          placeholder="All technicians"
          label="Technician"
        />
        <CustomSelect
          options={[{ value: '', label: 'All clients' }, ...options.clients]}
          value={clientId}
          onValueChange={setClientId}
          placeholder="All clients"
          label="Client"
        />
        <div>
          <span className="mb-1 block text-sm font-medium text-gray-700">Date Range</span>
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
      </div>
      <div className="flex gap-2 md:justify-end">
        <Button id="survey-response-reset-filters" variant="outline" onClick={handleReset}>
          Reset
        </Button>
        <Button id="survey-response-apply-filters" onClick={handleApply}>
          <Filter className="mr-2 h-4 w-4" />
          Apply
        </Button>
      </div>
    </div>
  );
}
