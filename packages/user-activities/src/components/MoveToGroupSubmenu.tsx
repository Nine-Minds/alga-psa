'use client';

import React, { useState } from 'react';
import { Activity } from '@alga-psa/types';
import {
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useOptionalMyActivityGroups } from './MyActivityGroupsProvider';
import { useActivityGroupMenuScope } from './ActivityGroupMenuScope';

const UNGROUPED_VALUE = '__ungrouped__';

interface MoveToGroupSubmenuProps {
  activity: Activity;
  /** Opens the new-group dialog (rendered by the menu owner, outside the closing menu). */
  onRequestNewGroup: () => void;
  onActionComplete?: () => void;
}

/**
 * "Move to group" submenu for `ActivityActionMenu`. Works for every activity type: each one is
 * a `{type, id}` row in the grouped view. Renders nothing when the scope disables it (viewing
 * another user's list) or no groups store is mounted.
 */
export function MoveToGroupSubmenu({ activity, onRequestNewGroup, onActionComplete }: MoveToGroupSubmenuProps) {
  const { t } = useTranslation('msp/user-activities');
  const store = useOptionalMyActivityGroups();
  const { enabled } = useActivityGroupMenuScope();
  if (!enabled || !store) return null;

  const loading = store.groups === null;
  const current = store.groupOf(activity.type, activity.id);

  const handleChange = async (value: string) => {
    const ok = value === UNGROUPED_VALUE
      ? await store.clear(activity.type, activity.id)
      : await store.moveTo(activity.type, activity.id, value);
    if (ok) onActionComplete?.();
  };

  return (
    <DropdownMenuSub onOpenChange={(open) => { if (open) void store.ensureLoaded(); }}>
      <DropdownMenuSubTrigger id={`move-to-group-${activity.type}-menu-item-${activity.id}`}>
        {t('actionMenu.moveToGroup', { defaultValue: 'Move to group' })}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {loading ? (
          <DropdownMenuItem disabled id={`move-to-group-loading-${activity.type}-${activity.id}`}>
            {t('actionMenu.loadingGroups', { defaultValue: 'Loading…' })}
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuRadioGroup
              value={current?.groupId ?? UNGROUPED_VALUE}
              onValueChange={(value) => void handleChange(value)}
            >
              {(store.groups ?? []).map((group) => (
                <DropdownMenuRadioItem
                  key={group.groupId}
                  value={group.groupId}
                  id={`move-to-group-${group.groupId}-${activity.type}-${activity.id}`}
                >
                  {group.groupName}
                </DropdownMenuRadioItem>
              ))}
              <DropdownMenuRadioItem
                value={UNGROUPED_VALUE}
                id={`move-to-group-ungrouped-${activity.type}-${activity.id}`}
              >
                {t('myGroup.ungrouped', { defaultValue: 'Ungrouped' })}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              id={`move-to-group-new-${activity.type}-${activity.id}`}
              onSelect={() => onRequestNewGroup()}
            >
              {t('myGroup.newGroup', { defaultValue: 'New group…' })}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

interface NewGroupDialogProps {
  activity: Activity;
  isOpen: boolean;
  onClose: () => void;
  onActionComplete?: () => void;
}

/** Name prompt for "New group…"; creates my group and moves the activity into it. */
export function MoveToNewGroupDialog({ activity, isOpen, onClose, onActionComplete }: NewGroupDialogProps) {
  const { t } = useTranslation('msp/user-activities');
  const store = useOptionalMyActivityGroups();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  if (!store) return null;

  const close = () => {
    setName('');
    onClose();
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const ok = await store.createAndMove(trimmed, activity.type, activity.id);
      if (ok) {
        close();
        onActionComplete?.();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      id={`move-to-new-group-dialog-${activity.type}-${activity.id}`}
      isOpen={isOpen}
      onClose={close}
      title={t('actionMenu.newGroupTitle', { defaultValue: 'New group' })}
    >
      <DialogContent>
        <Input
          id={`move-to-new-group-name-${activity.type}-${activity.id}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void submit(); }
          }}
          placeholder={t('myGroup.newGroupPlaceholder', { defaultValue: 'Group name' })}
          autoFocus
          disabled={busy}
        />
      </DialogContent>
      <DialogFooter>
        <Button
          id={`move-to-new-group-cancel-${activity.type}-${activity.id}`}
          type="button"
          variant="ghost"
          onClick={close}
          disabled={busy}
        >
          {t('myGroup.cancel', { defaultValue: 'Cancel' })}
        </Button>
        <Button
          id={`move-to-new-group-create-${activity.type}-${activity.id}`}
          type="button"
          onClick={() => void submit()}
          disabled={busy || name.trim().length === 0}
        >
          {t('myGroup.create', { defaultValue: 'Create' })}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
