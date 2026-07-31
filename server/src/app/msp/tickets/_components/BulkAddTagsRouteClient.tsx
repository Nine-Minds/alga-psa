'use client';

import { useState } from 'react';
import BulkAddTagsDialog from '@alga-psa/tickets/components/BulkAddTagsDialog';
import { bulkAddTagsToTickets } from '@alga-psa/tickets/actions/ticketActions';
import {
  type TicketBulkCloseMode,
  type TicketBulkFailure,
  useTicketBulkRouteDialog,
} from './TicketBulkRouteHelpers';

interface BulkAddTagsRouteClientProps {
  closeMode: TicketBulkCloseMode;
}

export default function BulkAddTagsRouteClient({ closeMode }: BulkAddTagsRouteClientProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failed, setFailed] = useState<TicketBulkFailure[]>([]);
  const {
    t,
    close,
    refreshList,
    refreshAndClose,
    handleError,
    selectedTicketCount,
    selectedTicketIdsArray,
    labelFailures,
    keepFailedSelection,
    toastBulkResult,
  } = useTicketBulkRouteDialog(closeMode);

  const handleConfirm = async (tagTexts: string[]) => {
    if (selectedTicketIdsArray.length === 0 || tagTexts.length === 0) return;

    setIsSubmitting(true);
    setFailed([]);

    try {
      const result = await bulkAddTagsToTickets(selectedTicketIdsArray, tagTexts);

      if (result.updatedIds.length > 0) {
        refreshList();
      }

      if (result.failed.length > 0) {
        setFailed(result.failed);
        keepFailedSelection(result.failed);
        toastBulkResult(result, {
          partialFailure: t('bulk.tags.partialFailure', 'Tags could not be added to some tickets'),
          success: (count) => t('bulk.tags.success', {
            count,
            defaultValue: count === 1 ? 'Tags added to {{count}} ticket' : 'Tags added to {{count}} tickets',
          }),
        });
      } else {
        toastBulkResult(result, {
          partialFailure: t('bulk.tags.partialFailure', 'Tags could not be added to some tickets'),
          success: (count) => t('bulk.tags.success', {
            count,
            defaultValue: count === 1 ? 'Tags added to {{count}} ticket' : 'Tags added to {{count}} tickets',
          }),
        });
        refreshAndClose();
      }
    } catch (error) {
      handleError(error, t('bulk.tags.failure', 'Failed to add tags to selected tickets'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <BulkAddTagsDialog
      idPrefix="ticket-bulk-tags"
      isOpen={true}
      onClose={close}
      ticketCount={selectedTicketCount}
      failed={labelFailures(failed)}
      isSubmitting={isSubmitting}
      onConfirm={handleConfirm}
    />
  );
}
