'use client';

import React, { memo } from 'react';
import { ITimeEntryWithNew, TimeInputs, Service } from './types';
import { TaxRegion } from '@alga-psa/types';

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
  TimeEntryEditFormComponent?: React.ComponentType<any>;
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
  isNewEntry = false,
  TimeEntryEditFormComponent
}: SingleTimeEntryFormProps) {
  if (!TimeEntryEditFormComponent) return null;
  return (
    <div className="space-y-4">
      <TimeEntryEditFormComponent
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
