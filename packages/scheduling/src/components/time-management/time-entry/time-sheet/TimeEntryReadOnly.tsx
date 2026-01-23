'use client';

import { memo, useMemo } from 'react';
import { parseISO } from 'date-fns';
import { Button } from '@alga-psa/ui/components/Button';
import { Pencil, Trash2 } from 'lucide-react';
import { Clock } from 'lucide-react';
import { TimeEntryReadOnlyProps } from './types';
import { formatTimeForInput, getServiceById } from './utils';

const TimeEntryReadOnly = memo(function TimeEntryReadOnly({
  id,
  entry,
  index,
  isEditable,
  services,
  onEdit,
  onDelete
}: TimeEntryReadOnlyProps) {
  const selectedService = useMemo(() => 
    getServiceById(services, entry?.service_id),
    [services, entry?.service_id]
  );

  return (
    <div className="border p-4 rounded hover:bg-gray-50 flex items-center justify-between">
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2">
          <Clock className="text-gray-400" />
          <span>
            {entry?.start_time && formatTimeForInput(parseISO(entry.start_time))} - {entry?.end_time && formatTimeForInput(parseISO(entry.end_time))}
          </span>
        </div>
        <span className="text-gray-600">|</span>
        <span>{selectedService?.name || 'No service selected'}</span>
        {entry?.notes && (
          <>
            <span className="text-gray-600">|</span>
            <span className="text-gray-600 truncate max-w-[200px]">{entry.notes}</span>
          </>
        )}
      </div>
      {isEditable && (
        <div className="flex space-x-2">
          <Button
            id={`${id}-edit-entry-${index}-btn`}
            onClick={() => onEdit(index)}
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            id={`${id}-delete-entry-${index}-btn`}
            onClick={() => onDelete(index)}
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-red-500 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
});

export default TimeEntryReadOnly;
