'use client';

import { memo, useMemo } from 'react';
import { parseISO } from 'date-fns';
import { Button } from '@alga-psa/ui/components/Button';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import { Clock } from 'lucide-react';
import { TimeEntryReadOnlyProps } from './types';
import { formatTimeForInput, getServiceById } from './utils';
import { TimeEntryChangeRequestIndicator } from './TimeEntryChangeRequestFeedback';

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

  const handleOpenEntry = () => {
    onEdit(index);
  };

  return (
    <div
      className="cursor-pointer rounded border p-4 transition-colors hover:bg-gray-50"
      onClick={handleOpenEntry}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleOpenEntry();
        }
      }}
      role="button"
      tabIndex={0}
    >
      {entry?.change_requests?.length ? (
        <div className="mb-3">
          <TimeEntryChangeRequestIndicator changeRequests={entry.change_requests} showLabel />
        </div>
      ) : null}
      <div className="flex flex-col gap-3 md:grid md:grid-cols-[9.5rem_8.5rem_minmax(0,1fr)_auto] md:items-center md:gap-4">
        <div className="flex items-center gap-2 text-sm text-gray-900 md:min-w-0">
          <Clock className="h-4 w-4 shrink-0 text-gray-400" />
          <span className="font-medium tabular-nums">
            {entry?.start_time && formatTimeForInput(parseISO(entry.start_time))} - {entry?.end_time && formatTimeForInput(parseISO(entry.end_time))}
          </span>
        </div>

        <div className="min-w-0 text-sm text-gray-900 md:min-w-[8.5rem]">
          <span className="line-clamp-2 md:line-clamp-1">
            {selectedService?.name || 'No service selected'}
          </span>
        </div>

        <div className="min-w-0 text-sm text-gray-600">
          {entry?.notes ? (
            <span className="block truncate">{entry.notes}</span>
          ) : (
            <span className="text-gray-400">No notes</span>
          )}
        </div>

        <div className="flex items-center gap-2 md:justify-self-end">
          {!isEditable && (
            <Button
              id={`${id}-view-entry-${index}-btn`}
              onClick={(event) => {
                event.stopPropagation();
                onEdit(index);
              }}
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              title="View entry details"
            >
              <Eye className="h-4 w-4" />
            </Button>
          )}
          {isEditable && (
            <>
            <Button
              id={`${id}-edit-entry-${index}-btn`}
              onClick={(event) => {
                event.stopPropagation();
                onEdit(index);
              }}
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              id={`${id}-delete-entry-${index}-btn`}
              onClick={(event) => {
                event.stopPropagation();
                onDelete(index);
              }}
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-red-500 hover:text-red-600"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
});

export default TimeEntryReadOnly;
