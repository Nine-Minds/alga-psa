'use client';

import { memo } from 'react';
import TimeEntryEditForm from './TimeEntryEditForm';
import { ITimeEntryWithNew, TimeEntryFormProps, TimeInputs, Service } from './types';
import { ITimePeriodView, TaxRegion } from '@alga-psa/types';
import type { CatalogPeriod } from '../../../../lib/timeEntryPeriodSelection';

interface SingleTimeEntryFormProps {
  id: string;
  /** Position in the provider's entries; the multi-day drawer renders one form per entry. */
  index?: number;
  entry: ITimeEntryWithNew;
  services: Service[];
  taxRegions: TaxRegion[];
  timeInputs: TimeInputs;
  totalDuration: number;
  isEditable: boolean;
  lastNoteInputRef: React.RefObject<HTMLTextAreaElement | null>;
  onSave?: (index: number) => Promise<void>;
  onDelete: (index: number) => Promise<void>;
  onUpdateEntry: (index: number, entry: ITimeEntryWithNew) => void;
  onUpdateTimeInputs: (inputs: TimeInputs) => void;
  timePeriod?: ITimePeriodView;
  periodCatalog?: readonly CatalogPeriod[];
  date?: Date;
  workTimeZone?: string;
  isNewEntry?: boolean;
  serviceOptional?: boolean;
  errors?: TimeEntryFormProps['errors'];
  showErrors?: boolean;
}

const SingleTimeEntryForm = memo(function SingleTimeEntryForm({
  id,
  index = 0,
  entry,
  services,
  taxRegions,
  timeInputs,
  totalDuration,
  isEditable,
  lastNoteInputRef,
  onSave,
  onDelete,
  onUpdateEntry,
  onUpdateTimeInputs,
  timePeriod,
  periodCatalog,
  date,
  workTimeZone,
  isNewEntry = false,
  serviceOptional = false,
  errors,
  showErrors,
}: SingleTimeEntryFormProps) {
  return (
    <div className="space-y-4">
      <TimeEntryEditForm
        id={id}
        entry={entry}
        index={index}
        isEditable={isEditable}
        services={services}
        taxRegions={taxRegions}
        timeInputs={timeInputs}
        totalDuration={totalDuration}
        onSave={onSave}
        onDelete={onDelete}
        onUpdateEntry={onUpdateEntry}
        onUpdateTimeInputs={onUpdateTimeInputs}
        lastNoteInputRef={lastNoteInputRef}
        timePeriod={timePeriod}
        periodCatalog={periodCatalog}
        date={date}
        workTimeZone={workTimeZone}
        isNewEntry={isNewEntry}
        serviceOptional={serviceOptional}
        errors={errors}
        showErrors={showErrors}
      />
    </div>
  );
});

export default SingleTimeEntryForm;
