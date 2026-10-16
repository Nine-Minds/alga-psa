'use client';

import { memo } from 'react';
import TimeEntryEditForm from './TimeEntryEditForm';
import { ITimeEntryWithNew, TimeInputs, Service } from './types';
import { ITimePeriodView, TaxRegion } from '@alga-psa/types';
import type { CatalogPeriod } from '../../../../lib/timeEntryPeriodSelection';

interface SingleTimeEntryFormProps {
  id: string;
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
}

const SingleTimeEntryForm = memo(function SingleTimeEntryForm({
  id,
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
  isNewEntry = false
}: SingleTimeEntryFormProps) {
  return (
    <div className="space-y-4">
      <TimeEntryEditForm
        id={id}
        entry={entry}
        index={0}
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
      />
    </div>
  );
});

export default SingleTimeEntryForm;
