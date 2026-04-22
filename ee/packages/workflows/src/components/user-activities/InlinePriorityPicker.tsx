'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Activity, ActivityType, IPriority } from '@alga-psa/types';
import { Popover, PopoverTrigger, PopoverContent } from '@alga-psa/ui/components/Popover';
import { Check, ChevronDown } from 'lucide-react';
import { getAllPriorities } from '@alga-psa/reference-data/actions';
import { updateActivityPriorityById } from '@alga-psa/workflows/actions';
import { cn } from '@alga-psa/ui/lib/utils';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

// Module-level cache for priorities — rarely change and re-fetching on every row is wasteful
const priorityCache: Map<'ticket' | 'project_task', Promise<IPriority[]>> = new Map();

function loadPriorities(itemType: 'ticket' | 'project_task'): Promise<IPriority[]> {
  let cached = priorityCache.get(itemType);
  if (!cached) {
    cached = getAllPriorities(itemType).catch((err) => {
      // On error, clear cache so next attempt retries
      priorityCache.delete(itemType);
      throw err;
    });
    priorityCache.set(itemType, cached);
  }
  return cached;
}

interface InlinePriorityPickerProps {
  activity: Activity;
  onPriorityChange?: () => void;
}

export function InlinePriorityPicker({ activity, onPriorityChange }: InlinePriorityPickerProps) {
  const { t } = useTranslation('msp/user-activities');
  const [open, setOpen] = useState(false);
  const [priorities, setPriorities] = useState<IPriority[]>([]);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);

  const itemType: 'ticket' | 'project_task' | null =
    activity.type === ActivityType.TICKET
      ? 'ticket'
      : activity.type === ActivityType.PROJECT_TASK
        ? 'project_task'
        : null;

  // Load priorities when popover opens for the first time
  useEffect(() => {
    if (!open || !itemType || priorities.length > 0) return;
    setLoading(true);
    loadPriorities(itemType)
      .then((data) => setPriorities(data))
      .catch((err) => console.error('Error loading priorities:', err))
      .finally(() => setLoading(false));
  }, [open, itemType, priorities.length]);

  const handleSelect = useCallback(async (priorityId: string) => {
    if (!itemType || updating) return;
    setUpdating(true);
    try {
      await updateActivityPriorityById(activity.id, activity.type, priorityId);
      setOpen(false);
      onPriorityChange?.();
    } catch (err) {
      console.error('Error updating priority:', err);
    } finally {
      setUpdating(false);
    }
  }, [activity.id, activity.type, itemType, updating, onPriorityChange]);

  // For unsupported types, render read-only display
  if (!itemType) {
    if (!activity.priorityColor) {
      return <span className="text-muted-foreground">—</span>;
    }
    return (
      <div className="flex items-center gap-2">
        <div
          className="w-3 h-3 rounded-full flex-shrink-0"
          style={{ backgroundColor: activity.priorityColor }}
        />
        <span>{activity.priorityName || activity.priority}</span>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-1.5 px-1.5 py-0.5 rounded',
            'hover:bg-muted/60 transition-colors',
            'focus:outline-none focus:ring-1 focus:ring-primary-500',
            updating && 'opacity-60 pointer-events-none'
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {activity.priorityColor ? (
            <div
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: activity.priorityColor }}
            />
          ) : (
            <div className="w-3 h-3 rounded-full flex-shrink-0 border border-dashed border-muted-foreground" />
          )}
          <span className="text-sm">
            {activity.priorityName || <span className="text-muted-foreground">{t('pickers.priority.none', { defaultValue: 'None' })}</span>}
          </span>
          <ChevronDown className="h-3 w-3 text-muted-foreground ml-0.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[200px] p-1"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">{t('pickers.priority.loading', { defaultValue: 'Loading...' })}</div>
        ) : priorities.length === 0 ? (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">{t('pickers.priority.empty', { defaultValue: 'No priorities available' })}</div>
        ) : (
          <div className="space-y-0.5">
            {priorities.map((p) => {
              const isSelected = p.priority_name === activity.priorityName;
              return (
                <button
                  key={p.priority_id}
                  type="button"
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded',
                    'hover:bg-muted/60 focus:outline-none focus:bg-muted/60',
                    isSelected && 'bg-muted/40'
                  )}
                  onClick={() => handleSelect(p.priority_id)}
                  disabled={updating}
                >
                  <div
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: p.color || '#94a3b8' }}
                  />
                  <span className="flex-1 text-left truncate">{p.priority_name}</span>
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
