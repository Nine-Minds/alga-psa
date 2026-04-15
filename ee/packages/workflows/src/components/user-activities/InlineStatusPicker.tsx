'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Activity, ActivityType } from '@alga-psa/types';
import { Popover, PopoverTrigger, PopoverContent } from '@alga-psa/ui/components/Popover';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import {
  updateActivityStatusById,
  getActivityStatusOptions,
  type ActivityStatusOption,
} from '@alga-psa/workflows/actions';
import { cn } from '@alga-psa/ui/lib/utils';

interface InlineStatusPickerProps {
  activity: Activity;
  onStatusChange?: () => void;
}

export function InlineStatusPicker({ activity, onStatusChange }: InlineStatusPickerProps) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ActivityStatusOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);

  const isEditable =
    activity.type === ActivityType.TICKET || activity.type === ActivityType.PROJECT_TASK;

  // Current selection ID on the activity (statusId for tickets, statusMappingId for project tasks)
  const currentId =
    activity.type === ActivityType.TICKET
      ? (activity as any).statusId
      : activity.type === ActivityType.PROJECT_TASK
        ? (activity as any).statusMappingId
        : undefined;

  // Load options when popover opens for the first time
  useEffect(() => {
    if (!open || !isEditable || options.length > 0) return;
    setLoading(true);
    getActivityStatusOptions(activity.id, activity.type)
      .then(setOptions)
      .catch((err) => console.error('Error loading statuses:', err))
      .finally(() => setLoading(false));
  }, [open, isEditable, options.length, activity.id, activity.type]);

  const handleSelect = useCallback(
    async (statusId: string) => {
      if (updating) return;
      setUpdating(true);
      try {
        await updateActivityStatusById(activity.id, activity.type, statusId);
        setOpen(false);
        onStatusChange?.();
      } catch (err) {
        console.error('Error updating status:', err);
      } finally {
        setUpdating(false);
      }
    },
    [activity.id, activity.type, updating, onStatusChange]
  );

  // Non-editable types: render a plain badge
  if (!isEditable) {
    return <Badge variant="default">{activity.status}</Badge>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1 rounded hover:bg-muted/60',
            'focus:outline-none focus:ring-1 focus:ring-primary-500',
            'transition-colors px-1 py-0.5',
            updating && 'opacity-60 pointer-events-none'
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <Badge variant="default">{activity.status}</Badge>
          {updating ? (
            <Loader2 className="h-3 w-3 text-muted-foreground animate-spin" />
          ) : (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[220px] p-1"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">Loading...</div>
        ) : options.length === 0 ? (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">No statuses available</div>
        ) : (
          <div className="space-y-0.5 max-h-[280px] overflow-y-auto">
            {options.map((opt) => {
              const isSelected = opt.id === currentId;
              return (
                <button
                  key={opt.id}
                  type="button"
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded',
                    'hover:bg-muted/60 focus:outline-none focus:bg-muted/60',
                    isSelected && 'bg-muted/40'
                  )}
                  onClick={() => handleSelect(opt.id)}
                  disabled={updating}
                >
                  <span className="flex-1 text-left truncate">{opt.name}</span>
                  {opt.isClosed && (
                    <span className="text-xs text-muted-foreground">closed</span>
                  )}
                  {isSelected && <Check className="h-3.5 w-3.5 text-primary-500" />}
                </button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
