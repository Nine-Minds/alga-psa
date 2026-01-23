'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Filter } from 'lucide-react';

import type { SurveyFilterOptions } from '@alga-psa/surveys/actions/survey-actions/surveyResponseFilterActions';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Button } from '@alga-psa/ui/components/Button';
import { DateRangePicker, type DateRange } from '@alga-psa/ui/components/DateRangePicker';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import type { IClient } from '@alga-psa/types';

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

  const FIELD_CLASS = 'flex flex-col gap-1 min-w-[200px] shrink-0';

  const [templateId, setTemplateId] = useState<string>(initialFilters?.templateId ?? '__ALL__');
  const [technicianId, setTechnicianId] = useState<string>(initialFilters?.technicianId ?? '__ALL__');
  const [clientId, setClientId] = useState<string>(initialFilters?.clientId ?? '__ALL__');
  const [dateRange, setDateRange] = useState<DateRange>(
    initialFilters?.dateRange ?? createEmptyRange()
  );
  const [clientFilterState, setClientFilterState] = useState<'all' | 'active' | 'inactive'>('all');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');

  useEffect(() => {
    setTemplateId(initialFilters?.templateId ?? '__ALL__');
    setTechnicianId(initialFilters?.technicianId ?? '__ALL__');
    setClientId(initialFilters?.clientId ?? '__ALL__');
    setDateRange(initialFilters?.dateRange ?? createEmptyRange());
  }, [createEmptyRange, initialFilters]);

  const handleApply = () => {
    onApply?.({
      templateId: templateId === '__ALL__' ? undefined : templateId,
      technicianId: technicianId === '__ALL__' ? undefined : technicianId,
      clientId: clientId === '__ALL__' ? undefined : clientId,
      dateRange,
    });
  };

  const handleReset = () => {
    setTemplateId('__ALL__');
    setTechnicianId('__ALL__');
    setClientId('__ALL__');
    setDateRange(createEmptyRange());
    setClientFilterState('all');
    setClientTypeFilter('all');
    onReset?.();
  };

  const clientsForPicker = useMemo<IClient[]>(
    () =>
      options.clients.map(
        (client) =>
          ({
            client_id: client.client_id,
            client_name: client.client_name,
            client_type: client.client_type,
            is_inactive: client.is_inactive,
            logoUrl: client.logoUrl,
          } as unknown as IClient)
      ),
    [options.clients]
  );

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className={`${FIELD_CLASS} max-w-xs`}>
        <span className="text-sm font-medium text-gray-700">Template</span>
        <CustomSelect
          options={[{ value: '__ALL__', label: 'All templates' }, ...options.templates]}
          value={templateId}
          onValueChange={setTemplateId}
          placeholder="All templates"
        />
      </div>
      <div className={`${FIELD_CLASS} max-w-xs`}>
        <span className="text-sm font-medium text-gray-700">Technician</span>
        <CustomSelect
          options={[{ value: '__ALL__', label: 'All technicians' }, ...options.technicians]}
          value={technicianId}
          onValueChange={setTechnicianId}
          placeholder="All technicians"
        />
      </div>
      <div className={`${FIELD_CLASS} max-w-xs`}>
        <span className="text-sm font-medium text-gray-700">Client</span>
        <ClientPicker
          id="survey-response-client-picker"
          clients={clientsForPicker}
          selectedClientId={clientId === '__ALL__' ? null : clientId}
          onSelect={(selected) => setClientId(selected ?? '__ALL__')}
          filterState={clientFilterState}
          onFilterStateChange={setClientFilterState}
          clientTypeFilter={clientTypeFilter}
          onClientTypeFilterChange={setClientTypeFilter}
          fitContent
          placeholder="All clients"
        />
      </div>
      <div className={`${FIELD_CLASS} min-w-[250px]`}>
        <span className="text-sm font-medium text-gray-700">Date Range</span>
        <DateRangePicker id="survey-response-date-range" value={dateRange} onChange={setDateRange} />
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
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
