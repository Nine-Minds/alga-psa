// BillingCycles.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardContent } from 'server/src/components/ui/Card';
import { DataTable } from 'server/src/components/ui/DataTable';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Info, Search } from 'lucide-react';
import {
  getAllBillingCycles,
  updateBillingCycle,
  canCreateNextBillingCycle,
  createNextBillingCycle
} from 'server/src/lib/actions/billingCycleActions';
import { getAllClientsPaginated } from 'server/src/lib/actions/client-actions/clientActions';
import { getClientBundles } from 'server/src/lib/actions/client-actions/clientPlanBundleActions';
import { getPlanBundles } from 'server/src/lib/actions/planBundleActions';
import { BillingCycleType, IClient } from 'server/src/interfaces';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { IClientPlanBundle, IPlanBundle } from 'server/src/interfaces/planBundle.interfaces';

const BILLING_CYCLE_OPTIONS: { value: BillingCycleType; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'bi-weekly', label: 'Bi-Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semi-annually', label: 'Semi-Annually' },
  { value: 'annually', label: 'Annually' },
];

const BillingCycles: React.FC = () => {
  const [billingCycles, setBillingCycles] = useState<{ [clientId: string]: BillingCycleType }>({});
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
  const [cycleStatus, setCycleStatus] = useState<{
    [clientId: string]: {
      canCreate: boolean;
      isEarly: boolean;
      periodEndDate?: string;
    }
  }>({});
  const [creatingCycle, setCreatingCycle] = useState<{ [clientId: string]: boolean }>({});
  const [dateConflict, setDateConflict] = useState<{
    clientId: string;
    suggestedDate: Date;
    show: boolean;
    error?: string;
  } | null>(null);
  const [clientContracts, setClientContracts] = useState<{ [clientId: string]: string }>({});
  const [contracts, setContracts] = useState<{ [bundleId: string]: IPlanBundle }>({});

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
  }, [currentPage, debouncedSearchTerm, sortBy, sortDirection]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [cycles, clientsResponse, allContracts] = await Promise.all([
        getAllBillingCycles(),
        getAllClientsPaginated({
          page: currentPage,
          pageSize,
          searchTerm: debouncedSearchTerm,
          includeInactive: true,
          sortBy,
          sortDirection
        }),
        getPlanBundles()
      ]);

      setBillingCycles(cycles);
      setClients(clientsResponse.clients);
      setTotalCount(clientsResponse.totalCount);

      // Create a map of contracts by bundle_id
      const contractsMap: { [bundleId: string]: IPlanBundle } = {};
      allContracts.forEach(contract => {
        if (contract.bundle_id) {
          contractsMap[contract.bundle_id] = contract;
        }
      });
      setContracts(contractsMap);

      // Fetch contracts for each client and check cycle creation status
      const cycleCreationStatus: {
        [clientId: string]: {
          canCreate: boolean;
          isEarly: boolean;
          periodEndDate?: string;
        }
      } = {};
      const clientContractsMap: { [clientId: string]: string } = {};

      for (const client of clientsResponse.clients) {
        if (client.client_id) {
          // Fetch contract info
          try {
            const clientBundles = await getClientBundles(client.client_id);
            // Get the active contract (if any)
            const activeBundle = clientBundles.find(bundle => bundle.is_active);
            if (activeBundle && activeBundle.bundle_id) {
              clientContractsMap[client.client_id] = activeBundle.bundle_id;
            }
          } catch (error) {
            console.error(`Error fetching contracts for client ${client.client_id}:`, error);
          }

          // Check cycle creation status
          const status = await canCreateNextBillingCycle(client.client_id);
          cycleCreationStatus[client.client_id] = status;
        }
      }

      setClientContracts(clientContractsMap);
      setCycleStatus(cycleCreationStatus);
      setError(null);
    } catch (error) {
      console.error('Error fetching data:', error);
      setError('Failed to fetch data. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const handleBillingCycleChange = async (clientId: string, cycle: BillingCycleType) => {
    if (!cycle) return;
    
    // Optimistic update
    setBillingCycles(prev => ({ ...prev, [clientId]: cycle }));

    try {
      await updateBillingCycle(clientId, cycle);
      setError(null);
    } catch (error) {
      console.error('Error updating billing cycle:', error);
      // Revert the optimistic update
      setBillingCycles(prev => ({ ...prev, [clientId]: prev[clientId] }));
      setError('Failed to update billing cycle. Please try again.');
    }
  };

  const handleCreateNextCycle = async (clientId: string, selectedDate?: Date) => {
    setCreatingCycle(prev => ({ ...prev, [clientId]: true }));
    try {
      const result = await createNextBillingCycle(
        clientId,
        selectedDate?.toISOString()
      );
      if (!result.success && result.error === 'duplicate') {
        // Show user-friendly error message from backend
        setError(result.message || 'A billing period for this date already exists. Please select a different date.');
        // Optionally, also show the date conflict dialog if a suggestion is present
        if (result.suggestedDate) {
          setDateConflict({
            clientId,
            suggestedDate: new Date(result.suggestedDate),
            show: true
          });
        }
        return;
      }

      // Update the cycle status after successful creation
      const status = await canCreateNextBillingCycle(clientId);
      setCycleStatus(prev => ({
        ...prev,
        [clientId]: status
      }));
      setError(null);
    } catch (error) {
      console.error('Error creating next billing cycle:', error);
      setError('Failed to create next billing cycle. Please try again.');
    } finally {
      setCreatingCycle(prev => ({ ...prev, [clientId]: false }));
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
        const bundleId = clientContracts[value];
        if (!bundleId) return <span className="text-gray-400">No active contract</span>;
        const contract = contracts[bundleId];
        return contract?.bundle_name || <span className="text-gray-400">Unknown</span>;
      },
    },
    {
      title: 'Current Billing Cycle',
      dataIndex: 'client_id',
      render: (value: string, record: Partial<IClient>) => {
        const cycle = billingCycles[value];
        if (!cycle) return 'Not set';

        // Convert to title case for display
        return cycle.split('-').map((word):string =>
          word.charAt(0).toUpperCase() + word.slice(1)
        ).join('-');
      },
    },
    {
      title: 'Actions',
      dataIndex: 'client_id',
      render: (value: string) => (
        <div className="flex items-center gap-2">
          <CustomSelect
            options={BILLING_CYCLE_OPTIONS}
            onValueChange={(selectedValue: string) => handleBillingCycleChange(value, selectedValue as BillingCycleType)}
            value={billingCycles[value] || ''}
            placeholder="Select billing cycle..."
          />
          <Button
            id='create-next-billing-cycle-button'
            variant="outline"
            size="sm"
            onClick={() => handleCreateNextCycle(value)}
            disabled={!cycleStatus[value]?.canCreate || creatingCycle[value]}
          >
            <span className="flex items-center">
              {creatingCycle[value] ? 'Creating...' : 'Create Next Cycle'}
              {cycleStatus[value]?.isEarly && (
                <Tooltip content={`Warning: Current billing cycle doesn't end until ${new Date(cycleStatus[value].periodEndDate!).toLocaleDateString()}`}>
                  <Info className="ml-2 h-4 w-4 text-yellow-500" />
                </Tooltip>
              )}
            </span>
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
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">Billing Cycles</h3>
          <Tooltip content="Configure billing cycles for clients and create new billing periods.">
            <Info className="h-4 w-4 text-gray-500" />
          </Tooltip>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              type="text"
              placeholder="Search clients..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1); // Reset to first page on new search
              }}
              className="pl-10"
            />
          </div>
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}
          {loading ? (
            <div className="text-center py-4">Loading billing cycles...</div>
          ) : (
            <DataTable
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
        </div>
      </CardContent>
    </Card>
  );
};

export default BillingCycles;
