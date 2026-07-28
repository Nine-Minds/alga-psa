'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import ClientNameCell from '@alga-psa/ui/components/ClientNameCell';
import Drawer from '@alga-psa/ui/components/Drawer';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { toast } from 'react-hot-toast';
import { formatCurrencyFromMinorUnits, formatDateOnly } from '@alga-psa/core';
import type { ColumnDefinition, ICreditReconciliationReport, ReconciliationStatus } from '@alga-psa/types';
import {
  fetchClientsForDropdown,
  fetchReconciliationReports,
  fetchReconciliationStats,
} from '@alga-psa/reporting/actions/reconciliationReportActions';
import { validateClientCredit } from '@alga-psa/billing/actions/creditReconciliationActions';
import { scheduledCreditBalanceValidation } from '@alga-psa/billing/actions/creditActions';
import ReconciliationReportDetail from './ReconciliationReportDetail';
import { getIssueTypeLabel, getStatusBadge } from './reconciliationPresentation';

const PAGE_SIZE = 10;

type ReconciliationReportRow = ICreditReconciliationReport & {
  client_name?: string;
  logoUrl?: string | null;
};

interface ReconciliationStats {
  totalDiscrepancies: number;
  totalAmount: number;
  openCount: number;
  inReviewCount: number;
  resolvedCount: number;
}

interface ClientOption {
  id: string;
  name: string;
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm text-[rgb(var(--color-text-500))]">{label}</p>
        <p className="text-2xl font-bold text-[rgb(var(--color-text-900))]">{value}</p>
      </CardContent>
    </Card>
  );
}

export default function ReconciliationTab() {
  const { t } = useTranslation('msp/credits');

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [stats, setStats] = useState<ReconciliationStats | null>(null);
  const [reports, setReports] = useState<ReconciliationReportRow[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [page, setPage] = useState(1);
  const [selectedClient, setSelectedClient] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<ReconciliationStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runningValidation, setRunningValidation] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);

  const refresh = useCallback(() => setRefreshCounter((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchClientsForDropdown();
        if (!cancelled) {
          setClients(result);
        }
      } catch (error) {
        console.error('Error loading clients for reconciliation filter:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadError(null);
        setLoading(true);
        const [statsResult, reportsResult] = await Promise.all([
          fetchReconciliationStats(),
          fetchReconciliationReports({
            clientId: selectedClient || undefined,
            status: selectedStatus || undefined,
            page,
            pageSize: PAGE_SIZE,
          }),
        ]);
        if (cancelled) return;
        setStats(statsResult);
        setReports(reportsResult.reports as ReconciliationReportRow[]);
        setTotalItems(reportsResult.total);
      } catch (error) {
        console.error('Error loading reconciliation reports:', error);
        if (!cancelled) {
          setLoadError(t('reconciliation.errors.loadFailed', {
            defaultValue: 'Failed to load reconciliation reports. Please refresh and try again.',
          }));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedClient, selectedStatus, page, refreshCounter, t]);

  const handleRunReconciliation = async () => {
    try {
      setRunningValidation(true);
      if (selectedClient) {
        const result = await validateClientCredit(selectedClient);
        if (isActionMessageError(result) || isActionPermissionError(result)) {
          toast.error(getErrorMessage(result));
          return;
        }
        toast.success(t('reconciliation.validationResult', {
          balanceCount: result.balanceDiscrepancyCount,
          trackingCount: result.missingTrackingCount + result.inconsistentTrackingCount,
          defaultValue: 'Validation completed: Found {{balanceCount}} balance discrepancies and {{trackingCount}} tracking issues.',
        }));
      } else {
        const result = await scheduledCreditBalanceValidation();
        if (isActionMessageError(result) || isActionPermissionError(result)) {
          toast.error(getErrorMessage(result));
          return;
        }
        toast.success(t('reconciliation.validationCompletedAllClients', {
          defaultValue: 'Reconciliation completed for all clients.',
        }));
      }
      refresh();
    } catch (error) {
      console.error('Error running reconciliation:', error);
      toast.error(t('reconciliation.errors.runFailed', {
        defaultValue: 'Failed to run reconciliation. Please try again.',
      }));
    } finally {
      setRunningValidation(false);
    }
  };

  const columns: ColumnDefinition<ReconciliationReportRow>[] = [
    {
      title: t('columns.client', { defaultValue: 'Client' }),
      dataIndex: 'client_name',
      render: (value, record) => (
        <ClientNameCell
          clientName={value as string | null | undefined}
          clientId={record.client_id}
          logoUrl={record.logoUrl ?? null}
        />
      ),
    },
    {
      title: t('columns.issueType', { defaultValue: 'Issue Type' }),
      dataIndex: 'metadata',
      render: (_value, record) => getIssueTypeLabel(t, record),
    },
    {
      title: t('columns.expectedBalance', { defaultValue: 'Expected Balance' }),
      dataIndex: 'expected_balance',
      render: (value: number) => formatCurrencyFromMinorUnits(value),
    },
    {
      title: t('columns.actualBalance', { defaultValue: 'Actual Balance' }),
      dataIndex: 'actual_balance',
      render: (value: number) => formatCurrencyFromMinorUnits(value),
    },
    {
      title: t('columns.discrepancy', { defaultValue: 'Discrepancy' }),
      dataIndex: 'difference',
      render: (value: number) => (
        <span className={value >= 0 ? 'text-[rgb(var(--color-primary-700))]' : 'text-[rgb(var(--color-destructive-600))]'}>
          {formatCurrencyFromMinorUnits(value)}
        </span>
      ),
    },
    {
      title: t('columns.detected', { defaultValue: 'Detected' }),
      dataIndex: 'detection_date',
      render: (value: string | Date) => <span>{formatDateOnly(new Date(value))}</span>,
    },
    {
      title: t('columns.status', { defaultValue: 'Status' }),
      dataIndex: 'status',
      render: (_value, record) => getStatusBadge(t, record.status),
    },
  ];

  const statusOptions = [
    { value: 'open', label: t('status.open', { defaultValue: 'Open' }) },
    { value: 'in_review', label: t('status.inReview', { defaultValue: 'In Review' }) },
    { value: 'resolved', label: t('status.resolved', { defaultValue: 'Resolved' }) },
  ];

  const clientOptions = clients.map((client) => ({ value: client.id, label: client.name }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
              {t('reconciliation.selectClient', { defaultValue: 'Select Client' })}
            </label>
            <CustomSelect
              id="reconciliation-client-filter"
              options={clientOptions}
              value={selectedClient || null}
              onValueChange={(value) => {
                setSelectedClient(value);
                setPage(1);
              }}
              placeholder={t('reconciliation.allClients', { defaultValue: 'All Clients' })}
              allowClear
              className="w-64"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
              {t('reconciliation.status', { defaultValue: 'Status' })}
            </label>
            <CustomSelect
              id="reconciliation-status-filter"
              options={statusOptions}
              value={selectedStatus || null}
              onValueChange={(value) => {
                setSelectedStatus(value as ReconciliationStatus | '');
                setPage(1);
              }}
              placeholder={t('reconciliation.allStatuses', { defaultValue: 'All Statuses' })}
              allowClear
              className="w-48"
            />
          </div>
          <Button
            id="reconciliation-reset-filters-button"
            variant="outline"
            onClick={() => {
              setSelectedClient('');
              setSelectedStatus('');
              setPage(1);
            }}
          >
            {t('actions.reset', { defaultValue: 'Reset' })}
          </Button>
        </div>
        <Button
          id="run-reconciliation-button"
          onClick={handleRunReconciliation}
          disabled={runningValidation}
        >
          {runningValidation
            ? t('actions.running', { defaultValue: 'Running...' })
            : selectedClient
              ? t('actions.runReconciliation', { defaultValue: 'Run Reconciliation' })
              : t('actions.runReconciliationAllClients', { defaultValue: 'Run Reconciliation (All Clients)' })}
        </Button>
      </div>

      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatCard
            label={t('stats.openIssues', { defaultValue: 'Open Issues' })}
            value={stats.openCount}
          />
          <StatCard
            label={t('stats.inReviewCount', { defaultValue: 'In Review' })}
            value={stats.inReviewCount}
          />
          <StatCard
            label={t('stats.resolvedCount', { defaultValue: 'Resolved' })}
            value={stats.resolvedCount}
          />
          <StatCard
            label={t('stats.totalDiscrepancyAmount', { defaultValue: 'Total Discrepancy Amount' })}
            value={formatCurrencyFromMinorUnits(stats.totalAmount)}
          />
        </div>
      )}

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : reports.length === 0 && !loadError ? (
        <div className="p-8 text-center">
          <p className="text-muted-foreground">
            {t('reconciliation.noReportsFound', { defaultValue: 'No reconciliation reports found' })}
          </p>
        </div>
      ) : (
        <DataTable
          id="reconciliation-reports-table"
          columns={columns}
          data={reports}
          pagination={true}
          currentPage={page}
          onPageChange={setPage}
          pageSize={PAGE_SIZE}
          totalItems={totalItems}
          onRowClick={(record: ReconciliationReportRow) => setSelectedReportId(record.report_id)}
        />
      )}

      <Drawer
        id="reconciliation-report-drawer"
        isOpen={selectedReportId !== null}
        onClose={() => setSelectedReportId(null)}
        width="720px"
      >
        {selectedReportId && (
          <ReconciliationReportDetail
            reportId={selectedReportId}
            onDataChanged={refresh}
          />
        )}
      </Drawer>
    </div>
  );
}
