'use client';

import { memo } from 'react';
import TimeEntryEditForm from './TimeEntryEditForm';
import { ITimeEntryWithNew, TimeInputs, Service } from './types';
import { TaxRegion } from 'server/src/types/types.d';

interface SingleTimeEntryFormProps {
  id: string;
  entry: ITimeEntryWithNew;
  services: Service[];
  taxRegions: TaxRegion[];
  timeInputs: TimeInputs;
  totalDuration: number;
  isEditable: boolean;
  lastNoteInputRef: React.RefObject<HTMLInputElement | null>;
  onSave?: (index: number) => Promise<void>;
  onDelete: (index: number) => Promise<void>;
  onUpdateEntry: (index: number, entry: ITimeEntryWithNew) => void;
  onUpdateTimeInputs: (inputs: TimeInputs) => void;
  date?: Date;
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
  date,
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
        date={date}
        isNewEntry={isNewEntry}
      />
    </div>
  );
});

export default SingleTimeEntryForm;
