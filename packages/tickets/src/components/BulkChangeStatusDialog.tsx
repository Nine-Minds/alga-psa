'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Label } from '@alga-psa/ui/components/Label';
import { RadioGroup } from '@alga-psa/ui/components/RadioGroup';
import { Switch } from '@alga-psa/ui/components/Switch';
import { TextArea } from '@alga-psa/ui/components/TextArea';
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
  resolutionComment?: {
    text: string;
    isInternal?: boolean;
  };
};

interface BulkChangeStatusDialogProps {
  isOpen: boolean;
  onClose: () => void;
  ticketCount: number;
  ticketIds: string[];
  statuses: SelectOption[];
  /** Status ids that close a ticket; picking one unlocks the resolution field. */
  closedStatusIds?: string[];
  /**
   * The board's close rules demand a resolution comment (enabled rules with
   * require_resolution_comment). UX only; the server still enforces.
   */
  resolutionRequired?: boolean;
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
  closedStatusIds,
  resolutionRequired = false,
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
  const [resolution, setResolution] = useState('');
  const [resolutionIsInternal, setResolutionIsInternal] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedStatusId('');
      setNotificationSuppression({
        suppressContactNotifications: false,
        suppressInternalNotifications: false,
      });
      setBundlePreviews({});
      setPropagationMode('children');
      setResolution('');
      setResolutionIsInternal(false);
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

  // A closing status is the only one a resolution comment belongs to; the
  // server drops the text for any other status anyway.
  const isClosingStatus = !!selectedStatusId && (closedStatusIds ?? []).includes(selectedStatusId);
  const trimmedResolution = resolution.trim();
  const isResolutionRequired = isClosingStatus && resolutionRequired;
  const canConfirm =
    !!selectedStatusId &&
    !isLoadingStatuses &&
    !isLoadingPreviews &&
    (!isResolutionRequired || trimmedResolution.length > 0);

  const handleConfirm = async () => {
    if (!selectedStatusId) return;
    const options: BulkStatusConfirmOptions = {
      ...(notificationSuppression.suppressContactNotifications ? notificationSuppression : {}),
      ...(hasBundleMasters
        ? { propagateToChildren: propagationMode === 'children' }
        : {}),
      ...(isClosingStatus && trimmedResolution
        ? { resolutionComment: { text: trimmedResolution, isInternal: resolutionIsInternal } }
        : {}),
    };
    const hasOptions = Object.keys(options).length > 0;
    await (hasOptions ? onConfirm(selectedStatusId, options) : onConfirm(selectedStatusId));
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      hasUnsavedChanges={trimmedResolution.length > 0}
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
        {isClosingStatus && (
          <div className="mb-4 space-y-2">
            <TextArea
              id={`${idPrefix}-resolution`}
              label={
                isResolutionRequired
                  ? t('bulk.status.resolutionLabelRequired', 'Resolution comment')
                  : t('bulk.status.resolutionLabel', 'Resolution comment (optional)')
              }
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
              placeholder={t(
                'bulk.status.resolutionPlaceholder',
                'Describe how these tickets were resolved',
              )}
              rows={3}
              disabled={isSubmitting}
              required={isResolutionRequired}
              aria-required={isResolutionRequired ? 'true' : undefined}
              aria-describedby={`${idPrefix}-resolution-hint`}
            />
            <div className="flex items-center gap-2">
              <Switch
                id={`${idPrefix}-resolution-internal`}
                checked={resolutionIsInternal}
                onCheckedChange={setResolutionIsInternal}
                disabled={isSubmitting}
              />
              <Label htmlFor={`${idPrefix}-resolution-internal`}>
                {t('info.markResolutionInternal', 'Mark as Internal')}
              </Label>
            </div>
            <p id={`${idPrefix}-resolution-hint`} className="text-xs text-gray-600">
              {isResolutionRequired
                ? t(
                    'bulk.status.resolutionRequiredHint',
                    'This board requires a resolution comment before tickets can be closed.',
                  )
                : t(
                    'bulk.status.resolutionHelper',
                    'Saved as the resolution on each selected ticket, satisfying boards that require one before closing.',
                  )}
            </p>
          </div>
        )}
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
