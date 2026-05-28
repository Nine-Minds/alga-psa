'use client';

import React, { useMemo } from 'react';
import { Dialog, DialogContent, DialogFooter } from './Dialog';
import { Button } from './Button';
import Spinner from './Spinner';
import type { DeletionDependency, DeletionValidationResult } from '@alga-psa/types';
import { withDataAutomationId } from '../ui-reflection/withDataAutomationId';
import type { AutomationProps } from '../ui-reflection/types';
import { useTranslation } from '../lib/i18n/client';

export interface DeleteEntityDialogProps extends AutomationProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmDelete: () => Promise<void> | void;
  onAlternativeAction?: (action: string) => Promise<void> | void;
  entityName: string;
  confirmationMessage?: React.ReactNode;
  validationResult?: DeletionValidationResult | null;
  isValidating: boolean;
  isDeleting?: boolean;
  id?: string;
}

function renderDependencyRow(dependency: DeletionDependency, viewLabel: string) {
  return (
    <li key={dependency.type} className="text-sm text-[rgb(var(--color-text-700))]">
      <div className="flex items-center justify-between gap-3">
        <span>
          {dependency.count} {dependency.label}
        </span>
        {dependency.viewUrl ? (
          <a
            href={dependency.viewUrl}
            className="text-[rgb(var(--color-primary-600))] hover:text-[rgb(var(--color-primary-700))] underline"
          >
            {viewLabel}
          </a>
        ) : null}
      </div>
      {dependency.description ? (
        <p className="mt-1 text-xs text-[rgb(var(--color-text-500))]">
          {dependency.description}
        </p>
      ) : null}
    </li>
  );
}

export const DeleteEntityDialog = ({
  isOpen,
  onClose,
  onConfirmDelete,
  onAlternativeAction,
  entityName,
  confirmationMessage,
  validationResult,
  isValidating,
  isDeleting = false,
  id
}: DeleteEntityDialogProps) => {
  const { t } = useTranslation('common');
  const canDelete = validationResult?.canDelete ?? false;
  const dependencies = useMemo(() => validationResult?.dependencies ?? [], [validationResult?.dependencies]);
  const alternatives = useMemo(() => (validationResult?.alternatives ?? []).map((alternative) => {
    if (alternative.action === 'deactivate' && alternative.label === 'Mark as Inactive') {
      return {
        ...alternative,
        label: t('deleteEntity.alternatives.deactivate.label', { defaultValue: 'Mark as Inactive' }),
        description: alternative.description
          ? t('deleteEntity.alternatives.deactivate.description', {
              defaultValue: 'Deactivates the record without deleting its data.',
            })
          : alternative.description,
        warning: alternative.warning
          ? t('deleteEntity.alternatives.deactivate.warning', {
              defaultValue: 'Inactive records will no longer be selectable in new workflows.',
            })
          : alternative.warning,
      };
    }

    if (alternative.action === 'archive' && alternative.label === 'Archive') {
      return {
        ...alternative,
        label: t('deleteEntity.alternatives.archive.label', { defaultValue: 'Archive' }),
        description: alternative.description
          ? t('deleteEntity.alternatives.archive.description', {
              defaultValue: 'Moves the record out of active use while preserving history.',
            })
          : alternative.description,
        warning: alternative.warning
          ? t('deleteEntity.alternatives.archive.warning', {
              defaultValue: 'Archived records are hidden from default views.',
            })
          : alternative.warning,
      };
    }

    return alternative;
  }), [validationResult?.alternatives, t]);
  const viewLabel = t('actions.view', { defaultValue: 'View' });
  const blockMessage = validationResult?.message ?? t('deleteEntity.fallbackBlockMessage', {
    defaultValue: 'Please remove or reassign these items before deleting.',
  });

  const primaryAlternative = alternatives[0];
  const secondaryAlternatives = alternatives.slice(1);

  const title = isValidating
    ? t('deleteEntity.checkingDependenciesTitle', { defaultValue: 'Checking Dependencies' })
    : canDelete
      ? t('deleteEntity.deleteTitle', { defaultValue: 'Delete {{entityName}}', entityName })
      : t('deleteEntity.cannotDeleteTitle', { defaultValue: 'Cannot Delete' });

  const confirmLabel = isDeleting
    ? t('deleteEntity.deleting', { defaultValue: 'Deleting...' })
    : t('actions.delete', { defaultValue: 'Delete' });

  const dialogBody = useMemo(() => {
    if (isValidating) {
      return (
        <div className="flex items-center gap-3 text-[rgb(var(--color-text-600))]">
          <Spinner size="xs" />
          <span>
            {t('deleteEntity.checkingDependenciesMessage', {
              defaultValue: 'Checking for dependencies...',
            })}
          </span>
        </div>
      );
    }

    if (canDelete) {
      return (
        <p className="text-[rgb(var(--color-text-700))]">
          {confirmationMessage ?? t('deleteEntity.confirmationMessage', {
            defaultValue: 'Are you sure you want to delete "{{entityName}}"? This action cannot be undone.',
            entityName,
          })}
        </p>
      );
    }

    return (
      <div className="space-y-3">
        <p className="text-[rgb(var(--color-text-700))]">{blockMessage}</p>
        {dependencies.length > 0 && (
          <ul className="space-y-2">
            {dependencies.map((dependency) => renderDependencyRow(dependency, viewLabel))}
          </ul>
        )}
      </div>
    );
  }, [isValidating, canDelete, blockMessage, confirmationMessage, dependencies, entityName, t, viewLabel]);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      {...withDataAutomationId({ id: id || 'delete-entity-dialog' })}
      id={id}
    >
      <DialogContent>
        {dialogBody}
        <DialogFooter>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              id={`${id || 'delete-entity-dialog'}-cancel`}
              disabled={isDeleting}
            >
              {t('actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            {!isValidating && !canDelete && primaryAlternative && onAlternativeAction && (
              <Button
                onClick={() => onAlternativeAction(primaryAlternative.action)}
                id={`${id || 'delete-entity-dialog'}-alt-primary`}
                disabled={isDeleting}
              >
                {isDeleting ? <Spinner size="button" variant="inverted" /> : primaryAlternative.label}
              </Button>
            )}
            {!isValidating && !canDelete && secondaryAlternatives.length > 0 && (
              secondaryAlternatives.map((alternative) => (
                <Button
                  key={alternative.action}
                  variant="outline"
                  onClick={() => onAlternativeAction?.(alternative.action)}
                  id={`${id || 'delete-entity-dialog'}-alt-${alternative.action}`}
                  disabled={isDeleting}
                >
                  {isDeleting ? <Spinner size="button" /> : alternative.label}
                </Button>
              ))
            )}
            {!isValidating && canDelete && (
              <Button
                variant="destructive"
                onClick={onConfirmDelete}
                id={`${id || 'delete-entity-dialog'}-confirm`}
                disabled={isDeleting}
              >
                {isDeleting ? <Spinner size="button" variant="inverted" /> : confirmLabel}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
