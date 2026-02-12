'use client';

import React, { useMemo } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './Dialog';
import { Button } from './Button';
import Spinner from './Spinner';
import type { DeletionAlternative, DeletionDependency, DeletionValidationResult } from '@alga-psa/types';
import { withDataAutomationId } from '../ui-reflection/withDataAutomationId';
import type { AutomationProps } from '../ui-reflection/types';

export interface DeleteEntityDialogProps extends AutomationProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmDelete: () => Promise<void> | void;
  onAlternativeAction?: (action: string) => Promise<void> | void;
  entityName: string;
  validationResult?: DeletionValidationResult | null;
  isValidating: boolean;
  isDeleting?: boolean;
  id?: string;
}

function renderDependencyRow(dependency: DeletionDependency) {
  return (
    <li key={dependency.type} className="flex items-center justify-between text-sm text-[rgb(var(--color-text-700))]">
      <span>
        {dependency.count} {dependency.label}
      </span>
      {dependency.viewUrl ? (
        <a
          href={dependency.viewUrl}
          className="text-[rgb(var(--color-primary-600))] hover:text-[rgb(var(--color-primary-700))] underline"
        >
          View
        </a>
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
  validationResult,
  isValidating,
  isDeleting = false,
  id
}: DeleteEntityDialogProps) => {
  const canDelete = validationResult?.canDelete ?? false;
  const dependencies = validationResult?.dependencies ?? [];
  const alternatives = validationResult?.alternatives ?? [];
  const blockMessage = validationResult?.message ?? 'Please remove or reassign these items before deleting.';

  const primaryAlternative = alternatives[0];
  const secondaryAlternatives = alternatives.slice(1);

  const title = isValidating
    ? 'Checking Dependencies'
    : canDelete
      ? `Delete ${entityName}`
      : 'Cannot Delete';

  const confirmLabel = isDeleting ? 'Deleting...' : 'Delete';

  const dialogBody = useMemo(() => {
    if (isValidating) {
      return (
        <div className="flex items-center gap-3 text-[rgb(var(--color-text-600))]">
          <Spinner size="xs" />
          <span>Checking for dependencies...</span>
        </div>
      );
    }

    if (canDelete) {
      return (
        <p className="text-[rgb(var(--color-text-700))]">
          Are you sure you want to delete "{entityName}"? This action cannot be undone.
        </p>
      );
    }

    return (
      <div className="space-y-3">
        <p className="text-[rgb(var(--color-text-700))]">{blockMessage}</p>
        {dependencies.length > 0 && (
          <ul className="space-y-2">{dependencies.map(renderDependencyRow)}</ul>
        )}
      </div>
    );
  }, [isValidating, canDelete, blockMessage, dependencies, entityName]);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      id={id}
      title={title}
      {...withDataAutomationId({ id: id || 'delete-entity-dialog' })}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {dialogBody}
        <DialogFooter>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              id={`${id || 'delete-entity-dialog'}-cancel`}
              disabled={isDeleting}
            >
              Cancel
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
