'use client';

import { memo } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '../ui/Button';
import TimeEntryEditForm from './TimeEntryEditForm';
import TimeEntryReadOnly from './TimeEntryReadOnly';
import { ITimeEntryWithNew, TimeInputs, Service } from './types';
import { TaxRegion } from '../../types/types.d';

interface TimeEntryListProps {
  id: string;
  entries: ITimeEntryWithNew[];
  services: Service[];
  taxRegions: TaxRegion[];
  timeInputs: TimeInputs;
  editingIndex: number | null;
  totalDurations: number[];
  isEditable: boolean;
  lastNoteInputRef: React.RefObject<HTMLInputElement>;
  onSave: (index: number) => Promise<void>;
  onDelete: (index: number) => Promise<void>;
  onEdit: (index: number) => void;
  onCollapse: () => void;
  onUpdateEntry: (index: number, entry: ITimeEntryWithNew) => void;
  onUpdateTimeInputs: (inputs: TimeInputs) => void;
  onAddEntry: () => void;
}

const TimeEntryList = memo(function TimeEntryList({
  id,
  entries,
  services,
  taxRegions,
  timeInputs,
  editingIndex,
  totalDurations,
  isEditable,
  lastNoteInputRef,
  onSave,
  onDelete,
  onEdit,
  onCollapse,
  onUpdateEntry,
  onUpdateTimeInputs,
  onAddEntry
}: TimeEntryListProps) {
  return (
    <div className="space-y-4">
      {entries.map((entry, index): JSX.Element => (
        <div key={entry.entry_id || entry.tempId || `entry-${index}`}>
          {editingIndex === index ? (
            <TimeEntryEditForm
              id={id}
              entry={entry}
              index={index}
              isEditable={isEditable}
              services={services}
              taxRegions={taxRegions}
              timeInputs={timeInputs}
              totalDuration={totalDurations[index] || 0}
              onSave={onSave}
              onDelete={onDelete}
              onCollapse={onCollapse}
              onUpdateEntry={onUpdateEntry}
              onUpdateTimeInputs={onUpdateTimeInputs}
              lastNoteInputRef={lastNoteInputRef}
            />
          ) : (
            <TimeEntryReadOnly
              id={id}
              entry={entry}
              index={index}
              isEditable={isEditable}
              services={services}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          )}
        </div>
      ))}
      
      {isEditable && (
        <Button 
          id={`${id}-add-new-entry-btn`}
          onClick={onAddEntry}
          variant="outline"
          className="w-full flex items-center justify-center gap-2"
          disabled={editingIndex !== null && entries[editingIndex]?.isNew}
        >
          <Plus className="h-4 w-4" />
          Add Entry
        </Button>
      )}
    </div>
  );
});

export default TimeEntryList;