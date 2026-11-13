'use client';

import React from 'react';
import Link from 'next/link';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { getErroredSyncOperations } from '../../actions/accountingSyncActions';
import type { ErroredSyncOperationRow } from '../../actions/accountingSyncActions';

// Accounting Exports opens the batch's detail/errors dialog from the batchId query parameter.
const batchHref = (batchId: string) => `/msp/billing?tab=accounting-exports&batchId=${encodeURIComponent(batchId)}`;

interface ErroredSyncOpsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  adapterType: 'quickbooks_online' | 'xero';
  realmId: string | null;
  providerLabel: string;
}

export default function ErroredSyncOpsDialog({ isOpen, onClose, adapterType, realmId, providerLabel }: ErroredSyncOpsDialogProps) {
  const { t } = useTranslation('msp/integrations');
  const { formatDate } = useFormatters();
  const [rows, setRows] = React.useState<ErroredSyncOperationRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getErroredSyncOperations({ preferredAdapterType: adapterType, preferredTargetRealm: realmId ?? undefined })
      .then((result) => {
        if (cancelled) return;
        if (isActionMessageError(result) || isActionPermissionError(result)) {
          setError(getErrorMessage(result));
          setRows([]);
        } else {
          setRows(result);
        }
      })
      .catch(() => {
        if (!cancelled) setError(t('integrations.qbo.sync.erroredOpsLoadError', { defaultValue: 'Failed to load errored operations.' }));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [isOpen, adapterType, realmId, t]);

  const itemName = (row: ErroredSyncOperationRow) => {
    if (!row.displayName) {
      return t(`integrations.qbo.sync.erroredOpsDeleted.${row.entityKind}`, { defaultValue: 'Unavailable item' });
    }
    // Payments and credit applications are named by the invoice they settle.
    if (row.entityKind === 'payment') {
      return t('integrations.qbo.sync.erroredOpsItem.payment', { invoice: row.displayName, defaultValue: 'Payment on {{invoice}}' });
    }
    if (row.entityKind === 'credit_application') {
      return t('integrations.qbo.sync.erroredOpsItem.creditApplication', { invoice: row.displayName, defaultValue: 'Credit applied to {{invoice}}' });
    }
    return row.displayName;
  };

  const columns = [
    { title: t('integrations.qbo.sync.erroredOpsColItem', { defaultValue: 'Item' }), dataIndex: 'displayName', width: '20%', render: (_: unknown, row: ErroredSyncOperationRow) => itemName(row) },
    {
      title: t('integrations.qbo.sync.erroredOpsColOperation', { defaultValue: 'Operation' }),
      dataIndex: 'operation',
      width: '13%',
      render: (value: string) => t(`integrations.qbo.sync.erroredOpsOperation.${value}`, { defaultValue: value })
    },
    {
      title: t('integrations.qbo.sync.erroredOpsColError', { defaultValue: 'Error' }),
      dataIndex: 'lastError',
      // The error is what the user opened this list for: give it the room.
      width: '39%',
      render: (value: string | null) => value || t('integrations.qbo.sync.erroredOpsNoError', { defaultValue: 'No error details were recorded.' })
    },
    {
      title: t('integrations.qbo.sync.erroredOpsColWhen', { defaultValue: 'When' }),
      dataIndex: 'timestamp',
      width: '15%',
      render: (value: string) => formatDate(value, { dateStyle: 'medium', timeStyle: 'short' })
    },
    {
      title: t('integrations.qbo.sync.erroredOpsColBatch', { defaultValue: 'Export batch' }),
      dataIndex: 'batchId',
      width: '13%',
      render: (_: unknown, row: ErroredSyncOperationRow) =>
        row.batchId ? (
          <Link id={`errored-sync-op-batch-link-${row.opId}`} href={batchHref(row.batchId)} className="underline">
            {t('integrations.qbo.sync.erroredOpsBatchLink', { batch: row.batchLabel ?? '', defaultValue: 'View {{batch}} batch' })}
          </Link>
        ) : null
    }
  ];

  return (
    <Dialog
      id="errored-sync-ops-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={t('integrations.qbo.sync.erroredOpsDialogTitle', { provider: providerLabel, defaultValue: 'Errored {{provider}} sync operations' })}
      className="max-w-6xl"
    >
      <DialogContent>
        <p className="text-sm text-muted-foreground mb-3">
          {t('integrations.qbo.sync.erroredOpsDialogDescription', { defaultValue: 'Operations that failed or were skipped after repeated attempts.' })}
        </p>
        {loading ? (
          <LoadingIndicator text={t('integrations.qbo.sync.erroredOpsLoading', { defaultValue: 'Loading errored operations…' })} />
        ) : error ? (
          <Alert variant="destructive" id="errored-sync-ops-error"><AlertDescription>{error}</AlertDescription></Alert>
        ) : rows.length === 0 ? (
          <p id="errored-sync-ops-empty" className="text-sm text-muted-foreground">
            {t('integrations.qbo.sync.erroredOpsEmpty', { defaultValue: 'No errored operations.' })}
          </p>
        ) : (
          <DataTable id="errored-sync-ops-table" data={rows.map((r) => ({ ...r, id: r.opId }))} columns={columns as any} pagination={true} pageSize={10} />
        )}
        <DialogFooter>
          <Button id="errored-sync-ops-close" variant="outline" onClick={onClose}>
            {t('integrations.qbo.sync.erroredOpsClose', { defaultValue: 'Close' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
