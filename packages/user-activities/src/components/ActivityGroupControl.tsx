'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Bookmark, BookmarkCheck, Check, X } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Input } from '@alga-psa/ui/components/Input';
import { Popover, PopoverContent, PopoverTrigger } from '@alga-psa/ui/components/Popover';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ActivityGroupControlRenderProps } from '@alga-psa/ui/context';
import { isActivityOnMyList } from '@alga-psa/user-activities/actions';
import { buildActivityBoardHref } from '../lib/activityBoardLink';
import { useMyActivityGroups } from './MyActivityGroupsProvider';

/**
 * "My group" control for ticket / project-task detail screens: a chip showing which of MY
 * personal activity groups the record is in, with a popover to move it, clear it, or create a
 * group inline. Personal to the session user; renders nothing unless the record is on my list.
 */
export function ActivityGroupControl({ id, activityId, activityType, assignmentKey }: ActivityGroupControlRenderProps) {
  const { t } = useTranslation('msp/user-activities');
  const store = useMyActivityGroups();
  const { ensureLoaded, groupOf, moveTo, clear, createAndMove } = store;

  // null = unknown (pending); the control renders nothing until the answer is true.
  const [eligible, setEligible] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  // Re-check whenever the record or its SAVED assignment changes.
  useEffect(() => {
    let cancelled = false;
    setEligible(null);
    isActivityOnMyList(activityType, activityId)
      .then((result) => { if (!cancelled) setEligible(result === true); })
      .catch((err) => {
        console.error('Error checking whether activity is on my list:', err);
        if (!cancelled) setEligible(false);
      });
    return () => { cancelled = true; };
  }, [activityType, activityId, assignmentKey]);

  useEffect(() => {
    if (eligible) void ensureLoaded();
  }, [eligible, ensureLoaded]);

  const currentGroup = groupOf(activityType, activityId);
  const href = useMemo(() => buildActivityBoardHref(activityType, activityId), [activityType, activityId]);
  const options = useMemo(
    () => (store.groups ?? []).map((g) => ({ value: g.groupId, label: g.groupName })),
    [store.groups]
  );

  if (!eligible) return null;

  const ungroupedLabel = t('myGroup.ungrouped', { defaultValue: 'Ungrouped' });
  const chipLabel = t('myGroup.chip', {
    name: currentGroup ? currentGroup.groupName : ungroupedLabel,
    defaultValue: 'My group: {{name}}',
  });

  const handleSelect = async (groupId: string) => {
    if (groupId === (currentGroup?.groupId ?? '')) return;
    if (groupId === '') await clear(activityType, activityId);
    else await moveTo(activityType, activityId, groupId);
  };

  const resetCreate = () => {
    setCreating(false);
    setNewName('');
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const ok = await createAndMove(name, activityType, activityId);
      if (ok) resetCreate();
    } finally {
      setBusy(false);
    }
  };

  const Icon = currentGroup ? BookmarkCheck : Bookmark;

  return (
    <div className="inline-flex items-center gap-1" data-testid={`${id}-my-group`}>
      <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) resetCreate(); }}>
        <PopoverTrigger asChild>
          <Button
            id={`${id}-my-group-chip`}
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 rounded-full border border-[rgb(var(--color-border-200))] px-2.5 text-xs font-medium"
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="max-w-[16rem] truncate">{chipLabel}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 space-y-3">
          <div>
            <h4 className="text-sm font-semibold">{t('myGroup.label', { defaultValue: 'My group' })}</h4>
            <p className="mt-0.5 text-xs text-[rgb(var(--color-text-500))]">
              {t('myGroup.privacyHint', {
                defaultValue: 'Only you can see this. It organizes your activities list.',
              })}
            </p>
          </div>

          {creating ? (
            <div className="flex items-center gap-2">
              <Input
                id={`${id}-my-group-new-name`}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); void handleCreate(); }
                  if (e.key === 'Escape') { e.stopPropagation(); resetCreate(); }
                }}
                placeholder={t('myGroup.newGroupPlaceholder', { defaultValue: 'Group name' })}
                autoFocus
                disabled={busy}
              />
              <Button
                id={`${id}-my-group-create`}
                type="button"
                size="sm"
                onClick={() => void handleCreate()}
                disabled={busy || newName.trim().length === 0}
                aria-label={t('myGroup.create', { defaultValue: 'Create' })}
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                id={`${id}-my-group-cancel-create`}
                type="button"
                size="sm"
                variant="ghost"
                onClick={resetCreate}
                disabled={busy}
                aria-label={t('myGroup.cancel', { defaultValue: 'Cancel' })}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <CustomSelect
              id={`${id}-my-group-select`}
              options={options}
              value={currentGroup?.groupId ?? ''}
              onValueChange={(value) => void handleSelect(value)}
              placeholder={t('myGroup.selectPlaceholder', { defaultValue: 'Choose a group' })}
              allowClear
              size="sm"
              onAddNew={() => setCreating(true)}
              addNewLabel={t('myGroup.newGroup', { defaultValue: 'New group…' })}
            />
          )}

          <Link
            id={`${id}-my-group-link-popover`}
            href={href}
            className="inline-flex items-center gap-1 text-xs text-[rgb(var(--color-primary-600))] hover:underline"
          >
            {t('myGroup.showOnBoard', { defaultValue: 'Show on my activities' })}
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </PopoverContent>
      </Popover>

      <Link
        id={`${id}-my-group-link`}
        href={href}
        title={t('myGroup.showOnBoard', { defaultValue: 'Show on my activities' })}
        aria-label={t('myGroup.showOnBoard', { defaultValue: 'Show on my activities' })}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[rgb(var(--color-text-500))] hover:bg-[rgb(var(--color-border-100))] hover:text-[rgb(var(--color-text-900))]"
      >
        <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
