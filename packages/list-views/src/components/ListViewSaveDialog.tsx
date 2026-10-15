'use client';

import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { RadioGroup } from '@alga-psa/ui/components/RadioGroup';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ListViewVisibility } from '@alga-psa/types';
import { LIST_VIEW_NAME_MAX_LENGTH, normalizeListViewName } from '../lib/settingsSchema';

export interface ListViewSaveDialogProps {
  /** Id prefix, e.g. `tickets-view-picker`. */
  id: string;
  isOpen: boolean;
  mode: 'create' | 'manage';
  initialName?: string;
  initialVisibility?: ListViewVisibility;
  canShare: boolean;
  /** Manage mode: the view is currently shared, so Shared stays selectable even without share rights. */
  isCurrentlyShared?: boolean;
  /** Manage mode: offer Delete in the footer. */
  canDelete?: boolean;
  isSaving?: boolean;
  onClose: () => void;
  onSubmit: (input: { name: string; visibility: ListViewVisibility }) => Promise<boolean>;
  onDelete?: () => void;
}

/**
 * Name + visibility form for saving a new view or managing an existing one.
 * The server re-validates everything; this only keeps obviously invalid input
 * from making a round trip.
 */
export function ListViewSaveDialog({
  id,
  isOpen,
  mode,
  initialName = '',
  initialVisibility = 'private',
  canShare,
  isCurrentlyShared = false,
  canDelete = false,
  isSaving = false,
  onClose,
  onSubmit,
  onDelete,
}: ListViewSaveDialogProps) {
  const { t } = useTranslation('common');
  const [name, setName] = useState(initialName);
  const [visibility, setVisibility] = useState<ListViewVisibility>(initialVisibility);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName(initialName);
      setVisibility(initialVisibility);
      setNameError(null);
    }
  }, [isOpen, initialName, initialVisibility]);

  const formId = `${id}-save-form`;
  const sharedSelectable = canShare || isCurrentlyShared;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = normalizeListViewName(name);
    if (!normalized) {
      setNameError(t('listViews.dialog.nameInvalid', {
        defaultValue: 'Enter a name of 1 to {{max}} characters.',
        max: LIST_VIEW_NAME_MAX_LENGTH,
      }));
      return;
    }
    const saved = await onSubmit({ name: normalized, visibility });
    if (saved) onClose();
  };

  const footer = (
    <div className="flex w-full items-center justify-between gap-2">
      <div>
        {mode === 'manage' && canDelete && onDelete && (
          <Button
            id={`${id}-dialog-delete-button`}
            type="button"
            variant="destructive"
            onClick={onDelete}
            disabled={isSaving}
          >
            {t('listViews.actions.delete', 'Delete')}
          </Button>
        )}
      </div>
      <div className="flex gap-2">
        <Button id={`${id}-dialog-cancel-button`} type="button" variant="ghost" onClick={onClose} disabled={isSaving}>
          {t('actions.cancel', 'Cancel')}
        </Button>
        <Button
          id={`${id}-dialog-save-button`}
          type="button"
          disabled={isSaving}
          onClick={() => (document.getElementById(formId) as HTMLFormElement | null)?.requestSubmit()}
        >
          {t('actions.save', 'Save')}
        </Button>
      </div>
    </div>
  );

  return (
    <Dialog
      id={`${id}-save-dialog`}
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'create'
        ? t('listViews.dialog.createTitle', 'Save as new view')
        : t('listViews.dialog.manageTitle', 'Manage view')}
      className="max-w-md"
      footer={footer}
    >
      <DialogContent>
        <form id={formId} onSubmit={handleSubmit} className="mt-2 space-y-4">
          <div>
            <Input
              id={`${id}-name-input`}
              label={t('listViews.dialog.nameLabel', 'Name')}
              value={name}
              maxLength={LIST_VIEW_NAME_MAX_LENGTH}
              autoFocus
              onChange={(event) => {
                setName(event.target.value);
                if (nameError) setNameError(null);
              }}
            />
            {nameError && (
              <p className="mt-1 text-sm text-[rgb(var(--color-destructive))]" role="alert">{nameError}</p>
            )}
          </div>
          <RadioGroup
            id={`${id}-visibility`}
            name={`${id}-visibility`}
            label={t('listViews.dialog.visibilityLabel', 'Who can see it')}
            value={visibility}
            onChange={(value) => setVisibility(value as ListViewVisibility)}
            options={[
              {
                value: 'private',
                label: t('listViews.visibility.private', 'Private'),
                description: t('listViews.dialog.privateHint', 'Only you can see this view.'),
              },
              {
                value: 'shared',
                label: t('listViews.visibility.shared', 'Shared'),
                description: sharedSelectable
                  ? t('listViews.dialog.sharedHint', 'Everyone who can open this list can see and apply it.')
                  : t('listViews.dialog.sharedDisabledHint', 'You do not have permission to share views.'),
                disabled: !sharedSelectable,
              },
            ]}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
