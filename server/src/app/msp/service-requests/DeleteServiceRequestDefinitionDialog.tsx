'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { DeleteEntityDialog } from '@alga-psa/ui';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useDeletionValidation } from '@alga-psa/auth/hooks/useDeletionValidation';
import type { DeletionValidationResult } from '@alga-psa/types';
import {
  archiveServiceRequestDefinitionAction,
  deleteServiceRequestDefinitionAction,
} from './actions';

export interface DeleteServiceRequestDefinitionTarget {
  definition_id: string;
  name: string;
  lifecycle_state: 'draft' | 'published' | 'archived';
}

export interface DeleteServiceRequestDefinitionDialogProps {
  /** The definition to delete; the dialog is open whenever this is set. */
  definition: DeleteServiceRequestDefinitionTarget | null;
  onClose: () => void;
  /** Called after the definition was permanently deleted. */
  onDeleted: () => void | Promise<void>;
  /** Called after the Archive alternative archived the definition. */
  onArchived: () => void | Promise<void>;
}

/**
 * Wires the platform DeleteEntityDialog to the `service_request_definition`
 * deletion engine entry. Shared by the management list and the editor header.
 */
export function DeleteServiceRequestDefinitionDialog({
  definition,
  onClose,
  onDeleted,
  onArchived,
}: DeleteServiceRequestDefinitionDialogProps) {
  const { t } = useTranslation('msp/service-requests');
  const { validate, reset, validationResult, isValidating } =
    useDeletionValidation('service_request_definition');
  const [isDeleting, setIsDeleting] = useState(false);
  const [blockedResult, setBlockedResult] = useState<DeletionValidationResult | null>(null);

  const definitionId = definition?.definition_id ?? null;

  useEffect(() => {
    setBlockedResult(null);
    if (!definitionId) {
      reset();
      return;
    }
    validate(definitionId).catch((error) => {
      console.error('Failed to validate service request definition deletion', error);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definitionId]);

  const isArchived = definition?.lifecycle_state === 'archived';
  const effectiveResult = blockedResult ?? validationResult;

  // The engine config is static (supportsArchive), so it always offers Archive;
  // an already-archived form has nothing to archive.
  const displayedResult = useMemo<DeletionValidationResult | null>(() => {
    if (!effectiveResult) return null;
    if (!isArchived) return effectiveResult;
    return {
      ...effectiveResult,
      alternatives: effectiveResult.alternatives.filter((alt) => alt.action !== 'archive'),
    };
  }, [effectiveResult, isArchived]);

  const close = () => {
    setIsDeleting(false);
    reset();
    onClose();
  };

  const handleConfirmDelete = async () => {
    if (!definition) return;
    setIsDeleting(true);
    try {
      const result = await deleteServiceRequestDefinitionAction(definition.definition_id);
      if (result.deleted) {
        toast.success(t('messages.success.definitionDeleted'));
        close();
        await onDeleted();
        return;
      }
      // Blocked (e.g. a submission arrived since validation): show why.
      setBlockedResult(result);
    } catch (error) {
      console.error('Failed to delete service request definition', error);
      toast.error(t('messages.error.deleteFailed'));
    } finally {
      setIsDeleting(false);
    }
  };

  const handleAlternative = async (action: string) => {
    if (!definition || action !== 'archive') return;
    setIsDeleting(true);
    try {
      const result = await archiveServiceRequestDefinitionAction(definition.definition_id);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success(t('messages.success.definitionArchived'));
      close();
      await onArchived();
    } catch (error) {
      console.error('Failed to archive service request definition', error);
      toast.error(t('messages.error.archiveFailed'));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <DeleteEntityDialog
      id="service-request-delete-dialog"
      isOpen={definition !== null}
      onClose={close}
      onConfirmDelete={handleConfirmDelete}
      onAlternativeAction={handleAlternative}
      entityName={definition?.name ?? ''}
      confirmationMessage={t('deleteDialog.confirmation', { name: definition?.name ?? '' })}
      validationResult={displayedResult}
      isValidating={isValidating}
      isDeleting={isDeleting}
    />
  );
}
