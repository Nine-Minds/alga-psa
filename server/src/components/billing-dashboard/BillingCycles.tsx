// BillingCycles.tsx
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardContent } from 'server/src/components/ui/Card';
import { DataTable } from 'server/src/components/ui/DataTable';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Info, Search } from 'lucide-react';
import {
  getAllBillingCycles
} from 'server/src/lib/actions/billingCycleActions';
import { getClientBillingScheduleSummaries } from 'server/src/lib/actions/billingScheduleActions';
import { getAllClientsPaginated, getClientsWithBillingCycleRangePaginated } from 'server/src/lib/actions/client-actions/clientActions';
import type { BillingCycleDateRange } from 'server/src/lib/actions/client-actions/clientActions';
import { getActiveClientContractsByClientIds } from 'server/src/lib/actions/client-actions/clientContractActions';
import { getContracts } from 'server/src/lib/actions/contractActions';
import { BillingCycleType, IClient } from 'server/src/interfaces';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { IContract } from 'server/src/interfaces/contract.interfaces';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';
import { DateRangePicker, type DateRange } from 'server/src/components/ui/DateRangePicker';

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

const MONTH_OPTIONS = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
] as const;

const BillingCycles: React.FC = () => {
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
  const [clientContracts, setClientContracts] = useState<{ [clientId: string]: string }>({});
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
        ? getClientsWithBillingCycleRangePaginated({
          page: currentPage,
          pageSize,
          searchTerm: debouncedSearchTerm,
          includeInactive: true,
          sortBy,
          sortDirection,
          dateRange: rangeFilter
        })
        : getAllClientsPaginated({
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
        getActiveClientContractsByClientIds(clientIds),
        getClientBillingScheduleSummaries(clientIds)
      ]);

      // Build active contract map per client (first by latest start date).
      const clientContractsMap: { [clientId: string]: string } = {};
      clientAssignedContracts.forEach(contract => {
        if (!contract.client_id || !contract.contract_id) {
          return;
        }

        if (!clientContractsMap[contract.client_id]) {
          clientContractsMap[contract.client_id] = contract.contract_id;
        }
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
      setError('Failed to fetch data. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const formatAnchorSummary = (clientId: string): string => {
    const schedule = billingSchedules[clientId];
    if (!schedule) return '—';
    const cycle = schedule.billingCycle;
    const anchor = schedule.anchor;

    switch (cycle) {
      case 'weekly':
        return anchor.dayOfWeek ? `Weekday ${anchor.dayOfWeek}` : 'Rolling';
      case 'bi-weekly':
        return anchor.referenceDate ? `Starts ${anchor.referenceDate}` : 'Rolling';
      case 'monthly':
        return `Day ${anchor.dayOfMonth ?? 1}`;
      case 'quarterly':
      case 'semi-annually':
      case 'annually': {
        const monthLabel = MONTH_OPTIONS.find(m => m.value === (anchor.monthOfYear ?? 1))?.label ?? String(anchor.monthOfYear ?? 1);
        return `${monthLabel} ${anchor.dayOfMonth ?? 1}`;
      }
      default:
        return '—';
    }
  };

  const columns: ColumnDefinition<Partial<IClient>>[] = [
    {
      title: 'Client',
      dataIndex: 'client_name',
    },
    {
      title: 'Contract',
      dataIndex: 'client_id',
      render: (value: string) => {
        const contractId = clientContracts[value];
        if (!contractId) return <span className="text-gray-400">No active contract</span>;
        const contract = contracts[contractId];
        return contract?.contract_name || <span className="text-gray-400">Unknown</span>;
      },
    },
    {
      title: 'Current Billing Cycle',
      dataIndex: 'client_id',
      render: (value: string, record: Partial<IClient>) => {
        const cycle = billingSchedules[value]?.billingCycle ?? billingCycles[value];
        if (!cycle) return 'Not set';

        // Convert to title case for display
        return cycle.split('-').map((word):string =>
          word.charAt(0).toUpperCase() + word.slice(1)
        ).join('-');
      },
    },
    {
      title: 'Anchor',
      dataIndex: 'client_id',
      render: (value: string) => formatAnchorSummary(value),
    },
    {
      title: 'Actions',
      dataIndex: 'client_id',
      render: (value: string) => (
        <div className="flex items-center gap-2">
          <Button id="billing-cycles-view-client" asChild variant="outline" size="sm">
            <Link href={`/msp/clients/${value}?tab=Billing`}>View Client Billing</Link>
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
          <h2 className="text-2xl font-bold">Billing Cycles</h2>
          <Tooltip content="Configure billing cycles for clients and create new billing periods.">
            <Info className="h-4 w-4 text-gray-500" />
          </Tooltip>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Search clients..."
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
              label="Billing cycle date range"
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
              Search
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}
          {loading ? (
            <LoadingIndicator
              layout="stacked"
              className="py-10 text-gray-600"
              spinnerProps={{ size: 'md' }}
              text="Loading billing cycles"
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
