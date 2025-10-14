'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'server/src/components/ui/Tabs';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import BackNav from 'server/src/components/ui/BackNav';
import { AlertCircle, CalendarClock, FileCheck, FileText, Layers3, Package, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Badge } from 'server/src/components/ui/Badge';
import { Button } from 'server/src/components/ui/Button';
import { IContract, IContractAssignmentSummary } from 'server/src/interfaces/contract.interfaces';
import {
  getContractById,
  getContractSummary,
  getContractAssignments,
  IContractSummary
} from 'server/src/lib/actions/contractActions';
import ContractHeader from './ContractHeader';
import ContractForm from './ContractForm';
import ContractLines from './ContractLines';
import PricingSchedules from './PricingSchedules';

const formatDate = (value?: string | Date | null): string => {
  if (!value) {
    return '—';
  }

  const date = typeof value === 'string' ? new Date(value) : value;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
};

const formatCount = (value?: number): string => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  return value.toLocaleString();
};

const ContractDetail: React.FC = () => {
  const searchParams = useSearchParams();
  const contractId = searchParams?.get('contractId') as string;

  const [contract, setContract] = useState<IContract | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [summary, setSummary] = useState<IContractSummary | null>(null);
  const [assignments, setAssignments] = useState<IContractAssignmentSummary[]>([]);

  useEffect(() => {
    if (contractId) {
      loadContractData();
    }
  }, [contractId]);

  const loadContractData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [contractData, summaryData, assignmentData] = await Promise.all([
        getContractById(contractId),
        getContractSummary(contractId),
        getContractAssignments(contractId)
      ]);

      if (!contractData) {
        setError('Contract not found');
        setContract(null);
        setSummary(null);
        setAssignments([]);
        return;
      }

      setContract(contractData);
      setSummary(summaryData);
      setAssignments(assignmentData);
    } catch (err) {
      console.error('Error loading contract details:', err);
      setError('Failed to load contract');
    } finally {
      setIsLoading(false);
    }
  };

  const refreshSummary = async () => {
    if (!contractId) {
      return;
    }

    try {
      const [summaryData, assignmentData] = await Promise.all([
        getContractSummary(contractId),
        getContractAssignments(contractId)
      ]);
      setSummary(summaryData);
      setAssignments(assignmentData);
    } catch (error) {
      console.error('Error refreshing contract summary:', error);
    }
  };

  const handleContractUpdated = () => {
    loadContractData();
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleContractLinesChanged = () => {
    refreshSummary();
  };

  const activeAssignments = useMemo(
    () => assignments.filter((assignment) => assignment.is_active),
    [assignments]
  );

  const poNumbers = useMemo(() => summary?.poNumbers ?? [], [summary]);

  const totalAssignments = summary?.totalClientAssignments ?? assignments.length;


  if (isLoading) {
    return <div className="p-4">Loading contract details...</div>;
  }

  if (error || !contract) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {error || 'Contract not found'}
          </AlertDescription>
        </Alert>
        <BackNav href="/msp/billing?tab=contracts">
          Back to Contracts
        </BackNav>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <BackNav href="/msp/billing?tab=contracts">Back to Contracts</BackNav>
        <ContractHeader contract={contract} summary={summary} />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4 flex flex-wrap gap-2">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="details">Contract Details</TabsTrigger>
          <TabsTrigger value="lines">Contract Lines</TabsTrigger>
          <TabsTrigger value="pricing">Pricing Schedules</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <FileText className="h-4 w-4 text-blue-600" />
                    Contract Snapshot
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-gray-700">
                  <div className="flex items-center justify-between">
                    <span>Status</span>
                    <Badge className={contract.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
                      {contract.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Billing Frequency</span>
                    <span className="font-medium">{contract.billing_frequency}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Created</span>
                    <span className="font-medium">{formatDate(contract.created_at)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Last Updated</span>
                    <span className="font-medium">{formatDate(contract.updated_at)}</span>
                  </div>
                  {contract.contract_description && (
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Description</p>
                      <p className="text-sm text-gray-800">{contract.contract_description}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Layers3 className="h-4 w-4 text-emerald-600" />
                    Client Overview
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-gray-700">
                  <div className="flex items-center justify-between">
                    <span>Assigned Clients</span>
                    <span className="font-semibold">{formatCount(totalAssignments)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Active Assignments</span>
                    <span className="font-semibold text-green-700">{formatCount(activeAssignments.length)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Earliest Start</span>
                    <span className="font-medium">{formatDate(summary?.earliestStartDate)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Latest End</span>
                    <span className="font-medium">
                      {summary?.latestEndDate ? formatDate(summary.latestEndDate) : totalAssignments > 0 ? 'Ongoing' : '—'}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Users className="h-4 w-4 text-indigo-600" />
                    Client Assignments
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-gray-700">
                  <div className="flex items-center justify-between">
                    <span>Total Assignments</span>
                    <span className="font-semibold">{formatCount(totalAssignments)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Active Clients</span>
                    <span className="font-semibold text-green-700">{formatCount(activeAssignments.length)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Earliest Start</span>
                    <span className="font-medium">{formatDate(summary?.earliestStartDate)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Latest End</span>
                    <span className="font-medium">
                      {summary?.latestEndDate ? formatDate(summary.latestEndDate) : totalAssignments > 0 ? 'Ongoing' : '—'}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <FileCheck className="h-4 w-4 text-orange-600" />
                    Purchase Orders
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-gray-700">
                  <div className="flex items-center justify-between">
                    <span>Assignments Requiring PO</span>
                    <span className="font-semibold">{formatCount(summary?.poRequiredCount)}</span>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">PO Numbers</p>
                    {poNumbers.length > 0 ? (
                      <ul className="space-y-1">
                        {poNumbers.map((po) => (
                          <li key={po} className="font-medium text-gray-800">
                            {po}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-gray-500">No purchase orders recorded.</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Package className="h-4 w-4 text-amber-600" />
                    Revenue Snapshot
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-gray-700">
                  <p className="text-gray-500">
                    Detailed revenue metrics are coming soon. This section will summarize recurring charges and billing totals once reporting hooks are in place.
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Package className="h-4 w-4 text-purple-600" />
                  Quick Actions
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <Button id="overview-edit-details" variant="outline" onClick={() => setActiveTab('details')}>
                  <FileText className="mr-2 h-4 w-4" />
                  Edit Contract Details
                </Button>
                <Button id="overview-manage-lines" variant="outline" onClick={() => setActiveTab('lines')}>
                  <Layers3 className="mr-2 h-4 w-4" />
                  Manage Contract Lines
                </Button>
                <Button id="overview-manage-pricing" variant="outline" onClick={() => setActiveTab('pricing')}>
                  <CalendarClock className="mr-2 h-4 w-4" />
                  Manage Pricing Schedules
                </Button>
                <Button id="overview-view-invoices" variant="outline" onClick={() => setActiveTab('invoices')}>
                  <FileText className="mr-2 h-4 w-4" />
                  View Invoices
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Users className="h-4 w-4 text-sky-600" />
                  Assignment Details
                </CardTitle>
              </CardHeader>
              <CardContent>
                {assignments.length === 0 ? (
                  <div className="py-8 text-center text-sm text-gray-500">
                    No clients are currently assigned to this contract.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        <tr>
                          <th className="px-4 py-3">Client</th>
                          <th className="px-4 py-3">Start Date</th>
                          <th className="px-4 py-3">End Date</th>
                          <th className="px-4 py-3">PO</th>
                          <th className="px-4 py-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {assignments.map((assignment) => (
                          <tr key={assignment.client_contract_id} className="text-gray-700">
                            <td className="px-4 py-3">
                              <div className="font-medium text-gray-900">
                                {assignment.client_name || assignment.client_id}
                              </div>
                              <div className="text-xs text-gray-500">{assignment.client_id}</div>
                            </td>
                            <td className="px-4 py-3">{formatDate(assignment.start_date)}</td>
                            <td className="px-4 py-3">
                              {assignment.end_date ? formatDate(assignment.end_date) : 'Ongoing'}
                            </td>
                            <td className="px-4 py-3">
                              {assignment.po_required ? (
                                <Badge variant="outline" className="border-orange-300 text-orange-700">
                                  {assignment.po_number ? assignment.po_number : 'Required'}
                                </Badge>
                              ) : (
                                <span className="text-gray-500">Not required</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <Badge className={assignment.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}>
                                {assignment.is_active ? 'Active' : 'Inactive'}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="details">
          <ContractForm contract={contract} onContractUpdated={handleContractUpdated} />
          {saveSuccess && (
            <div className="mt-2 text-green-600 text-sm">
              Contract details saved successfully!
            </div>
          )}
        </TabsContent>

        <TabsContent value="lines">
          <ContractLines contract={contract} onContractLinesChanged={handleContractLinesChanged} />
        </TabsContent>

        <TabsContent value="pricing">
          <PricingSchedules contractId={contract.contract_id} />
        </TabsContent>

        <TabsContent value="invoices">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-600" />
                Contract Invoices
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-gray-600">
              <p className="mb-2">
                Invoice reporting for this contract is coming soon. Once available, you’ll be able to review invoice history, open balances, and links to generated documents here.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ContractDetail;
