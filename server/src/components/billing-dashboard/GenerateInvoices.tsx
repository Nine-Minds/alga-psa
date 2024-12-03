'use client'
import React, { useState, useEffect, useMemo } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { ColumnDefinition } from '@/interfaces/dataTable.interfaces';
import { Checkbox } from '@/components/ui/Checkbox';
import { ICompanyBillingCycle } from '@/interfaces/billing.interfaces';
import { getAvailableBillingPeriods, generateInvoice } from '@/lib/actions/invoiceActions';
import { getAllCompanies } from '@/lib/actions/companyActions';
import { canCreateNextBillingCycle, createNextBillingCycle } from '@/lib/actions/billingCycleActions';
import { ISO8601String } from '@/types/types.d';

type BillingPeriodWithExtras = ICompanyBillingCycle & {
  company_name: string;
  can_generate: boolean;
};

const GenerateInvoices: React.FC = () => {
  const [selectedPeriods, setSelectedPeriods] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [periods, setPeriods] = useState<BillingPeriodWithExtras[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [canCreateCycle, setCanCreateCycle] = useState<{[key: string]: boolean}>({});
  const [isCreatingCycle, setIsCreatingCycle] = useState(false);
  const [companies, setCompanies] = useState<{[key: string]: string}>({});
  const [companyFilter, setCompanyFilter] = useState<string>('');

  useEffect(() => {
    loadBillingPeriods();
  }, []);

  const filteredPeriods = useMemo(() => 
    periods.filter(period => 
      period.company_name.toLowerCase().includes(companyFilter.toLowerCase())
    ),
    [periods, companyFilter]
  );

  // Load companies and check if they can create cycles
  useEffect(() => {
    const loadCompaniesAndCheck = async () => {
      console.log('Starting checkCanCreateCycles');
      
      try {
        // Get all companies regardless of periods
        const companyList = await getAllCompanies();
        
        // Store company names mapped by ID
        const companyMap = companyList.reduce((acc, company) => ({
          ...acc,
          [company.company_id]: company.company_name
        }), {});
        setCompanies(companyMap);
        
        if (periods.length === 0) {
          // If no periods exist, all companies can create cycles
          companyList.forEach(company => {
            setCanCreateCycle(prev => ({...prev, [company.company_id]: true}));
          });
          return;
        }

        // Otherwise check each company individually
        const existingCompanyIds = new Set(periods.map((p):string => p.company_id));      
        console.log('Existing Company IDs:', Array.from(existingCompanyIds));

        for (const companyId of Object.keys(companyMap)) {
          try {
            // Companies without periods can create them
            if (!existingCompanyIds.has(companyId)) {
              setCanCreateCycle(prev => ({...prev, [companyId]: true}));
              continue;
            }
            
            // Check if existing companies can create next cycle
            const canCreate = await canCreateNextBillingCycle(companyId);
            console.log('Can create cycle for company', companyId, ':', canCreate);
            setCanCreateCycle(prev => ({...prev, [companyId]: canCreate}));
          } catch (err) {
            console.error('Error checking if can create cycle:', err);
          }
        }
      } catch (err) {
        console.error('Error fetching companies:', err);
      }
      
      console.log('Finished checkCanCreateCycles');
    };

    loadCompaniesAndCheck();
  }, [periods.length]); // Only run when periods array length changes

  const loadBillingPeriods = async () => {
    try {
      const availablePeriods = await getAvailableBillingPeriods();
      setPeriods(availablePeriods);
    } catch (err) {
      setError('Failed to load billing periods');
      console.error('Error loading billing periods:', err);
    }
  };

  const handleSelectAll = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.checked) {
      const validIds = filteredPeriods
        .filter(p => p.can_generate)
        .map((p): string | undefined => p.billing_cycle_id)
        .filter((id): id is string => id !== undefined);
      setSelectedPeriods(new Set(validIds));
    } else {
      setSelectedPeriods(new Set());
    }
  };

  const handleSelectPeriod = (billingCycleId: string | undefined, event: React.ChangeEvent<HTMLInputElement>) => {
    if (!billingCycleId) return;
    
    const newSelected = new Set(selectedPeriods);
    if (event.target.checked) {
      newSelected.add(billingCycleId);
    } else {
      newSelected.delete(billingCycleId);
    }
    setSelectedPeriods(newSelected);
  };

  const handleGenerateInvoices = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      for (const billingCycleId of selectedPeriods) {
        await generateInvoice(billingCycleId);
      }
      
      // Clear selections and reload periods after successful generation
      setSelectedPeriods(new Set());
      await loadBillingPeriods();
    } catch (err) {
      setError('Error generating invoices');
      console.error('Error generating invoices:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="p-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Ready to Invoice Billing Periods</h2>
            <div className="flex gap-4">
              <input
                type="text"
                placeholder="Filter companies..."
                className="px-3 py-2 border rounded-md"
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
              />
              <Button
                onClick={handleGenerateInvoices}
                disabled={selectedPeriods.size === 0 || isGenerating}
                className={selectedPeriods.size === 0 ? 'opacity-50' : ''}
              >
                {isGenerating ? 'Generating...' : `Generate Selected Invoices (${selectedPeriods.size})`}
              </Button>
            </div>
          </div>

          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4">
              {error}
            </div>
          )}

          <DataTable
            data={filteredPeriods}
            columns={[
              {
                title: (
                  <Checkbox
                    id="select-all"
                    checked={filteredPeriods.length > 0 && selectedPeriods.size === filteredPeriods.filter(p => p.can_generate).length}
                    onChange={handleSelectAll}
                    disabled={!filteredPeriods.some(p => p.can_generate)}
                  />
                ),
                dataIndex: 'billing_cycle_id',
                render: (_, record) => record.can_generate ? (
                  <Checkbox
                    id={`select-${record.billing_cycle_id}`}
                    checked={selectedPeriods.has(record.billing_cycle_id || '')}
                    onChange={(event) => handleSelectPeriod(record.billing_cycle_id, event)}
                  />
                ) : null
              },
              {
                title: 'Company',
                dataIndex: 'company_name'
              },
              {
                title: 'Billing Cycle',
                dataIndex: 'billing_cycle'
              },
              {
                title: 'Period Start',
                dataIndex: 'period_start_date',
                render: (date: ISO8601String) => new Date(date).toLocaleDateString()
              },
              {
                title: 'Period End',
                dataIndex: 'period_end_date',
                render: (date: ISO8601String) => new Date(date).toLocaleDateString()
              },
              {
                title: 'Status',
                dataIndex: 'can_generate',
                render: (canGenerate: boolean) => !canGenerate ? (
                  <span className="text-xs text-gray-500 bg-gray-200 px-2 py-1 rounded">
                    Period Active
                  </span>
                ) : null
              }
            ]}
            pagination={false}
          />

          {(filteredPeriods.length === 0 || Object.values(canCreateCycle).some(can => can)) && (
            <div className="mt-4">
              <div className="space-y-4">
                {filteredPeriods.length === 0 && companyFilter && (
                  <p className="text-gray-500 text-center">No companies match your filter</p>
                )}
                {Object.values(canCreateCycle).some(can => can) && (
                  <div className="space-y-3">
                    {Object.entries(canCreateCycle)
                      .filter(([companyId]) => 
                        companies[companyId]?.toLowerCase().includes(companyFilter.toLowerCase())
                      )
                      .map(([companyId, canCreate]): JSX.Element | boolean => {
                        return canCreate && (
                          <div key={companyId} className="flex flex-col space-y-2 p-4 border rounded-lg bg-gray-50">
                            <div className="flex justify-between items-center">
                              <div>
                                <h3 className="font-medium text-left">{companies[companyId]}</h3>
                                <p className="text-sm text-gray-600">Ready to create next billing cycle</p>
                              </div>
                              <Button
                                onClick={async () => {
                                  setIsCreatingCycle(true);
                                  try {
                                    await createNextBillingCycle(companyId);
                                    await loadBillingPeriods();
                                  } catch (err) {
                                    setError('Failed to create billing cycle');
                                    console.error(err);
                                  } finally {
                                    setIsCreatingCycle(false);
                                  }
                                }}
                                disabled={isCreatingCycle}
                              >
                                {isCreatingCycle ? 'Creating...' : 'Create Next Cycle'}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

export default GenerateInvoices;
