'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatCurrencyFromMinorUnits, formatDateOnly } from '@alga-psa/core';
import type { ColumnDefinition, ICreditTracking } from '@alga-psa/types';
import { listCredits, type CreditStatusFilter } from './actions';
import { fetchClientsForDropdown } from '@alga-psa/reporting/actions/clientDropdownActions';
import CreditDetailDialog from './CreditDetailDialog';
import EditCreditExpirationDialog from './EditCreditExpirationDialog';
import ExpireCreditDialog from './ExpireCreditDialog';
import TransferCreditDialog from './TransferCreditDialog';

export type CreditRow = ICreditTracking & {
  transaction_description?: string;
  invoice_number?: string;
  client_name?: string;
};

const PAGE_SIZE = 20;
const EXPIRING_SOON_DAYS = 7;

function getStatusLabel(
  t: ReturnType<typeof useTranslation>['t'],
  record: CreditRow,
) {
  if (record.is_expired) {
    return <span className="text-red-600 font-medium">{t('status.expired', { defaultValue: 'Expired' })}</span>;
  }

  if (Number(record.remaining_amount) <= 0) {
    return <span className="text-[rgb(var(--color-text-500))] font-medium">{t('status.depleted', { defaultValue: 'Depleted' })}</span>;
  }

  if (record.expiration_date) {
    const now = new Date();
    const expDate = new Date(record.expiration_date);
    const daysUntilExpiration = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiration <= EXPIRING_SOON_DAYS) {
      return (
        <span className="text-orange-500 font-medium">
          {t('status.expiringSoon', {
            count: daysUntilExpiration,
            defaultValue: 'Expires in {{count}} days',
          })}
        </span>
      );
    }
  }

  return <span className="text-blue-600 font-medium">{t('status.active', { defaultValue: 'Active' })}</span>;
}

interface CreditActionHandlers {
  onView: (record: CreditRow) => void;
  onEdit: (record: CreditRow) => void;
  onExpire: (record: CreditRow) => void;
  onTransfer: (record: CreditRow) => void;
}

function createColumns(
  t: ReturnType<typeof useTranslation>['t'],
  handlers: CreditActionHandlers,
): ColumnDefinition<CreditRow>[] {
  return [
    {
      title: t('columns.client', { defaultValue: 'Client' }),
      dataIndex: 'client_name',
      render: (value: string | undefined) => value || t('status.na', { defaultValue: 'N/A' }),
    },
    {
      title: t('columns.description', { defaultValue: 'Description' }),
      dataIndex: 'transaction_description',
      render: (value: string | undefined) => value || t('status.na', { defaultValue: 'N/A' }),
    },
    {
      title: t('columns.balance', { defaultValue: 'Balance' }),
      dataIndex: 'remaining_amount',
      headerClassName: 'text-right',
      cellClassName: 'text-right tabular-nums',
      render: (value: number, record) => {
        const original = Number(record.amount);
        const remaining = Number(value);
        return (
          <span>
            {formatCurrencyFromMinorUnits(remaining)}
            {remaining !== original && (
              <span className="text-[rgb(var(--color-text-500))]">{' '}{t('columns.balanceOf', { amount: formatCurrencyFromMinorUnits(original), defaultValue: 'of {{amount}}' })}</span>
            )}
          </span>
        );
      },
    },
    {
      title: t('columns.expires', { defaultValue: 'Expires' }),
      dataIndex: 'expiration_date',
      render: (value: string | undefined) => {
        if (!value) {
          return <span className="text-muted-foreground">{t('status.never', { defaultValue: 'Never' })}</span>;
        }

        return <span>{formatDateOnly(new Date(value))}</span>;
      },
    },
    {
      title: t('columns.status', { defaultValue: 'Status' }),
      dataIndex: 'is_expired',
      render: (_value: boolean, record) => getStatusLabel(t, record),
    },
    {
      title: t('columns.actions', { defaultValue: 'Actions' }),
      dataIndex: 'credit_id',
      cellClassName: 'whitespace-nowrap',
      render: (value: string, record) => {
        const isExpired = record.is_expired;
        const isDepleted = Number(record.remaining_amount) <= 0;

        if (isExpired) {
          return null;
        }

        return (
          <div className="flex space-x-2">
            <Button variant="outline" size="sm" id={`edit-credit-${value}`} onClick={(e) => { e.stopPropagation(); handlers.onEdit(record); }}>
              {t('actions.edit', { defaultValue: 'Edit' })}
            </Button>
            {!isDepleted && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  id={`transfer-credit-${value}`}
                  onClick={(e) => { e.stopPropagation(); handlers.onTransfer(record); }}
                >
                  {t('actions.transfer', { defaultValue: 'Transfer' })}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  id={`expire-credit-${value}`}
                  className="text-destructive hover:bg-destructive/10"
                  onClick={(e) => { e.stopPropagation(); handlers.onExpire(record); }}
                >
                  {t('actions.expire', { defaultValue: 'Expire' })}
                </Button>
              </>
            )}
          </div>
        );
      },
    },
  ];
}

interface ClientOption {
  id: string;
  name: string;
}

export default function CreditsTable() {
  const { t } = useTranslation('msp/credits');
  const searchParams = useSearchParams();

  const [credits, setCredits] = useState<CreditRow[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [page, setPage] = useState(1);
  const [selectedClient, setSelectedClient] = useState<string>(() => searchParams?.get('client') ?? '');
  const [selectedStatus, setSelectedStatus] = useState<CreditStatusFilter | ''>('');
  const [clientOptions, setClientOptions] = useState<{ value: string; label: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [viewCredit, setViewCredit] = useState<CreditRow | null>(null);
  const [editCredit, setEditCredit] = useState<CreditRow | null>(null);
  const [expireCreditRow, setExpireCreditRow] = useState<CreditRow | null>(null);
  const [transferCreditRow, setTransferCreditRow] = useState<CreditRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchClientsForDropdown()
      .then((clients: ClientOption[]) => {
        if (!cancelled) {
          setClientOptions(clients.map((client) => ({ value: client.id, label: client.name })));
        }
      })
      .catch((err) => console.error('Failed to load clients for credits filter:', err));
    return () => {
      cancelled = true;
    };
  }, []);

  const loadCredits = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await listCredits({
        clientId: selectedClient || undefined,
        status: selectedStatus || undefined,
        page,
        pageSize: PAGE_SIZE,
      });

      if (result.success && result.data && !('actionError' in result.data) && !('permissionError' in result.data)) {
        const data = result.data as { credits: CreditRow[]; total: number };
        setCredits(data.credits);
        setTotalItems(data.total);
      } else {
        setLoadError(
          ('error' in result && result.error) ||
          t('management.loadFailed', { defaultValue: 'Failed to load credits. Try again.' })
        );
      }
    } catch (err) {
      console.error('Failed to load credits:', err);
      setLoadError(t('management.loadFailed', { defaultValue: 'Failed to load credits. Try again.' }));
    } finally {
      setIsLoading(false);
    }
  }, [selectedClient, selectedStatus, page, t]);

  useEffect(() => {
    loadCredits();
  }, [loadCredits]);

  const columns = createColumns(t, {
    onView: setViewCredit,
    onEdit: setEditCredit,
    onExpire: setExpireCreditRow,
    onTransfer: setTransferCreditRow,
  });

  const hasActiveFilters = Boolean(selectedClient || selectedStatus);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <CustomSelect
          id="credits-client-filter"
          options={clientOptions}
          value={selectedClient || null}
          onValueChange={(value) => {
            setSelectedClient(value);
            setPage(1);
          }}
          placeholder={t('filters.allClients', { defaultValue: 'All Clients' })}
          allowClear
          className="w-64"
        />
        <CustomSelect
          id="credits-status-filter"
          options={[
            { value: 'active', label: t('status.active', { defaultValue: 'Active' }) },
            { value: 'expiring_soon', label: t('status.expiringSoonShort', { defaultValue: 'Expiring Soon' }) },
            { value: 'depleted', label: t('status.depleted', { defaultValue: 'Depleted' }) },
            { value: 'expired', label: t('status.expired', { defaultValue: 'Expired' }) },
          ]}
          value={selectedStatus || null}
          onValueChange={(value) => {
            setSelectedStatus(value as CreditStatusFilter | '');
            setPage(1);
          }}
          placeholder={t('reconciliation.allStatuses', { defaultValue: 'All Statuses' })}
          allowClear
          className="w-48"
        />
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !loadError && credits.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-muted-foreground">
            {hasActiveFilters
              ? t('management.noMatchingCredits', { defaultValue: 'No credits match these filters' })
              : t('management.noCreditsFound', { defaultValue: 'No credits found' })}
          </p>
        </div>
      ) : (
        <DataTable
          id="credits-table"
          columns={columns}
          data={credits}
          pagination={true}
          currentPage={page}
          onPageChange={setPage}
          pageSize={PAGE_SIZE}
          totalItems={totalItems}
          onRowClick={(record: CreditRow) => setViewCredit(record)}
        />
      )}

      <CreditDetailDialog
        creditId={viewCredit?.credit_id ?? null}
        clientName={viewCredit?.client_name}
        onClose={() => setViewCredit(null)}
      />
      <EditCreditExpirationDialog
        credit={editCredit}
        onClose={() => setEditCredit(null)}
      />
      <ExpireCreditDialog
        credit={expireCreditRow}
        onClose={() => setExpireCreditRow(null)}
      />
      <TransferCreditDialog
        credit={transferCreditRow}
        onClose={() => setTransferCreditRow(null)}
      />
    </div>
  );
}
