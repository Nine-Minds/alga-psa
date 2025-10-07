'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Box, Card, Heading } from '@radix-ui/themes';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Badge } from 'server/src/components/ui/Badge';
import { MoreVertical, Plus, Wand2, Search, Filter } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'server/src/components/ui/DropdownMenu';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { IPlanBundle, ICompanyPlanBundle } from 'server/src/interfaces/planBundle.interfaces';
import { ICompany } from 'server/src/interfaces';
import { getPlanBundles, deletePlanBundle } from 'server/src/lib/actions/planBundleActions';
import { getAllCompanies } from 'server/src/lib/actions/company-actions/companyActions';
import { ContractDialog } from './ContractDialog';
import { ContractWizard } from './ContractWizard';
import { QuickStartGuide } from './QuickStartGuide';

type ContractStatus = 'active' | 'upcoming' | 'expired';

interface EnrichedContract extends IPlanBundle {
  client_name?: string;
  company_id?: string;
  start_date?: string;
  end_date?: string | null;
  monthly_value?: number;
  status?: ContractStatus;
}

const Contracts: React.FC = () => {
  const [contracts, setContracts] = useState<EnrichedContract[]>([]);
  const [filteredContracts, setFilteredContracts] = useState<EnrichedContract[]>([]);
  const [editingContract, setEditingContract] = useState<IPlanBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<ContractStatus | 'all'>('all');
  const [showQuickStart, setShowQuickStart] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetchContracts();
  }, []);

  useEffect(() => {
    filterContracts();
  }, [contracts, searchTerm, statusFilter]);

  const getContractStatus = (startDate?: string, endDate?: string | null, isActive?: boolean): ContractStatus => {
    if (!isActive) return 'expired';

    const now = new Date();
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    if (start && start > now) return 'upcoming';
    if (end && end < now) return 'expired';
    return 'active';
  };

  const fetchContracts = async () => {
    try {
      const fetchedContracts = await getPlanBundles();
      const companies = await getAllCompanies();

      // For now, we'll use mock data for company assignments
      // In a real implementation, we'd fetch company_plan_bundles
      const enriched: EnrichedContract[] = fetchedContracts.map((contract) => ({
        ...contract,
        client_name: 'Mock Client', // TODO: Get from company_plan_bundles join
        company_id: undefined,
        start_date: new Date().toISOString().split('T')[0], // Mock data
        end_date: null,
        monthly_value: 0, // TODO: Calculate from billing plans
        status: getContractStatus(undefined, null, contract.is_active)
      }));

      setContracts(enriched);
      setError(null);
    } catch (error) {
      console.error('Error fetching contracts:', error);
      setError('Failed to fetch contracts');
    }
  };

  const filterContracts = () => {
    let filtered = contracts;

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(contract =>
        contract.bundle_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        contract.client_name?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(contract => contract.status === statusFilter);
    }

    setFilteredContracts(filtered);
  };

  const handleDeleteContract = async (contractId: string) => {
    try {
      await deletePlanBundle(contractId);
      fetchContracts();
    } catch (error) {
      if (error instanceof Error) {
        alert(error.message);
      } else {
        alert('Failed to delete contract');
      }
    }
  };

  const getStatusBadge = (status?: ContractStatus) => {
    const variants = {
      active: { variant: 'default' as const, className: 'bg-green-100 text-green-800 border-green-200' },
      upcoming: { variant: 'default' as const, className: 'bg-blue-100 text-blue-800 border-blue-200' },
      expired: { variant: 'default' as const, className: 'bg-gray-100 text-gray-800 border-gray-200' }
    };

    const config = status ? variants[status] : variants.expired;
    const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';

    return (
      <Badge variant={config.variant} className={config.className}>
        {label}
      </Badge>
    );
  };

  const formatCurrency = (cents: number | undefined) => {
    if (!cents) return '$0.00';
    return `$${(cents / 100).toFixed(2)}`;
  };

  const formatDate = (dateString?: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString();
  };

  const contractColumns: ColumnDefinition<EnrichedContract>[] = [
    {
      title: 'Client',
      dataIndex: 'client_name',
      render: (value) => value || 'Not Assigned',
    },
    {
      title: 'Contract Name',
      dataIndex: 'bundle_name',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (value) => getStatusBadge(value as ContractStatus),
    },
    {
      title: 'Monthly Value',
      dataIndex: 'monthly_value',
      render: (value) => formatCurrency(value),
    },
    {
      title: 'Start Date',
      dataIndex: 'start_date',
      render: (value) => formatDate(value),
    },
    {
      title: 'End Date',
      dataIndex: 'end_date',
      render: (value) => formatDate(value),
    },
    {
      title: 'Actions',
      dataIndex: 'bundle_id',
      render: (value, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id="contract-actions-menu"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">Open menu</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id="view-contract-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                if (record.bundle_id) {
                  router.push(`/msp/billing?tab=contracts&contractId=${record.bundle_id}`);
                }
              }}
            >
              View Details
            </DropdownMenuItem>
            <DropdownMenuItem
              id="edit-contract-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                setEditingContract({...record});
              }}
            >
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              id="renew-contract-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                // TODO: Implement renew functionality
                alert('Renew contract feature coming soon');
              }}
            >
              Renew
            </DropdownMenuItem>
            <DropdownMenuItem
              id="terminate-contract-menu-item"
              className="text-orange-600 focus:text-orange-600"
              onClick={(e) => {
                e.stopPropagation();
                // TODO: Implement terminate functionality
                alert('Terminate contract feature coming soon');
              }}
            >
              Terminate
            </DropdownMenuItem>
            <DropdownMenuItem
              id="delete-contract-menu-item"
              className="text-red-600 focus:text-red-600"
              onClick={async (e) => {
                e.stopPropagation();
                if (record.bundle_id && confirm('Are you sure you want to delete this contract?')) {
                  handleDeleteContract(record.bundle_id);
                }
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const handleContractClick = (contract: IPlanBundle) => {
    if (contract.bundle_id) {
      router.push(`/msp/billing?tab=contracts&contractId=${contract.bundle_id}`);
    }
  };

  return (
    <>
      <Card size="2">
        <Box p="4">
          <div className="flex justify-between items-center mb-4">
            <Heading as="h3" size="4">Contracts</Heading>
            <div className="flex gap-2">
              <Button
                id='wizard-contract-button'
                type='button'
                onClick={() => setShowWizard(true)}
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
              >
                <Wand2 className="h-4 w-4 mr-2" />
                Create with Wizard
              </Button>
              <ContractDialog
                onContractAdded={fetchContracts}
                editingContract={editingContract}
                onClose={() => setEditingContract(null)}
                triggerButton={
                  <Button id='add-contract-button' variant="outline" type='button'>
                    <Plus className="h-4 w-4 mr-2" />
                    Quick Add
                  </Button>
                }
              />
            </div>
          </div>

          {/* Search and Filter */}
          <div className="flex gap-3 mb-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Search by client or contract name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Filter className="h-4 w-4" />
                  Status: {statusFilter === 'all' ? 'All' : statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setStatusFilter('all')}>
                  All Contracts
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setStatusFilter('active')}>
                  Active Only
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setStatusFilter('upcoming')}>
                  Upcoming Only
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setStatusFilter('expired')}>
                  Expired Only
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}

          {/* Show Quick Start Guide when no contracts exist */}
          {contracts.length === 0 && showQuickStart && (
            <div className="mb-6">
              <QuickStartGuide
                onDismiss={() => setShowQuickStart(false)}
                onCreateContract={() => setShowWizard(true)}
              />
            </div>
          )}

          {/* Empty State when filtered results are empty but contracts exist */}
          {contracts.length > 0 && filteredContracts.length === 0 && (
            <div className="text-center py-12">
              <div className="mx-auto h-12 w-12 text-gray-400 mb-4">
                <Search className="h-12 w-12" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No contracts found</h3>
              <p className="text-gray-600 mb-4">
                Try adjusting your search or filter criteria
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('all');
                }}
              >
                Clear Filters
              </Button>
            </div>
          )}

          {/* Empty State when no contracts exist */}
          {contracts.length === 0 && (
            <div className="text-center py-12">
              <div className="mx-auto h-12 w-12 text-gray-400 mb-4">
                <Plus className="h-12 w-12" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No contracts yet</h3>
              <p className="text-gray-600 mb-4">
                Get started by creating your first client contract
              </p>
              <Button
                onClick={() => setShowWizard(true)}
                type='button'
                className="bg-gradient-to-r from-blue-600 to-purple-600"
              >
                <Wand2 className="h-4 w-4 mr-2" />
                Create Your First Contract
              </Button>
            </div>
          )}

          {/* Show data table only when there are filtered results */}
          {filteredContracts.length > 0 && (
            <DataTable
              data={filteredContracts.filter(contract => contract.bundle_id !== undefined)}
              columns={contractColumns}
              pagination={true}
              onRowClick={handleContractClick}
              rowClassName={() => "cursor-pointer"}
            />
          )}
        </Box>
      </Card>

      <ContractWizard
        open={showWizard}
        onOpenChange={setShowWizard}
        onComplete={(data) => {
          console.log('Contract created:', data);
          setShowWizard(false);
          fetchContracts();
        }}
      />
    </>
  );
};

export default Contracts;
