'use client'

// BillingCycles.tsx
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardContent } from '@alga-psa/ui/components/Card';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Info, Search } from 'lucide-react';
import {
  getAllBillingCycles
} from '@alga-psa/billing/actions/billingCycleActions';
import { getClientBillingScheduleSummaries } from '@alga-psa/billing/actions/billingScheduleActions';
import {
  getAllClientsPaginatedForBilling,
  getClientsWithBillingCycleRangePaginatedForBilling,
  getActiveClientContractsByClientIdsForBilling,
} from '@alga-psa/billing/actions/billingClientsActions';
// BillingCycleDateRange type defined locally to avoid circular dependency
type BillingCycleDateRange = { from?: string; to?: string };
import { getContracts } from '@alga-psa/billing/actions/contractActions';
import { BillingCycleType, IClient } from '@alga-psa/types';
import { ColumnDefinition } from '@alga-psa/types';
import { IContract } from '@alga-psa/types';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { DateRangePicker, type DateRange } from '@alga-psa/ui/components/DateRangePicker';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const getDefaultStartDate = () => {
  const date = new Date();
  date.setDate(date.getDate() - 7);
  date.setHours(0, 0, 0, 0);
  return date;
};

const buildDateRangeFilter = (range: DateRange): BillingCycleDateRange | undefined => {
  if (!range.from && !range.to) {
    return undefined;
  }

  const from = range.from
    ? new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate(), 0, 0, 0, 0).toISOString()
    : undefined;
  const to = range.to
    ? new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate(), 23, 59, 59, 999).toISOString()
    : undefined;

  return { from, to };
};

const MONTH_KEY_BY_NUMBER = {
  1: 'january',
  2: 'february',
  3: 'march',
  4: 'april',
  5: 'may',
  6: 'june',
  7: 'july',
  8: 'august',
  9: 'september',
  10: 'october',
  11: 'november',
  12: 'december',
} as const;

const BillingCycles: React.FC = () => {
  const { t } = useTranslation('msp/invoicing');
  const [billingCycles, setBillingCycles] = useState<{ [clientId: string]: BillingCycleType }>({});
  const [billingSchedules, setBillingSchedules] = useState<{
    [clientId: string]: { billingCycle: BillingCycleType; anchor: { dayOfMonth: number | null; monthOfYear: number | null; dayOfWeek: number | null; referenceDate: string | null } }
  }>({});
  const [clients, setClients] = useState<Partial<IClient>[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize] = useState<number>(10);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [sortBy, setSortBy] = useState<string>('client_name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [pendingDateRange, setPendingDateRange] = useState<DateRange>(() => ({
    from: getDefaultStartDate(),
    to: undefined,
  }));
  const [appliedDateRange, setAppliedDateRange] = useState<DateRange>(() => ({
    from: getDefaultStartDate(),
    to: undefined,
  }));
  const [clientContracts, setClientContracts] = useState<{
    [clientId: string]: Array<{ clientContractId: string; contractId: string }>;
  }>({});
  const [contracts, setContracts] = useState<{ [contractId: string]: IContract }>({});

  // Debounce search term
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300); // 300ms delay

    return () => {
      clearTimeout(handler);
    };
  }, [searchTerm]);

  useEffect(() => {
    fetchData();
  }, [currentPage, debouncedSearchTerm, sortBy, sortDirection, appliedDateRange]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const rangeFilter = buildDateRangeFilter(appliedDateRange);
      const clientsPromise = rangeFilter
        ? getClientsWithBillingCycleRangePaginatedForBilling({
          page: currentPage,
          pageSize,
          searchTerm: debouncedSearchTerm,
          includeInactive: true,
          sortBy,
          sortDirection,
          dateRange: rangeFilter
        })
        : getAllClientsPaginatedForBilling({
          page: currentPage,
          pageSize,
          searchTerm: debouncedSearchTerm,
          includeInactive: true,
          sortBy,
          sortDirection
        });

      const [cycles, clientsResponse, allContracts] = await Promise.all([
        getAllBillingCycles(),
        clientsPromise,
        getContracts()
      ]);

      setBillingCycles(cycles);
      setClients(clientsResponse.clients);
      setTotalCount(clientsResponse.totalCount);

      // Create a map of contracts by contract_id
      const contractsMap: { [contractId: string]: IContract } = {};
      (allContracts as unknown as IContract[]).forEach(contract => {
        if (contract.contract_id) {
          contractsMap[contract.contract_id] = contract;
        }
      });
      setContracts(contractsMap);

      const clientIds = clientsResponse.clients
        .map(client => client.client_id)
        .filter((clientId): clientId is string => Boolean(clientId));

      if (clientIds.length === 0) {
        setClientContracts({});
        setBillingSchedules({});
        setError(null);
        return;
      }

      const [clientAssignedContracts, scheduleSummaries] = await Promise.all([
        getActiveClientContractsByClientIdsForBilling(clientIds),
        getClientBillingScheduleSummaries(clientIds)
      ]);

      // Build active assignment map per client.
      const clientContractsMap: {
        [clientId: string]: Array<{ clientContractId: string; contractId: string }>;
      } = {};
      clientAssignedContracts.forEach(contract => {
        if (!contract.client_id || !contract.contract_id || !contract.client_contract_id) {
          return;
        }

        const existingAssignments = clientContractsMap[contract.client_id] ?? [];
        if (existingAssignments.some((assignment) => assignment.clientContractId === contract.client_contract_id)) {
          return;
        }

        existingAssignments.push({
          clientContractId: contract.client_contract_id,
          contractId: contract.contract_id,
        });
        clientContractsMap[contract.client_id] = existingAssignments;
      });

      setClientContracts(clientContractsMap);

      const scheduleMap: typeof billingSchedules = {};
      for (const [id, summary] of Object.entries(scheduleSummaries)) {
        scheduleMap[id] = {
          billingCycle: summary.billingCycle,
          anchor: {
            dayOfMonth: summary.anchor.dayOfMonth ?? null,
            monthOfYear: summary.anchor.monthOfYear ?? null,
            dayOfWeek: summary.anchor.dayOfWeek ?? null,
            referenceDate: summary.anchor.referenceDate ? summary.anchor.referenceDate.slice(0, 10) : null
          }
        };
      }
      setBillingSchedules(scheduleMap);

      setError(null);
    } catch (error) {
      console.error('Error fetching data:', error);
      setError(t('billingCycles.errors.loadFailed', {
        defaultValue: 'Failed to fetch data. Please try again later.',
      }));
    } finally {
      setLoading(false);
    }
  };

  const formatAnchorSummary = (clientId: string): string => {
    const schedule = billingSchedules[clientId];
    if (!schedule) {
      return t('billingCycles.values.dash', { defaultValue: '—' });
    }
    const cycle = schedule.billingCycle;
    const anchor = schedule.anchor;

    switch (cycle) {
      case 'weekly':
        return anchor.dayOfWeek
          ? t('billingCycles.values.weekday', {
            day: anchor.dayOfWeek,
            defaultValue: 'Weekday {{day}}',
          })
          : t('billingCycles.values.rolling', { defaultValue: 'Rolling' });
      case 'bi-weekly':
        return anchor.referenceDate
          ? t('billingCycles.values.starts', {
            date: anchor.referenceDate,
            defaultValue: 'Starts {{date}}',
          })
          : t('billingCycles.values.rolling', { defaultValue: 'Rolling' });
      case 'monthly':
        return t('billingCycles.values.day', {
          day: anchor.dayOfMonth ?? 1,
          defaultValue: 'Day {{day}}',
        });
      case 'quarterly':
      case 'semi-annually':
      case 'annually': {
        const monthNumber = anchor.monthOfYear ?? 1;
        const monthKey = MONTH_KEY_BY_NUMBER[monthNumber as keyof typeof MONTH_KEY_BY_NUMBER];
        const monthLabel = monthKey
          ? t(`billingCycles.months.${monthKey}`, {
            defaultValue: monthKey.charAt(0).toUpperCase() + monthKey.slice(1),
          })
          : String(monthNumber);
        return t('billingCycles.values.monthDay', {
          month: monthLabel,
          day: anchor.dayOfMonth ?? 1,
          defaultValue: '{{month}} {{day}}',
        });
      }
      default:
        return t('billingCycles.values.dash', { defaultValue: '—' });
    }
  };

  const formatBillingCycle = (cycle: BillingCycleType): string =>
    t(`billingCycles.cycles.${cycle}`, {
      defaultValue: cycle
        .split('-')
        .map((word): string => word.charAt(0).toUpperCase() + word.slice(1))
        .join('-'),
    });

  const columns: ColumnDefinition<Partial<IClient>>[] = [
    {
      title: t('billingCycles.columns.client', { defaultValue: 'Client' }),
      dataIndex: 'client_name',
    },
    {
      title: t('billingCycles.columns.contract', { defaultValue: 'Contract' }),
      dataIndex: 'client_id',
      render: (value: string) => {
        const assignments = clientContracts[value] ?? [];
        if (assignments.length === 0) {
          return (
            <span className="text-muted-foreground">
              {t('billingCycles.values.noActiveAssignments', {
                defaultValue: 'No active assignments',
              })}
            </span>
          );
        }

        return (
          <div className="space-y-1">
            {assignments.map((assignment) => {
              const contractName = contracts[assignment.contractId]?.contract_name ?? t('billingCycles.values.unknown', {
                defaultValue: 'Unknown',
              });
              return (
                <div key={assignment.clientContractId} className="space-y-0.5">
                  <div>{contractName}</div>
                  <div className="text-xs text-muted-foreground">
                    {t('billingCycles.values.assignmentId', {
                      id: assignment.clientContractId.slice(0, 8),
                      defaultValue: 'Assignment {{id}}',
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        );
      },
    },
    {
      title: t('billingCycles.columns.currentBillingCycle', {
        defaultValue: 'Current Billing Cycle',
      }),
      dataIndex: 'client_id',
      render: (value: string) => {
        const cycle = billingSchedules[value]?.billingCycle ?? billingCycles[value];
        if (!cycle) {
          return t('billingCycles.values.notSet', { defaultValue: 'Not set' });
        }

        return formatBillingCycle(cycle);
      },
    },
    {
      title: t('billingCycles.columns.anchor', { defaultValue: 'Anchor' }),
      dataIndex: 'client_id',
      render: (value: string) => formatAnchorSummary(value),
    },
    {
      title: t('billingCycles.columns.actions', { defaultValue: 'Actions' }),
      dataIndex: 'client_id',
      render: (value: string) => (
        <div className="flex items-center gap-2">
          <Button id="billing-cycles-view-client" asChild variant="outline" size="sm">
            <Link href={`/msp/clients/${value}?tab=Billing`}>
              {t('billingCycles.actions.viewClientBilling', {
                defaultValue: 'View Client Billing',
              })}
            </Link>
          </Button>
        </div>
      ),
    },
  ];

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleSortChange = useCallback((newSortBy: string, newSortDirection: 'asc' | 'desc') => {
    setSortBy(newSortBy);
    setSortDirection(newSortDirection);
    setCurrentPage(1); // Reset to first page when sorting changes
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-bold">
            {t('billingCycles.title', { defaultValue: 'Billing Cycles' })}
          </h2>
          <Tooltip
            content={t('billingCycles.tooltip', {
              defaultValue: 'Configure client billing schedules and preview the invoice windows they create for client-cadence recurring services.',
            })}
          >
            <Info className="h-4 w-4 text-muted-foreground" />
          </Tooltip>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4">
          <div className="text-sm text-muted-foreground">
            {t('billingCycles.description', {
              defaultValue: 'Client billing schedules define invoice windows for recurring lines that invoice on the client billing schedule. Contract-anniversary lines can follow their own cadence and are not previewed here.',
            })}
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder={t('billingCycles.searchPlaceholder', {
                  defaultValue: 'Search clients...',
                })}
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                className="pl-10"
              />
            </div>
            <DateRangePicker
              id="billing-cycle-date-range"
              label={t('billingCycles.dateRange', {
                defaultValue: 'Billing cycle date range',
              })}
              value={pendingDateRange}
              onChange={(range) => {
                setPendingDateRange(range);
              }}
            />
            <Button
              id="apply-billing-cycle-date-filter"
              variant="outline"
              onClick={() => {
                setAppliedDateRange(pendingDateRange);
                setCurrentPage(1);
              }}
            >
              {t('billingCycles.search', { defaultValue: 'Search' })}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {loading ? (
            <LoadingIndicator
              layout="stacked"
              className="py-10 text-muted-foreground"
              spinnerProps={{ size: 'md' }}
              text={t('billingCycles.loading', {
                defaultValue: 'Loading billing cycles',
              })}
            />
          ) : (
            <DataTable
              id="billing-cycles-table"
              data={clients}
              columns={columns}
              pagination={true}
              currentPage={currentPage}
              pageSize={pageSize}
              totalItems={totalCount}
              onPageChange={handlePageChange}
              manualSorting={true}
              sortBy={sortBy}
              sortDirection={sortDirection}
              onSortChange={handleSortChange}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default BillingCycles;
