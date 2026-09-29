'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { RadioGroup } from '@alga-psa/ui/components/RadioGroup';
import { useTranslation } from 'react-i18next';
import { isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { previewBulkBundleStatusPropagationAction } from '../actions/ticketBundleActions';
import type { BundleStatusPropagationPreview } from '../lib/ticketBundlePropagation';
import TicketNotificationSuppressionControl, {
  type TicketNotificationSuppressionValue,
} from './ticket/TicketNotificationSuppressionControl';

export type BulkStatusConfirmOptions = {
  suppressContactNotifications?: boolean;
  suppressInternalNotifications?: boolean;
  propagateToChildren?: boolean;
};

interface BulkChangeStatusDialogProps {
  isOpen: boolean;
  onClose: () => void;
  ticketCount: number;
  ticketIds: string[];
  statuses: SelectOption[];
  isLoadingStatuses: boolean;
  failed: Array<{ ticketId: string; message: string; label?: string }>;
  isSubmitting: boolean;
  onConfirm: (statusId: string, options?: BulkStatusConfirmOptions) => Promise<void>;
  idPrefix?: string;
}

export default function BulkChangeStatusDialog({
  isOpen,
  onClose,
  ticketCount,
  ticketIds,
  statuses,
  isLoadingStatuses,
  failed,
  isSubmitting,
  onConfirm,
  idPrefix = 'ticket-bulk-status',
}: BulkChangeStatusDialogProps) {
  const { t } = useTranslation(['features/tickets', 'common']);
  const [selectedStatusId, setSelectedStatusId] = useState<string>('');
  const [notificationSuppression, setNotificationSuppression] = useState<TicketNotificationSuppressionValue>({
    suppressContactNotifications: false,
    suppressInternalNotifications: false,
  });
  const [bundlePreviews, setBundlePreviews] = useState<Record<string, BundleStatusPropagationPreview>>({});
  const [isLoadingPreviews, setIsLoadingPreviews] = useState(false);
  const [propagationMode, setPropagationMode] = useState<'children' | 'masters'>('children');

  useEffect(() => {
    if (isOpen) {
      setSelectedStatusId('');
      setNotificationSuppression({
        suppressContactNotifications: false,
        suppressInternalNotifications: false,
      });
      setBundlePreviews({});
      setPropagationMode('children');
    }
  }, [isOpen]);

  // Load the per-master propagation previews whenever a status is chosen.
  useEffect(() => {
    if (!isOpen || !selectedStatusId || ticketIds.length === 0) {
      setBundlePreviews({});
      return;
    }
    let cancelled = false;
    setIsLoadingPreviews(true);
    previewBulkBundleStatusPropagationAction({ ticketIds, newStatusId: selectedStatusId })
      .then((result) => {
        if (cancelled) return;
        if (isActionMessageError(result) || isActionPermissionError(result)) {
          setBundlePreviews({});
          return;
        }
        setBundlePreviews(result);
        setPropagationMode('children');
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[BulkChangeStatusDialog] Failed to preview bundle propagation:', error);
        setBundlePreviews({});
      })
      .finally(() => {
        if (!cancelled) setIsLoadingPreviews(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedStatusId, ticketIds]);

  const bundleMasterIds = useMemo(() => Object.keys(bundlePreviews), [bundlePreviews]);
  const affectedChildCount = useMemo(
    () =>
      bundleMasterIds.reduce(
        (total, masterId) => total + bundlePreviews[masterId].affectedChildren.length,
        0,
      ),
    [bundleMasterIds, bundlePreviews],
  );
  const hasBundleMasters = bundleMasterIds.length > 0;

  const canConfirm = !!selectedStatusId && !isLoadingStatuses && !isLoadingPreviews;

  const handleConfirm = async () => {
    if (!selectedStatusId) return;
    const options: BulkStatusConfirmOptions = {
      ...(notificationSuppression.suppressContactNotifications ? notificationSuppression : {}),
      ...(hasBundleMasters
        ? { propagateToChildren: propagationMode === 'children' }
        : {}),
    };
    const hasOptions = Object.keys(options).length > 0;
    await (hasOptions ? onConfirm(selectedStatusId, options) : onConfirm(selectedStatusId));
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      id={`${idPrefix}-dialog`}
      title={t('bulk.status.dialogTitle', 'Change Status for Selected Tickets')}
      className="max-w-md"
    >
      <DialogContent>
        {failed.length > 0 && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>
              <p className="font-medium">
                {t('bulk.status.failedHeading', 'Status could not be updated on the following tickets:')}
              </p>
              <ul className="mt-2 space-y-1">
                {failed.map((error) => (
                  <li key={error.ticketId}>
                    <span className="font-medium">{error.label ?? error.ticketId}</span>: {error.message}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        <div className="mb-3 text-sm text-gray-600">
          {t('bulk.status.message', 'Set the status for {{count}} selected ticket(s):', { count: ticketCount })}
        </div>
        <div className="mb-4">
          <CustomSelect
            id={`${idPrefix}-picker`}
            options={statuses}
            value={selectedStatusId}
            onValueChange={setSelectedStatusId}
            placeholder={
              isLoadingStatuses
                ? t('bulk.status.loading', 'Loading statuses...')
                : t('bulk.status.placeholder', 'Select a status')
            }
            disabled={isLoadingStatuses || isSubmitting}
          />
        </div>
        {hasBundleMasters && (
          <Alert variant="warning" className="mb-4">
            <AlertDescription>
              <p className="font-medium">
                {t(
                  'bulk.bundle.propagationSummary',
                  '{{masters}} selected ticket(s) are sync-mode bundle masters; this change will close/reopen {{children}} child ticket(s).',
                  { masters: bundleMasterIds.length, children: affectedChildCount },
                )}
              </p>
              <div className="mt-2 space-y-1">
                {bundleMasterIds.map((masterId) => {
                  const preview = bundlePreviews[masterId];
                  return (
                    <details key={masterId} className="text-xs">
                      <summary className="cursor-pointer">
                        {t('bulk.bundle.masterSummary', '{{children}} child ticket(s)', {
                          children: preview.affectedChildren.length,
                        })}
                      </summary>
                      <ul className="mt-1 ml-4 list-disc">
                        {preview.affectedChildren.map((child) => (
                          <li key={child.ticket_id}>
                            {child.ticket_number ?? child.ticket_id}
                            {child.title ? ` — ${child.title}` : ''}
                          </li>
                        ))}
                      </ul>
                    </details>
                  );
                })}
              </div>
              <div className="mt-3">
                <RadioGroup
                  id={`${idPrefix}-bundle-propagation`}
                  name={`${idPrefix}-bundle-propagation`}
                  options={[
                    { value: 'children', label: t('bulk.bundle.applyToChildren', 'Apply to children') },
                    { value: 'masters', label: t('bulk.bundle.mastersOnly', 'Masters only') },
                  ]}
                  value={propagationMode}
                  onChange={(value) => setPropagationMode(value === 'masters' ? 'masters' : 'children')}
                  disabled={isSubmitting}
                />
              </div>
            </AlertDescription>
          </Alert>
        )}
        <div className="mb-4">
          <TicketNotificationSuppressionControl
            idPrefix={`${idPrefix}-notification-suppression`}
            value={notificationSuppression}
            onChange={setNotificationSuppression}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex justify-end space-x-2">
          <Button id={`${idPrefix}-cancel`} variant="ghost" onClick={onClose} disabled={isSubmitting}>
            {t('actions.cancel', 'Cancel')}
          </Button>
          <Button id={`${idPrefix}-confirm`} onClick={handleConfirm} disabled={isSubmitting || !canConfirm}>
            {isSubmitting
              ? t('bulk.status.submitting', 'Updating...')
              : t('bulk.status.confirm', {
                  count: ticketCount,
                  defaultValue: ticketCount === 1 ? 'Update {{count}} Ticket' : 'Update {{count}} Tickets',
                })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
