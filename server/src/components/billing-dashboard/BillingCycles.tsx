// BillingCycles.tsx
import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardContent } from 'server/src/components/ui/Card';
import { DataTable } from 'server/src/components/ui/DataTable';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import { Button } from 'server/src/components/ui/Button';
import { Info } from 'lucide-react';
import { 
  getAllBillingCycles, 
  updateBillingCycle,
  canCreateNextBillingCycle,
  createNextBillingCycle
} from 'server/src/lib/actions/billingCycleActions';
import { getAllCompanies } from 'server/src/lib/actions/companyActions';
import { BillingCycleType, ICompany } from 'server/src/interfaces';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';

const BILLING_CYCLE_OPTIONS: { value: BillingCycleType; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'bi-weekly', label: 'Bi-Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semi-annually', label: 'Semi-Annually' },
  { value: 'annually', label: 'Annually' },
];

const BillingCycles: React.FC = () => {
  const [billingCycles, setBillingCycles] = useState<{ [companyId: string]: BillingCycleType }>({});
  const [companies, setCompanies] = useState<Partial<ICompany>[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [cycleStatus, setCycleStatus] = useState<{
    [companyId: string]: {
      canCreate: boolean;
      isEarly: boolean;
      periodEndDate?: string;
    }
  }>({});
  const [creatingCycle, setCreatingCycle] = useState<{ [companyId: string]: boolean }>({});
  const [dateConflict, setDateConflict] = useState<{
    companyId: string;
    suggestedDate: Date;
    show: boolean;
    error?: string;
  } | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [cycles, fetchedCompanies] = await Promise.all([
        getAllBillingCycles(),
        getAllCompanies()
      ]);

      setBillingCycles(cycles);
      setCompanies(fetchedCompanies);

      // Check which companies can have cycles created
      const cycleCreationStatus: {
        [companyId: string]: {
          canCreate: boolean;
          isEarly: boolean;
          periodEndDate?: string;
        }
      } = {};
      
      for (const company of fetchedCompanies) {
        if (company.company_id) {
          const status = await canCreateNextBillingCycle(company.company_id);
          cycleCreationStatus[company.company_id] = status;
        }
      }
      
      setCycleStatus(cycleCreationStatus);
      setError(null);
    } catch (error) {
      console.error('Error fetching data:', error);
      setError('Failed to fetch data. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const handleBillingCycleChange = async (companyId: string, cycle: BillingCycleType) => {
    if (!cycle) return;
    
    // Optimistic update
    setBillingCycles(prev => ({ ...prev, [companyId]: cycle }));

    try {
      await updateBillingCycle(companyId, cycle);
      setError(null);
    } catch (error) {
      console.error('Error updating billing cycle:', error);
      // Revert the optimistic update
      setBillingCycles(prev => ({ ...prev, [companyId]: prev[companyId] }));
      setError('Failed to update billing cycle. Please try again.');
    }
  };

  const handleCreateNextCycle = async (companyId: string, selectedDate?: Date) => {
    setCreatingCycle(prev => ({ ...prev, [companyId]: true }));
    try {
      const result = await createNextBillingCycle(
        companyId,
        selectedDate?.toISOString()
      );
      if (!result.success && result.suggestedDate) {
        setDateConflict({
          companyId,
          suggestedDate: new Date(result.suggestedDate),
          show: true
        });
        return;
      }

      // Update the cycle status after successful creation
      const status = await canCreateNextBillingCycle(companyId);
      setCycleStatus(prev => ({
        ...prev,
        [companyId]: status
      }));
      setError(null);
    } catch (error) {
      console.error('Error creating next billing cycle:', error);
      setError('Failed to create next billing cycle. Please try again.');
    } finally {
      setCreatingCycle(prev => ({ ...prev, [companyId]: false }));
    }
  };

  const columns: ColumnDefinition<Partial<ICompany>>[] = [
    {
      title: 'Company',
      dataIndex: 'company_name',
    },
    {
      title: 'Current Billing Cycle',
      dataIndex: 'company_id',
      render: (value: string, record: Partial<ICompany>) => {
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
      dataIndex: 'company_id',
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

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center">
          <h3 className="text-lg font-semibold">Billing Cycles</h3>
          <Tooltip content="Configure billing cycles for companies and create new billing periods.">
            <Info className="ml-2 h-4 w-4 text-gray-500" />
          </Tooltip>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4">
            {error}
          </div>
        )}
        {loading ? (
          <div className="text-center py-4">Loading billing cycles...</div>
        ) : (
          <DataTable
            data={companies}
            columns={columns}
            pagination={true}
          />
        )}

      </CardContent>
    </Card>
  );
};

export default BillingCycles;
