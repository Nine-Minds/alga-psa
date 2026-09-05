'use client';

import { toPlainDate } from '@alga-psa/core';
import { useRouter } from 'next/navigation';
import { getUsagePeriodEntryContext } from '../../actions/usagePeriodTotalActions';
import { UsagePeriodTotalQuickEntry } from './UsagePeriodTotalQuickEntry';
import type { IUsagePeriodTotal } from '@alga-psa/types';
import React, { useState, useEffect, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader } from '@alga-psa/ui/components/Card';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { dateFromString, dateToString } from '@alga-psa/ui/lib/dateInput';
import { todayUsageDate, usageDateFromStored, usageDateToStored } from '@alga-psa/billing/lib/usageDate';
import { buildEligibleContractLineOptions } from '@alga-psa/billing/lib/contractLineOptionLabels';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Plus, AlertTriangle, Info, MoreVertical, Package } from 'lucide-react';
import { useToast } from '@alga-psa/ui/hooks/use-toast';
import { IUsageRecord, ICreateUsageRecord, IUsageFilter } from '@alga-psa/types';
import { IService } from '@alga-psa/types';
import { IClient } from '@alga-psa/types';
import { createUsageRecord, deleteUsageRecord, getEligibleContractLinesForUI, getUsageRecords, updateUsageRecord } from '../../actions/usageActions';
import { getAllClientsForBilling } from '@alga-psa/billing/actions/billingClientsActions';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';
import { ContainerComponent } from '@alga-psa/ui/ui-reflection/types';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import ClientNameCell from '@alga-psa/ui/components/ClientNameCell';
import { ColumnDefinition } from '@alga-psa/types';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@alga-psa/ui/components/DropdownMenu';
import { getRemainingBucketUnits } from '@alga-psa/reporting/actions/report-actions/getRemainingBucketUnits';
import type { RemainingBucketUnitsResult } from '@alga-psa/reporting/actions/report-actions/getRemainingBucketUnits';
import BucketUsageChart from '@alga-psa/ui/components/charts/BucketUsageChart';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

interface UsageTrackingProps {
  initialServices: IService[];
  /**
   * Optional deep-link prefills so contract and invoice-preview surfaces can
   * route users straight to recording a period's usage for a specific
   * client/service without hunting through filters.
   */
  initialContractLineId?: string | null;
  initialConfigId?: string | null;
  returnToPreview?: boolean;
  initialClientId?: string | null;
  initialServiceId?: string | null;
  /**
   * Canonical service-period boundary prefill (`YYYY-MM-DD`, end exclusive)
   * carried by "Record Usage" deep links so the operator lands scoped to the
   * exact period that was missing usage. Both bounds must be present for the
   * period filter to activate.
   */
  initialPeriodStart?: string | null;
  initialPeriodEnd?: string | null;
}

interface UsagePeriodFilter {
  /** Plain calendar day (`YYYY-MM-DD`) the period starts on, inclusive. */
  start: string;
  /** Plain calendar day (`YYYY-MM-DD`) the period ends on, EXCLUSIVE — usage dated on this day belongs to the next period. */
  end: string;
}

/**
 * getUsageRecords applies `end_date` inclusively (`usage_date <= end_date`),
 * but a service period is `[start, end)` — usage dated on the period end
 * belongs to the next period. Anchor the exclusive boundary at the period-end
 * UTC midnight (the canonical stored form for that calendar day) and step back
 * 1ms, so every instant inside the period's final day still matches while
 * period-end entries do not.
 */
function periodEndFilterBound(periodEnd: string): string {
  const endMidnight = usageDateToStored(periodEnd);
  if (!endMidnight) return '';
  return new Date(Date.parse(endMidnight) - 1).toISOString();
}

function isReturnedActionError(value: unknown): value is { actionError: string } | { permissionError: string } {
  return isActionMessageError(value) || isActionPermissionError(value);
}

const UsageTracking: React.FC<UsageTrackingProps> = ({
  initialServices,
  initialContractLineId,
  initialConfigId,
  returnToPreview,
  initialClientId,
  initialServiceId,
  initialPeriodStart,
  initialPeriodEnd,
}) => {
  const { t } = useTranslation('msp/billing');
  const router = useRouter();
  const [entryContext, setEntryContext] = useState<{measurement_mode: string | null; total: IUsagePeriodTotal | null} | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [contextVersion, setContextVersion] = useState(0);
  const afterContextSave = () => {
    if (returnToPreview) router.push('/msp/billing?tab=invoicing&subtab=generate&resumeUsagePreview=1');
    else setContextVersion(value => value + 1);
  };
  useEffect(() => {
    if (!initialClientId || !initialContractLineId || !initialServiceId || !initialConfigId || !initialPeriodStart || !initialPeriodEnd) return;
    let active = true;
    getUsagePeriodEntryContext({client_id: initialClientId, client_contract_line_id: initialContractLineId, service_id: initialServiceId, config_id: initialConfigId, period_start: initialPeriodStart, period_end: toPlainDate(initialPeriodEnd).subtract({days: 1}).toString()})
      .then(result => { if (!active) return; if (isReturnedActionError(result)) setContextError(getErrorMessage(result)); else setEntryContext(result); })
      .catch(error => { if (active) setContextError(getErrorMessage(error)); });
    return () => { active = false; };
  }, [initialClientId, initialContractLineId, initialServiceId, initialConfigId, initialPeriodStart, initialPeriodEnd, contextVersion]);
  const { toast } = useToast();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [usageRecords, setUsageRecords] = useState<IUsageRecord[]>([]);
  const [clients, setClients] = useState<IClient[]>([]);
  const [selectedClient, setSelectedClient] = useState<string | null>(initialClientId ?? null);
  const [selectedService, setSelectedService] = useState<string>(initialServiceId ?? '');
  const [editingUsage, setEditingUsage] = useState<IUsageRecord | null>(null);
  const [usageToDelete, setUsageToDelete] = useState<string | null>(null);
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [periodFilter, setPeriodFilter] = useState<UsagePeriodFilter | null>(
    initialPeriodStart && initialPeriodEnd
      ? { start: initialPeriodStart, end: initialPeriodEnd }
      : null,
  );
  const [newUsage, setNewUsage] = useState<ICreateUsageRecord>({
    client_id: '',
    service_id: '',
    quantity: 0,
    usage_date: usageDateToStored(todayUsageDate()),
  });
  // Replay key for the additive create: identical retries of the same
  // submission (double-click, network retry) replay idempotently server-side
  // instead of recording a second consumption event. Keyed by the form
  // CONTENT — not object identity — so an untouched resubmission reuses the
  // id even across incidental state churn, while any edited field issues a
  // genuinely new request.
  const createRequestContentKey = JSON.stringify([
    newUsage.client_id,
    newUsage.service_id,
    newUsage.quantity,
    newUsage.usage_date,
    newUsage.contract_line_id ?? null,
    newUsage.comments ?? null,
  ]);
  const createRequestRef = React.useRef<{ key: string; id: string } | null>(null);
  if (!createRequestRef.current || createRequestRef.current.key !== createRequestContentKey) {
    createRequestRef.current = { key: createRequestContentKey, id: uuidv4() };
  }
  const createRequestId = createRequestRef.current.id;
  const [eligibleContractLines, setEligibleContractLines] = useState<Array<{
    client_contract_line_id: string;
    contract_line_name: string;
    contract_line_type: string;
    contract_name?: string | null;
    start_date: string;
    end_date: string | null;
    has_bucket_overlay: boolean;
  }>>([]);
  const [showContractLineSelector, setShowContractLineSelector] = useState(false);
  type BucketUsageData = RemainingBucketUnitsResult & { plan_id: string; plan_name: string };
  const [bucketData, setBucketData] = useState<BucketUsageData[]>([]);
  const [loadingBuckets, setLoadingBuckets] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const usageServiceOptions = useMemo(
    () =>
      initialServices
        .filter((service) => service.item_kind !== 'product')
        .map((service) => ({
          label: service.service_name,
          value: service.service_id,
        })),
    [initialServices],
  );

  // Reuse the loaded clients array (already enriched with logoUrl) to key logos by client_id.
  const clientLogoById = useMemo(
    () => new Map(clients.map((client) => [client.client_id, client.logoUrl ?? null])),
    [clients],
  );

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  const { automationIdProps: containerProps } = useAutomationIdAndRegister<ContainerComponent>({
    type: 'container',
    id: 'usage-tracking',
    label: 'Usage Tracking'
  });

  useEffect(() => {
    loadClients();
  }, []);

  // Deep-link prefills can arrive after mount: the billing dashboard renders
  // this tab from a server-side query snapshot first and swaps to the live URL
  // params on hydration, and client-side navigation (e.g. following "Billed on
  // recorded usage") re-renders with new props instead of remounting. The
  // filters must follow those prop changes, not just the initial render.
  useEffect(() => {
    if (initialClientId) {
      setSelectedClient(initialClientId);
    }
  }, [initialClientId]);

  useEffect(() => {
    if (initialServiceId) {
      setSelectedService(initialServiceId);
    }
  }, [initialServiceId]);

  useEffect(() => {
    if (initialPeriodStart && initialPeriodEnd) {
      // Keep the existing state object when the bounds are unchanged so the
      // records-load effect (keyed on periodFilter identity) does not refetch.
      setPeriodFilter(prev =>
        prev && prev.start === initialPeriodStart && prev.end === initialPeriodEnd
          ? prev
          : { start: initialPeriodStart, end: initialPeriodEnd },
      );
    }
  }, [initialPeriodStart, initialPeriodEnd]);

  useEffect(() => {
    loadUsageRecords();
  }, [selectedClient, selectedService, periodFilter]);

  useEffect(() => {
    if (selectedClient && selectedClient !== 'all_clients') {
      loadBucketUsageForClient(selectedClient);
    } else {
      // No client selected; clear bucket view
      setBucketData([]);
      setLoadingBuckets(false);
    }
  }, [selectedClient]);

  // Load eligible contract lines when client and service change in the form
  useEffect(() => {
    const loadEligibleContractLines = async () => {
      if (!newUsage.client_id || !newUsage.service_id) {
        setEligibleContractLines([]);
        setShowContractLineSelector(false);
        return;
      }

      try {
        const plans = await getEligibleContractLinesForUI(
          newUsage.client_id,
          newUsage.service_id,
          newUsage.usage_date
        );
        if (isReturnedActionError(plans)) {
          setEligibleContractLines([]);
          setShowContractLineSelector(false);
          toast({
            title: t('common.error', { defaultValue: 'Error' }),
            description: getErrorMessage(plans),
            variant: "destructive",
          });
          return;
        }
        setEligibleContractLines(plans);

        // Always show the contract line selector, but set a default when appropriate
        setShowContractLineSelector(true);

        // If no contract line is selected yet, try to set a default
        if (!newUsage.contract_line_id) {
          if (plans.length === 1) {
            // If there's only one contract line, use it automatically
            setNewUsage(prev => ({ ...prev, contract_line_id: plans[0].client_contract_line_id }));
          } else if (plans.length > 1) {
            // Prefer the single contract line that has a bucket overlay (if any)
            const overlayPlans = plans.filter(plan => plan.has_bucket_overlay);
            if (overlayPlans.length === 1) {
              setNewUsage(prev => ({ ...prev, contract_line_id: overlayPlans[0].client_contract_line_id }));
            }
          }
        } else if (plans.length === 0) {
          // Clear any existing contract line selection if no contract lines are available
          setNewUsage(prev => ({ ...prev, contract_line_id: undefined }));
        }
      } catch (error) {
        console.error('Error loading eligible contract lines:', error);
      }
    };

    loadEligibleContractLines();
  }, [newUsage.client_id, newUsage.service_id]);

  const loadClients = async () => {
    try {
      const fetchedClients = await getAllClientsForBilling();
      if (isReturnedActionError(fetchedClients)) {
        setClients([]);
        toast({
          title: t('common.error', { defaultValue: 'Error' }),
          description: getErrorMessage(fetchedClients),
          variant: "destructive",
        });
        return;
      }
      setClients(fetchedClients);
    } catch (error) {
      toast({
        title: t('common.error', { defaultValue: 'Error' }),
        description: t('usage.toast.loadClientsError', { defaultValue: 'Failed to load clients' }),
        variant: "destructive",
      });
    }
  };

  const loadBucketUsageForClient = async (clientId: string) => {
    try {
      setLoadingBuckets(true);
      const currentDate = new Date().toISOString().split('T')[0];
      const buckets = await getRemainingBucketUnits({ clientId, currentDate });
      if (isReturnedActionError(buckets)) {
        toast({
          title: t('common.error', { defaultValue: 'Error' }),
          description: getErrorMessage(buckets),
          variant: "destructive",
        });
        setBucketData([]);
        return;
      }
      // Map to chart's expected shape
      const mapped: BucketUsageData[] = buckets.map(b => ({
        ...b,
        plan_id: b.contract_line_id,
        plan_name: b.contract_line_name,
      }));
      setBucketData(mapped);
    } catch (error) {
      console.error('Error loading bucket usage:', error);
    } finally {
      setLoadingBuckets(false);
    }
  };

  const loadUsageRecords = async () => {
    try {
      setIsLoading(true);
      const filter: IUsageFilter = {};
      if (selectedClient !== null && selectedClient !== 'all_clients') filter.client_id = selectedClient;
      if (selectedService && selectedService !== 'all_services') filter.service_id = selectedService;
      if (periodFilter) {
        const startBound = usageDateToStored(periodFilter.start);
        const endBound = periodEndFilterBound(periodFilter.end);
        if (startBound) filter.start_date = startBound;
        if (endBound) filter.end_date = endBound;
      }

      const records = await getUsageRecords(filter);
      if (isReturnedActionError(records)) {
        setUsageRecords([]);
        toast({
          title: t('common.error', { defaultValue: 'Error' }),
          description: getErrorMessage(records),
          variant: "destructive",
        });
        return;
      }
      setUsageRecords(records);
    } catch (error) {
      toast({
        title: t('common.error', { defaultValue: 'Error' }),
        description: getErrorMessage(error) || t('usage.toast.loadUsageError', { defaultValue: 'Failed to load usage records' }),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddUsage = async () => {
    try {
      setIsSaving(true);
      const result = await createUsageRecord({ ...newUsage, request_id: createRequestId });
      if (isReturnedActionError(result)) {
        toast({
          title: t('common.error', { defaultValue: 'Error' }),
          description: getErrorMessage(result),
          variant: "destructive",
        });
        return;
      }
      setIsAddModalOpen(false);
      afterContextSave();
      loadUsageRecords();
      toast({
        title: t('common.success', { defaultValue: 'Success' }),
        description: t('usage.toast.createSuccess', { defaultValue: 'Usage record created successfully' }),
      });
    } catch (error) {
      toast({
        title: t('common.error', { defaultValue: 'Error' }),
        description: getErrorMessage(error) || t('usage.toast.createError', { defaultValue: 'Failed to create usage record' }),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditUsage = async () => {
    if (!editingUsage) return;

    try {
      setIsSaving(true);
      const result = await updateUsageRecord({
        usage_id: editingUsage.usage_id,
        ...newUsage,
      });
      if (isReturnedActionError(result)) {
        toast({
          title: t('common.error', { defaultValue: 'Error' }),
          description: getErrorMessage(result),
          variant: "destructive",
        });
        return;
      }
      setEditingUsage(null);
      loadUsageRecords();
      toast({
        title: t('common.success', { defaultValue: 'Success' }),
        description: t('usage.toast.updateSuccess', { defaultValue: 'Usage record updated successfully' }),
      });
    } catch (error) {
      toast({
        title: t('common.error', { defaultValue: 'Error' }),
        description: getErrorMessage(error) || t('usage.toast.updateError', { defaultValue: 'Failed to update usage record' }),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteUsage = async (usageId: string) => {
    setUsageToDelete(usageId);
    setIsDeleteDialogOpen(true);
  };

  const confirmDeleteUsage = async () => {
    if (!usageToDelete) return;

    try {
      setIsSaving(true);
      const result = await deleteUsageRecord(usageToDelete);
      if (isReturnedActionError(result)) {
        toast({
          title: t('common.error', { defaultValue: 'Error' }),
          description: getErrorMessage(result),
          variant: "destructive",
        });
        return;
      }
      loadUsageRecords();
      toast({
        title: t('common.success', { defaultValue: 'Success' }),
        description: t('usage.toast.deleteSuccess', { defaultValue: 'Usage record deleted successfully' }),
      });
    } catch (error) {
      toast({
        title: t('common.error', { defaultValue: 'Error' }),
        description: getErrorMessage(error) || t('usage.toast.deleteError', { defaultValue: 'Failed to delete usage record' }),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
      setIsDeleteDialogOpen(false);
      setUsageToDelete(null);
    }
  };

  // Default new entries to today, unless a period filter is active and today
  // falls outside [start, end) — the operator followed a deep link to backfill
  // that specific period, so start the date inside it (at the period start).
  const defaultUsageDate = (): string => {
    const today = todayUsageDate();
    if (periodFilter && (today < periodFilter.start || today >= periodFilter.end)) {
      return periodFilter.start;
    }
    return today;
  };

  const resetForm = () => {
    setNewUsage({
      client_id: initialClientId ?? '',
      service_id: initialServiceId ?? '',
      quantity: 0,
      usage_date: usageDateToStored(defaultUsageDate()),
      contract_line_id: initialContractLineId ?? undefined,
    });
    setEditingUsage(null);
    setEligibleContractLines([]);
    setShowContractLineSelector(false);
  };

  const columns: ColumnDefinition<IUsageRecord>[] = [
    {
      title: t('usage.table.client', { defaultValue: 'Client' }),
      dataIndex: 'client_name',
      render: (value, record) => <ClientNameCell clientName={value as string | null | undefined} clientId={record.client_id} logoUrl={clientLogoById.get(record.client_id) ?? null} />,
    },
    {
      title: t('usage.table.service', { defaultValue: 'Service' }),
      dataIndex: 'service_name',
    },
    {
      title: t('usage.table.quantity', { defaultValue: 'Quantity' }),
      dataIndex: 'quantity',
    },
    {
      title: t('usage.table.usageDate', { defaultValue: 'Usage Date' }),
      dataIndex: 'usage_date',
      // Render the plain calendar day from a local-midnight Date so the shown
      // date is the day the operator picked, never a UTC-boundary shift.
      render: (value) => {
        const plain = usageDateFromStored(value as string | Date | null | undefined);
        const localMidnight = dateFromString(plain);
        return localMidnight ? localMidnight.toLocaleDateString() : '';
      },
    },
    {
      title: t('usage.table.contractLine', { defaultValue: 'Contract Line' }),
      dataIndex: 'contract_line_id',
      render: (value, record) => {
        // This would ideally be populated from a join in the backend
        // For now, we'll just show the ID or "Default"
        return value
          ? t('usage.table.contractLineLabel', { defaultValue: 'Contract Line: {{id}}...', id: value.substring(0, 8) })
          : t('usage.table.defaultContractLine', { defaultValue: 'Default Contract Line' });
      },
    },
    {
      title: t('usage.table.actions', { defaultValue: 'Actions' }),
      dataIndex: 'usage_id',
      width: '5%',
      render: (_, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-8 w-8 p-0"
              id={`usage-actions-menu-${record.usage_id}`}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">{t('common.openMenu', { defaultValue: 'Open menu' })}</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id={`edit-usage-${record.usage_id}`}
              onClick={() => {
                setEditingUsage(record);
                setNewUsage({
                  client_id: record.client_id,
                  service_id: record.service_id,
                  quantity: record.quantity,
                  usage_date: usageDateToStored(usageDateFromStored(record.usage_date)),
                  contract_line_id: record.contract_line_id,
                });
                setIsAddModalOpen(true);
              }}
              disabled={isSaving}
            >
              {t('usage.actions.edit', { defaultValue: 'Edit' })}
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`delete-usage-${record.usage_id}`}
              onClick={() => handleDeleteUsage(record.usage_id)}
              disabled={isSaving}
            >
              {t('usage.actions.delete', { defaultValue: 'Delete' })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <ReflectionContainer {...containerProps}>
      {contextError && <p role="alert">{contextError}</p>}
      {entryContext?.measurement_mode === 'period_total' && initialClientId && initialContractLineId && initialServiceId && initialConfigId && initialPeriodStart && initialPeriodEnd && (
        <section aria-label={t('usage.periodReport', {defaultValue: 'Period usage report'})} className="mb-4 rounded border p-4">
          {entryContext.total?.lifecycle_state === 'billed' ? <p>{t('usage.periodAlreadyInvoiced', {defaultValue: 'This period is already invoiced. Correct it through the invoice adjustment process.'})}</p> : (
            <ul><UsagePeriodTotalQuickEntry clientId={initialClientId} entryId="usage-tracking-context" onSaved={afterContextSave}
              status={{client_contract_line_id: initialContractLineId, config_id: initialConfigId, service_id: initialServiceId,
                service_name: initialServices.find(service => service.service_id === initialServiceId)?.service_name ?? null,
                service_period_start: initialPeriodStart, service_period_end: toPlainDate(initialPeriodEnd).subtract({days: 1}).toString(),
                measurement_mode: 'period_total', status: entryContext.total ? 'billable' : 'unreported', minimum_usage: 0}}
              existing={entryContext.total ? {quantity: Number(entryContext.total.quantity), revision: Number(entryContext.total.revision)} : undefined}/></ul>
          )}
        </section>
      )}
      {/* Bucket Usage Overview */}
      {(loadingBuckets || bucketData.length > 0) && (
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center">
              <Package className="h-5 w-5 text-blue-600 mr-2" />
              <h3 className="text-lg font-semibold">{t('usage.bucketHoursOverview', { defaultValue: 'Bucket Hours Overview' })}</h3>
            </div>
          </CardHeader>
          <CardContent>
            {loadingBuckets ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-40 w-full" />
                ))}
              </div>
            ) : bucketData.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {bucketData.map((bucket) => (
                  <BucketUsageChart
                    key={`${bucket.plan_id}-${bucket.service_id}`}
                    bucketData={bucket}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('usage.states.noActiveBucketPlans', { defaultValue: 'No active bucket plans found.' })}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Usage Records Table */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">{t('usage.usageRecords', { defaultValue: 'Usage Records' })}</h3>
            <Button
              id="add-usage-button"
              onClick={() => {
                resetForm();
                setIsAddModalOpen(true);
              }}
              className="flex items-center gap-2"
              disabled={isSaving}
            >
              <Plus className="h-4 w-4" />
              {t('usage.actions.addUsage', { defaultValue: 'Add Usage' })}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center space-x-2 mb-4">
              <div className="flex-1">
                <Label htmlFor="client-filter">{t('usage.filters.client', { defaultValue: 'Client' })}</Label>
                <CustomSelect
                  id="client-filter"
                  value={selectedClient || 'all_clients'}
                  onValueChange={value => setSelectedClient(value === 'all_clients' ? null : value)}
                  placeholder={t('usage.filters.clientPlaceholder', { defaultValue: 'Filter by client' })}
                  options={[
                    { value: 'all_clients', label: t('usage.filters.allClients', { defaultValue: 'All Clients' }) },
                    ...clients.map(client => ({
                      value: client.client_id,
                      label: client.client_name
                    }))
                  ]}
                />
              </div>
              <div className="flex-1">
                <Label htmlFor="service-filter">{t('usage.filters.service', { defaultValue: 'Service' })}</Label>
                <CustomSelect
                  id="service-filter"
                  value={selectedService || 'all_services'}
                  onValueChange={value => setSelectedService(value === 'all_services' ? '' : value)}
                  placeholder={t('usage.filters.servicePlaceholder', { defaultValue: 'Filter by service' })}
                  options={[
                    { value: 'all_services', label: t('usage.filters.allServices', { defaultValue: 'All Services' }) },
                    ...usageServiceOptions,
                  ]}
                />
              </div>
              <div className="flex items-end">
                <Button
                  id="clear-filters-button"
                  variant="outline"
                  onClick={() => {
                    setSelectedService('all_services');
                    setSelectedClient('all_clients');
                    setPeriodFilter(null);
                  }}
                >
                  {t('usage.actions.resetFilters', { defaultValue: 'Reset' })}
                </Button>
              </div>
            </div>

            {periodFilter && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-[rgb(var(--color-border-300))] px-3 py-2 text-sm text-[rgb(var(--color-text-700))]">
                <span className="flex items-center gap-2">
                  <Info className="h-4 w-4 shrink-0 text-blue-600" />
                  {t('usage.periodFilter.notice', {
                    defaultValue: 'Showing usage for the service period {{start}} to {{end}}',
                    start: dateFromString(periodFilter.start)?.toLocaleDateString() ?? periodFilter.start,
                    end: dateFromString(toPlainDate(periodFilter.end).subtract({days: 1}).toString())?.toLocaleDateString() ?? periodFilter.end,
                  })}
                </span>
                <Button
                  id="usage-period-filter-clear-button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPeriodFilter(null)}
                >
                  {t('usage.periodFilter.clear', { defaultValue: 'Clear' })}
                </Button>
              </div>
            )}

            {isLoading ? (
              <LoadingIndicator
                layout="stacked"
                className="py-10 text-muted-foreground"
                spinnerProps={{ size: 'md' }}
                text={t('usage.states.loadingRecords', { defaultValue: 'Loading usage records' })}
              />
            ) : (
              <DataTable
                id="usage-tracking-table"
                data={usageRecords}
                columns={columns}
                pagination={true}
                currentPage={currentPage}
                onPageChange={setCurrentPage}
                pageSize={pageSize}
                onItemsPerPageChange={handlePageSizeChange}
                onRowClick={(record) => {
                  setEditingUsage(record);
                  setNewUsage({
                    client_id: record.client_id,
                    service_id: record.service_id,
                    quantity: record.quantity,
                    usage_date: usageDateToStored(usageDateFromStored(record.usage_date)),
                    contract_line_id: record.contract_line_id,
                  });
                  setIsAddModalOpen(true);
                }}
              />
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          resetForm();
        }}
        id="usage-form-dialog"
        title={editingUsage
          ? t('usage.dialog.editTitle', { defaultValue: 'Edit Usage Record' })
          : t('usage.dialog.addTitle', { defaultValue: 'Add Usage Record' })}
        disableFocusTrap
        footer={(
          <div className="flex justify-end space-x-2">
            <Button
              id="cancel-usage-button"
              variant="outline"
              onClick={() => setIsAddModalOpen(false)}
              disabled={isSaving}
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              id="submit-usage-button"
              onClick={editingUsage ? handleEditUsage : handleAddUsage}
              disabled={isSaving}
            >
              {editingUsage
                ? t('usage.actions.updateUsage', { defaultValue: 'Update Usage' })
                : t('usage.actions.addUsage', { defaultValue: 'Add Usage' })}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <div className="space-y-4">
            <div>
              <Label htmlFor="client-select">{t('usage.dialog.fields.client', { defaultValue: 'Client' })}</Label>
              <ClientPicker
                id="client-select"
                clients={clients}
                selectedClientId={newUsage.client_id}
                onSelect={(id) => setNewUsage({ ...newUsage, client_id: id || '' })}
                filterState={filterState}
                onFilterStateChange={setFilterState}
                clientTypeFilter={clientTypeFilter}
                onClientTypeFilterChange={setClientTypeFilter}
              />
            </div>
            <div>
              <Label htmlFor="service-select">{t('usage.dialog.fields.service', { defaultValue: 'Service' })}</Label>
              <CustomSelect
                id="service-select"
                value={newUsage.service_id}
                onValueChange={(value: string) => setNewUsage({ ...newUsage, service_id: value })}
                placeholder={t('usage.dialog.servicePlaceholder', { defaultValue: 'Select service' })}
                options={usageServiceOptions}
              />
            </div>
            <div>
              <Label htmlFor="quantity-input">{t('usage.dialog.fields.quantity', { defaultValue: 'Quantity' })}</Label>
              <Input
                id="quantity-input"
                type="number"
                value={newUsage.quantity}
                onChange={(e) => setNewUsage({ ...newUsage, quantity: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label htmlFor="usage-date-input">{t('usage.dialog.fields.usageDate', { defaultValue: 'Usage Date' })}</Label>
              <DatePicker
                id="usage-date-input"
                label={t('usage.dialog.fields.usageDate', { defaultValue: 'Usage Date' })}
                placeholder={t('usage.dialog.fields.usageDate', { defaultValue: 'Usage Date' })}
                clearable
                className="w-full"
                value={dateFromString(usageDateFromStored(newUsage.usage_date))}
                onChange={(date) => setNewUsage({
                  ...newUsage,
                  usage_date: date ? usageDateToStored(dateToString(date)) : '',
                })}
              />
            </div>
            <div>
              <Label htmlFor="comments-input">{t('usage.dialog.fields.comments', { defaultValue: 'Comments (Optional)' })}</Label>
              <Input
                id="comments-input"
                type="text"
                onChange={(e) => setNewUsage({ ...newUsage, comments: e.target.value })}
              />
            </div>

            {/* Contract Line Selector with enhanced guidance */}
            {showContractLineSelector && (
              <div>
                {eligibleContractLines.length > 1 && (
                  <Alert variant="info" className="mb-2">
                    <Info className="h-4 w-4" />
                    <AlertDescription>
                      {t('usage.contractLineGuidance.multipleLines', { defaultValue: 'This service appears in multiple contract lines. Please select which contract line to bill against.' })}
                    </AlertDescription>
                  </Alert>
                )}

                <div className="flex items-center space-x-1">
                  <label className={`block text-sm font-medium ${eligibleContractLines.length > 1 ? 'text-blue-700' : 'text-[rgb(var(--color-text-700))]'}`}>
                    {t('usage.dialog.fields.contractLine', { defaultValue: 'Contract Line' })} <span className="text-red-500">*</span>
                  </label>
                  <div className="relative inline-block">
                    <div
                      className="cursor-help"
                      title={!newUsage.client_id
                        ? t('usage.contractLineGuidance.tooltipNoClient', { defaultValue: 'Client information not available. Usage will route to the system-managed default contract.' })
                        : eligibleContractLines.length > 1
                          ? t('usage.contractLineGuidance.tooltipMultiple', { defaultValue: 'This service appears in multiple contract lines. Please select which contract line to use. When only one of them is a bucket contract line, it is selected by default.' })
                          : eligibleContractLines.length === 1
                            ? t('usage.contractLineGuidance.tooltipSingle', { defaultValue: 'This usage will be billed under the "{{name}}" contract line.', name: eligibleContractLines[0].contract_line_name })
                            : t('usage.contractLineGuidance.tooltipNone', { defaultValue: 'No eligible contract lines found for this service.' })}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-muted-foreground">
                        <circle cx="12" cy="12" r="10"></circle>
                        <path d="M12 16v-4M12 8h.01"></path>
                      </svg>
                    </div>
                  </div>
                </div>

                <CustomSelect
                  id="contract-line-select"
                  value={newUsage.contract_line_id || ''}
                  onValueChange={(value: string) => setNewUsage({ ...newUsage, contract_line_id: value })}
                  disabled={!newUsage.client_id || eligibleContractLines.length <= 1}
                  className={`${eligibleContractLines.length > 1 ? 'border-blue-300 focus:border-blue-500 focus:ring-blue-500' : ''}`}
                  placeholder={!newUsage.client_id
                    ? t('usage.contractLineGuidance.placeholderNoClient', { defaultValue: 'Using system-managed default contract' })
                    : eligibleContractLines.length === 0
                      ? t('usage.contractLineGuidance.placeholderNone', { defaultValue: 'No eligible contract lines' })
                      : eligibleContractLines.length === 1
                        ? t('usage.contractLineGuidance.placeholderSingle', { defaultValue: 'Using {{name}}', name: eligibleContractLines[0].contract_line_name })
                        : t('usage.contractLineGuidance.placeholderSelect', { defaultValue: 'Select a contract line' })}
                  options={buildEligibleContractLineOptions(eligibleContractLines)}
                />

                {eligibleContractLines.length > 1 && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    <span className="flex items-center">
                      <AlertTriangle className="h-3 w-3 text-amber-500 mr-1" />
                      {t('usage.contractLineGuidance.wrongContractLineWarning', { defaultValue: 'Selecting the wrong contract line may result in incorrect billing' })}
                    </span>
                  </div>
                )}

                {!newUsage.client_id ? (
                  <small className="text-muted-foreground mt-1">
                    {t('usage.contractLineGuidance.noClientNotice', { defaultValue: 'Client information not available. Usage will route to the system-managed default contract.' })}
                  </small>
                ) : eligibleContractLines.length === 0 ? (
                  <small className="text-muted-foreground mt-1">
                    {t('usage.contractLineGuidance.noEligibleNotice', { defaultValue: 'No eligible contract lines found for this service.' })}
                  </small>
                ) : <></>}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={confirmDeleteUsage}
        title={t('usage.deleteDialog.title', { defaultValue: 'Delete Usage Record' })}
        message={t('usage.deleteDialog.message', { defaultValue: 'Are you sure you want to delete this usage record? This action cannot be undone.' })}
        confirmLabel={t('common.delete', { defaultValue: 'Delete' })}
        cancelLabel={t('common.cancel', { defaultValue: 'Cancel' })}
      />
    </ReflectionContainer>
  );
};

export default UsageTracking;
