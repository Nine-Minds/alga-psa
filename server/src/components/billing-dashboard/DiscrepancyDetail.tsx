'use client'

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Skeleton } from 'server/src/components/ui/Skeleton';
import { CustomTabs, TabContent } from 'server/src/components/ui/CustomTabs';
import { formatCurrency } from 'server/src/lib/utils/formatters';
import { formatDateOnly, formatDateTime } from 'server/src/lib/utils/dateTimeUtils';
import { parseISO } from 'date-fns';
import { ICreditReconciliationReport, ITransaction, ICreditTracking } from 'server/src/interfaces/billing.interfaces';
import { resolveReconciliationReport } from '@product/actions/creditReconciliationActions';
import { applyReconciliationFix } from '@product/actions/creditReconciliationFixActions';
import { getCurrentUser } from '@product/actions/user-actions/userActions';
import RecommendedFixPanel from './RecommendedFixPanel';
import { Badge } from 'server/src/components/ui/Badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTrigger } from 'server/src/components/ui/Dialog';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import BackNav from 'server/src/components/ui/BackNav';
import { AlertCircle, CheckCircle, XCircle, ArrowLeft } from 'lucide-react';

interface ClientInfo {
  id: string;
  name: string;
}

interface TransactionData {
  transactions: ITransaction[];
  loading: boolean;
}

interface CreditTrackingData {
  entries: ICreditTracking[];
  loading: boolean;
}

interface ExpandedState {
  [key: string]: boolean;
}

const DiscrepancyDetail: React.FC = () => {
  const params = useParams();
  const router = useRouter();
  const searchParams = new URLSearchParams(window.location.search);
  const action = searchParams.get('action');
  const reportId = params?.reportId as string;

  // State for data
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<ICreditReconciliationReport | null>(null);
  const [client, setClient] = useState<ClientInfo | null>(null);
  const [transactionData, setTransactionData] = useState<TransactionData>({
    transactions: [],
    loading: true
  });
  const [creditTrackingData, setCreditTrackingData] = useState<CreditTrackingData>({
    entries: [],
    loading: true
  });
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [isResolvingReport, setIsResolvingReport] = useState(false);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [isResolutionDialogOpen, setIsResolutionDialogOpen] = useState(false);
  const [isApplyingFix, setIsApplyingFix] = useState(false);
  const [activeTab, setActiveTab] = useState('transactions');
  const [expandedTransactions, setExpandedTransactions] = useState<ExpandedState>({});
  const [expandedCreditEntries, setExpandedCreditEntries] = useState<ExpandedState>({});

  // Check if we should open the fix dialog based on the action query parameter
  useEffect(() => {
    if (action === 'resolve' && report && report.status !== 'resolved') {
      // Scroll to the recommended fix panel
      setTimeout(() => {
        const fixPanel = document.getElementById('recommended-fix-panel');
        if (fixPanel) {
          fixPanel.scrollIntoView({ behavior: 'smooth' });
        }
      }, 500);
    }
  }, [action, report]);

  // Fetch report data
  useEffect(() => {
    const fetchReportData = async () => {
      if (!reportId) return;

      try {
        setLoading(true);
        
        // In a real implementation, this would be a server action to fetch the report
        // For now, we'll simulate the API call
        const response = await fetch(`/api/reconciliation-reports/${reportId}`);
        if (!response.ok) {
          throw new Error('Failed to fetch report');
        }
        
        const reportData = await response.json();
        setReport(reportData);
        
        // Fetch client info
        const clientResponse = await fetch(`/api/clients/${reportData.client_id}`);
        if (clientResponse.ok) {
          const clientData = await clientResponse.json();
          setClient(clientData);
        }
        
        setLoading(false);
      } catch (error) {
        console.error('Error fetching report data:', error);
        setLoading(false);
      }
    };

    fetchReportData();
  }, [reportId]);

  // Fetch related transactions
  useEffect(() => {
    const fetchTransactions = async () => {
      if (!report?.client_id) return;

      try {
        setTransactionData(prev => ({ ...prev, loading: true }));
        
        // In a real implementation, this would be a server action to fetch transactions
        // For now, we'll simulate the API call
        const response = await fetch(`/api/clients/${report.client_id}/transactions`);
        if (!response.ok) {
          throw new Error('Failed to fetch transactions');
        }
        
        const transactionsData = await response.json();
        setTransactionData({
          transactions: transactionsData,
          loading: false
        });
      } catch (error) {
        console.error('Error fetching transactions:', error);
        setTransactionData(prev => ({ ...prev, loading: false }));
      }
    };

    fetchTransactions();
  }, [report?.client_id]);

  // Fetch credit tracking entries
  useEffect(() => {
    const fetchCreditTracking = async () => {
      if (!report?.client_id) return;

      try {
        setCreditTrackingData(prev => ({ ...prev, loading: true }));
        
        // In a real implementation, this would be a server action to fetch credit tracking entries
        // For now, we'll simulate the API call
        const response = await fetch(`/api/clients/${report.client_id}/credit-tracking`);
        if (!response.ok) {
          throw new Error('Failed to fetch credit tracking entries');
        }
        
        const entriesData = await response.json();
        setCreditTrackingData({
          entries: entriesData,
          loading: false
        });
      } catch (error) {
        console.error('Error fetching credit tracking entries:', error);
        setCreditTrackingData(prev => ({ ...prev, loading: false }));
      }
    };

    fetchCreditTracking();
  }, [report?.client_id]);

  // Handle resolving the report
  const handleResolveReport = async () => {
    if (!report) return;

    try {
      setIsResolvingReport(true);
      setResolutionError(null);
      
      // Get the current user
      const currentUser = await getCurrentUser();
      if (!currentUser) {
        throw new Error('User not authenticated');
      }
      
      const resolvedReport = await resolveReconciliationReport(
        report.report_id,
        currentUser.user_id,
        resolutionNotes
      );
      
      // Update the report state with the resolved report
      setReport(resolvedReport);
      setIsResolutionDialogOpen(false);
      
      setIsResolvingReport(false);
    } catch (error) {
      console.error('Error resolving report:', error);
      setResolutionError(error instanceof Error ? error.message : 'An unknown error occurred');
      setIsResolvingReport(false);
    }
  };

  // Handle applying a fix
  const handleApplyFix = async (fixType: string, notes: string, customData?: any) => {
    if (!report) return;

    try {
      setIsApplyingFix(true);
      
      // Get the current user
      const currentUser = await getCurrentUser();
      if (!currentUser) {
        throw new Error('User not authenticated');
      }
      
      // Call the server action to apply the fix
      const resolvedReport = await applyReconciliationFix(
        report.report_id,
        currentUser.user_id,
        fixType,
        notes,
        customData
      );
      
      // Update the report state with the resolved report
      setReport(resolvedReport);
      
      setIsApplyingFix(false);
    } catch (error) {
      console.error('Error applying fix:', error);
      throw error; // Re-throw to be handled by the RecommendedFixPanel
    }
  };

  // Toggle transaction expansion
  const toggleTransactionExpansion = (transactionId: string) => {
    setExpandedTransactions(prev => ({
      ...prev,
      [transactionId]: !prev[transactionId]
    }));
  };

  // Toggle credit entry expansion
  const toggleCreditEntryExpansion = (creditId: string) => {
    setExpandedCreditEntries(prev => ({
      ...prev,
      [creditId]: !prev[creditId]
    }));
  };


  // Render loading state
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center space-x-2">
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-8 w-64" />
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
        
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Render error state if report not found
  if (!report) {
    return (
      <div className="space-y-6">
        <BackNav href="/msp/billing?tab=reconciliation">
          Back to Reconciliation Dashboard
        </BackNav>
        
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <div className="font-semibold">Error</div>
          <AlertDescription>
            Reconciliation report not found. The report may have been deleted or you may not have permission to view it.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Determine status color and icon
  const getStatusDisplay = () => {
    switch (report.status) {
      case 'open':
        return {
          color: 'bg-[rgb(var(--color-accent-100))] text-[rgb(var(--color-accent-900))]',
          icon: <AlertCircle className="h-4 w-4 mr-1" />,
          text: 'Open'
        };
      case 'in_review':
        return {
          color: 'bg-[rgb(var(--color-secondary-100))] text-[rgb(var(--color-secondary-900))]',
          icon: <CheckCircle className="h-4 w-4 mr-1" />,
          text: 'In Review'
        };
      case 'resolved':
        return {
          color: 'bg-[rgb(var(--color-primary-100))] text-[rgb(var(--color-primary-900))]',
          icon: <CheckCircle className="h-4 w-4 mr-1" />,
          text: 'Resolved'
        };
      default:
        return {
          color: 'bg-gray-100 text-gray-800',
          icon: <XCircle className="h-4 w-4 mr-1" />,
          text: report.status
        };
    }
  };

  const statusDisplay = getStatusDisplay();

  // Determine if this is a credit tracking issue
  const isCreditTrackingIssue = report.metadata && 
    (report.metadata.issue_type === 'missing_credit_tracking_entry' || 
     report.metadata.issue_type === 'inconsistent_credit_remaining_amount');

  // Prepare tabs content
  const tabsContent: TabContent[] = [
    {
      label: 'Transaction History',
      content: (
        <Card>
          <CardHeader>
            <CardTitle>Related Transactions</CardTitle>
            <CardDescription>
              Transaction history related to this discrepancy
            </CardDescription>
          </CardHeader>
          <CardContent>
            {transactionData.loading ? (
              <Skeleton className="h-64 w-full" />
            ) : transactionData.transactions.length === 0 ? (
              <div className="text-center py-8 text-[rgb(var(--color-text-500))]">
                No transactions found
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-[rgb(var(--color-border-200))]">
                      <th className="px-4 py-2 text-left text-sm font-medium text-[rgb(var(--color-text-500))]">Date</th>
                      <th className="px-4 py-2 text-left text-sm font-medium text-[rgb(var(--color-text-500))]">Type</th>
                      <th className="px-4 py-2 text-left text-sm font-medium text-[rgb(var(--color-text-500))]">Amount</th>
                      <th className="px-4 py-2 text-left text-sm font-medium text-[rgb(var(--color-text-500))]">Balance After</th>
                      <th className="px-4 py-2 text-left text-sm font-medium text-[rgb(var(--color-text-500))]">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactionData.transactions.map((transaction) => (
                      <React.Fragment key={transaction.transaction_id}>
                        <tr
                          className={`border-b border-[rgb(var(--color-border-200))] hover:bg-[rgb(var(--color-background-100))] cursor-pointer ${
                            expandedTransactions[transaction.transaction_id] ? 'bg-[rgb(var(--color-background-100))]' : ''
                          }`}
                          onClick={() => toggleTransactionExpansion(transaction.transaction_id)}
                        >
                          <td className="px-4 py-2 text-sm">
                            {formatDateOnly(parseISO(transaction.created_at))}
                          </td>
                          <td className="px-4 py-2 text-sm">
                            <Badge variant="default" className="font-normal">
                              {transaction.type.replace(/_/g, ' ')}
                            </Badge>
                          </td>
                          <td className={`px-4 py-2 text-sm font-medium ${
                            transaction.amount >= 0
                              ? 'text-[rgb(var(--color-primary-600))]'
                              : 'text-[rgb(var(--color-destructive-600))]'
                          }`}>
                            {formatCurrency(transaction.amount)}
                          </td>
                          <td className="px-4 py-2 text-sm">
                            {formatCurrency(transaction.balance_after)}
                          </td>
                          <td className="px-4 py-2 text-sm">
                            {transaction.description || '-'}
                          </td>
                        </tr>
                        {expandedTransactions[transaction.transaction_id] && (
                          <tr className="bg-[rgb(var(--color-background-50))]">
                            <td colSpan={5} className="px-6 py-3">
                              <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                  <p className="text-xs text-[rgb(var(--color-text-500))]">Transaction ID</p>
                                  <p className="font-mono">{transaction.transaction_id}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-[rgb(var(--color-text-500))]">Created At</p>
                                  <p>{formatDateTime(parseISO(transaction.created_at), 'PPpp')}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-[rgb(var(--color-text-500))]">Client ID</p>
                                  <p className="font-mono">{transaction.client_id}</p>
                                </div>
                                {transaction.metadata?.user_id && (
                                  <div>
                                    <p className="text-xs text-[rgb(var(--color-text-500))]">User ID</p>
                                    <p className="font-mono">{transaction.metadata.user_id}</p>
                                  </div>
                                )}
                                {transaction.invoice_id && (
                                  <div>
                                    <p className="text-xs text-[rgb(var(--color-text-500))]">Invoice ID</p>
                                    <p className="font-mono">{transaction.invoice_id}</p>
                                  </div>
                                )}
                                {transaction.metadata && (
                                  <div className="col-span-2">
                                    <p className="text-xs text-[rgb(var(--color-text-500))]">Metadata</p>
                                    <pre className="bg-[rgb(var(--color-background-200))] p-2 rounded text-xs overflow-x-auto">
                                      {JSON.stringify(transaction.metadata, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )
    },
    {
      label: 'Credit Tracking Entries',
      content: (
        <Card>
          <CardHeader>
            <CardTitle>Credit Tracking Entries</CardTitle>
            <CardDescription>
              Credit tracking entries related to this client
            </CardDescription>
          </CardHeader>
          <CardContent>
            {creditTrackingData.loading ? (
              <Skeleton className="h-64 w-full" />
            ) : creditTrackingData.entries.length === 0 ? (
              <div className="text-center py-8 text-[rgb(var(--color-text-500))]">
                No credit tracking entries found
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-[rgb(var(--color-border-200))]">
                      <th className="px-4 py-2 text-left text-sm font-medium text-[rgb(var(--color-text-500))]">Credit ID</th>
                      <th className="px-4 py-2 text-left text-sm font-medium text-[rgb(var(--color-text-500))]">Transaction ID</th>
                      <th className="px-4 py-2 text-left text-sm font-medium text-[rgb(var(--color-text-500))]">Created</th>
                      <th className="px-4 py-2 text-left text-sm font-medium text-[rgb(var(--color-text-500))]">Amount</th>
                      <th className="px-4 py-2 text-left text-sm font-medium text-[rgb(var(--color-text-500))]">Remaining</th>
                      <th className="px-4 py-2 text-left text-sm font-medium text-[rgb(var(--color-text-500))]">Expiration</th>
                      <th className="px-4 py-2 text-left text-sm font-medium text-[rgb(var(--color-text-500))]">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creditTrackingData.entries.map((entry) => (
                      <React.Fragment key={entry.credit_id}>
                        <tr
                          className={`border-b border-[rgb(var(--color-border-200))] hover:bg-[rgb(var(--color-background-100))] cursor-pointer ${
                            expandedCreditEntries[entry.credit_id] ? 'bg-[rgb(var(--color-background-100))]' : ''
                          }`}
                          onClick={() => toggleCreditEntryExpansion(entry.credit_id)}
                        >
                          <td className="px-4 py-2 text-sm font-mono">
                            {entry.credit_id.substring(0, 8)}...
                          </td>
                          <td className="px-4 py-2 text-sm font-mono">
                            {entry.transaction_id.substring(0, 8)}...
                          </td>
                          <td className="px-4 py-2 text-sm">
                            {formatDateOnly(parseISO(entry.created_at))}
                          </td>
                          <td className="px-4 py-2 text-sm font-medium text-[rgb(var(--color-primary-600))]">
                            {formatCurrency(entry.amount)}
                          </td>
                          <td className="px-4 py-2 text-sm">
                            {formatCurrency(entry.remaining_amount)}
                          </td>
                          <td className="px-4 py-2 text-sm">
                            {entry.expiration_date
                              ? formatDateOnly(parseISO(entry.expiration_date))
                              : 'No expiration'}
                          </td>
                          <td className="px-4 py-2 text-sm">
                            {entry.is_expired ? (
                              <Badge variant="default" className="bg-[rgb(var(--color-destructive-100))] text-[rgb(var(--color-destructive-700))] border-[rgb(var(--color-destructive-200))]">
                                Expired
                              </Badge>
                            ) : (
                              <Badge variant="default" className="bg-[rgb(var(--color-primary-100))] text-[rgb(var(--color-primary-700))] border-[rgb(var(--color-primary-200))]">
                                Active
                              </Badge>
                            )}
                          </td>
                        </tr>
                        {expandedCreditEntries[entry.credit_id] && (
                          <tr className="bg-[rgb(var(--color-background-50))]">
                            <td colSpan={7} className="px-6 py-3">
                              <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                  <p className="text-xs text-[rgb(var(--color-text-500))]">Credit ID</p>
                                  <p className="font-mono">{entry.credit_id}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-[rgb(var(--color-text-500))]">Transaction ID</p>
                                  <p className="font-mono">{entry.transaction_id}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-[rgb(var(--color-text-500))]">Client ID</p>
                                  <p className="font-mono">{entry.client_id}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-[rgb(var(--color-text-500))]">Created At</p>
                                  <p>{formatDateTime(parseISO(entry.created_at), 'PPpp')}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-[rgb(var(--color-text-500))]">Original Amount</p>
                                  <p className="font-medium">{formatCurrency(entry.amount)}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-[rgb(var(--color-text-500))]">Remaining Amount</p>
                                  <p className="font-medium">{formatCurrency(entry.remaining_amount)}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-[rgb(var(--color-text-500))]">Expiration Date</p>
                                  <p>{entry.expiration_date
                                    ? formatDateTime(parseISO(entry.expiration_date), 'PPpp')
                                    : 'No expiration'}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-[rgb(var(--color-text-500))]">Status</p>
                                  <p>{entry.is_expired ? 'Expired' : 'Active'}</p>
                                </div>
                                {/* Credit applications would be fetched separately in a real implementation */}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )
    }
  ];

  // Add issue details tab if this is a credit tracking issue
  if (isCreditTrackingIssue) {
    tabsContent.push({
      label: 'Issue Details',
      content: (
        <Card>
          <CardHeader>
            <CardTitle>Issue Details</CardTitle>
            <CardDescription>
              Detailed information about the credit tracking issue
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!report.metadata ? (
              <div className="text-center py-8 text-[rgb(var(--color-text-500))]">
                No issue details available
              </div>
            ) : report.metadata.issue_type === 'missing_credit_tracking_entry' ? (
              <div className="space-y-4">
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <div className="font-semibold">Missing Credit Tracking Entry</div>
                  <AlertDescription>
                    A credit transaction was found without a corresponding credit tracking entry.
                  </AlertDescription>
                </Alert>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-[rgb(var(--color-text-500))]">Transaction ID</p>
                    <p className="font-medium font-mono">{report.metadata.transaction_id}</p>
                  </div>
                  <div>
                    <p className="text-sm text-[rgb(var(--color-text-500))]">Transaction Type</p>
                    <p className="font-medium">{report.metadata.transaction_type.replace(/_/g, ' ')}</p>
                  </div>
                  <div>
                    <p className="text-sm text-[rgb(var(--color-text-500))]">Transaction Amount</p>
                    <p className="font-medium">{formatCurrency(report.metadata.transaction_amount)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-[rgb(var(--color-text-500))]">Transaction Date</p>
                    <p className="font-medium">{formatDateTime(parseISO(report.metadata.transaction_date), 'PPpp')}</p>
                  </div>
                </div>
                
                <div className="mt-4">
                  <h4 className="font-medium mb-2">Recommended Fix</h4>
                  <p className="text-sm text-[rgb(var(--color-text-500))]">
                    Create a credit tracking entry for this transaction with the following details:
                  </p>
                  <ul className="list-disc list-inside mt-2 text-sm text-[rgb(var(--color-text-500))]">
                    <li>Transaction ID: {report.metadata.transaction_id}</li>
                    <li>Amount: {formatCurrency(report.metadata.transaction_amount)}</li>
                    <li>Remaining Amount: Calculate based on any applications</li>
                  </ul>
                </div>
              </div>
            ) : report.metadata.issue_type === 'inconsistent_credit_remaining_amount' ? (
              <div className="space-y-4">
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <div className="font-semibold">Inconsistent Credit Remaining Amount</div>
                  <AlertDescription>
                    The remaining amount in a credit tracking entry doesn't match the expected value based on transaction history.
                  </AlertDescription>
                </Alert>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-[rgb(var(--color-text-500))]">Credit ID</p>
                    <p className="font-medium font-mono">{report.metadata.credit_id}</p>
                  </div>
                  <div>
                    <p className="text-sm text-[rgb(var(--color-text-500))]">Transaction ID</p>
                    <p className="font-medium font-mono">{report.metadata.transaction_id}</p>
                  </div>
                  <div>
                    <p className="text-sm text-[rgb(var(--color-text-500))]">Original Amount</p>
                    <p className="font-medium">{formatCurrency(report.metadata.original_amount)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-[rgb(var(--color-text-500))]">Expected Remaining</p>
                    <p className="font-medium">{formatCurrency(report.expected_balance)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-[rgb(var(--color-text-500))]">Actual Remaining</p>
                    <p className="font-medium">{formatCurrency(report.actual_balance)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-[rgb(var(--color-text-500))]">Difference</p>
                    <p className="font-medium">{formatCurrency(report.difference)}</p>
                  </div>
                </div>
                
                {report.metadata.applications && report.metadata.applications.length > 0 && (
                  <div className="mt-4">
                    <h4 className="font-medium mb-2">Credit Applications</h4>
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b border-[rgb(var(--color-border-200))]">
                          <th className="px-4 py-2 text-left text-sm font-medium text-[rgb(var(--color-text-500))]">Transaction ID</th>
                          <th className="px-4 py-2 text-left text-sm font-medium text-[rgb(var(--color-text-500))]">Date</th>
                          <th className="px-4 py-2 text-left text-sm font-medium text-[rgb(var(--color-text-500))]">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.metadata.applications.map((app: any, index: number) => (
                          <tr 
                            key={index} 
                            className="border-b border-[rgb(var(--color-border-200))] hover:bg-[rgb(var(--color-background-100))]"
                          >
                            <td className="px-4 py-2 text-sm font-mono">
                              {app.transaction_id.substring(0, 8)}...
                            </td>
                            <td className="px-4 py-2 text-sm">
                              {formatDateOnly(parseISO(app.created_at))}
                            </td>
                            <td className="px-4 py-2 text-sm font-medium text-[rgb(var(--color-destructive-600))]">
                              {formatCurrency(app.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                
                <div className="mt-4">
                  <h4 className="font-medium mb-2">Recommended Fix</h4>
                  <p className="text-sm text-[rgb(var(--color-text-500))]">
                    Update the credit tracking entry's remaining amount to match the expected value:
                  </p>
                  <ul className="list-disc list-inside mt-2 text-sm text-[rgb(var(--color-text-500))]">
                    <li>Credit ID: {report.metadata.credit_id}</li>
                    <li>Current Remaining Amount: {formatCurrency(report.actual_balance)}</li>
                    <li>Corrected Remaining Amount: {formatCurrency(report.expected_balance)}</li>
                  </ul>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-[rgb(var(--color-text-500))]">
                Unknown issue type: {report.metadata.issue_type}
              </div>
            )}
          </CardContent>
          <CardFooter>
            <div className="w-full flex justify-end">
              {report.status !== 'resolved' && (
                <Button id="apply-fix-button" onClick={() => setIsResolutionDialogOpen(true)}>
                  Apply Recommended Fix
                </Button>
              )}
            </div>
          </CardFooter>
        </Card>
      )
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <BackNav href="/msp/billing?tab=reconciliation">
          Back to Reconciliation Dashboard
        </BackNav>
        
        {report.status !== 'resolved' && (
          <Dialog
            isOpen={isResolutionDialogOpen}
            onClose={() => setIsResolutionDialogOpen(false)}
            title="Resolve Credit Discrepancy"
          >
            <DialogTrigger asChild>
              <Button id="resolve-report-button">
                Resolve Discrepancy
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogDescription>
                This will create a credit adjustment transaction to correct the balance discrepancy.
                Please provide notes explaining the reason for this correction.
              </DialogDescription>
              
              <div className="py-4">
                <div className="space-y-2">
                  <h4 className="font-medium">Discrepancy Details</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>Expected Balance:</div>
                    <div className="font-medium">{formatCurrency(report.expected_balance)}</div>
                    <div>Actual Balance:</div>
                    <div className="font-medium">{formatCurrency(report.actual_balance)}</div>
                    <div>Difference:</div>
                    <div className="font-medium">{formatCurrency(report.difference)}</div>
                  </div>
                </div>
                
                <div className="mt-4">
                  <label htmlFor="resolution-notes" className="block text-sm font-medium mb-1">
                    Resolution Notes
                  </label>
                  <TextArea
                    id="resolution-notes"
                    value={resolutionNotes}
                    onChange={(e) => setResolutionNotes(e.target.value)}
                    placeholder="Explain the reason for this correction..."
                    className="w-full"
                    rows={4}
                  />
                </div>
                
                {resolutionError && (
                  <Alert variant="destructive" className="mt-4">
                    <AlertCircle className="h-4 w-4" />
                    <div className="font-semibold">Error</div>
                    <AlertDescription>{resolutionError}</AlertDescription>
                  </Alert>
                )}
              </div>
              
              <DialogFooter>
                <Button id="cancel-resolution-button" variant="outline" onClick={() => setIsResolutionDialogOpen(false)}>
                  Cancel
                </Button>
                <Button 
                  id="confirm-resolution-button"
                  onClick={handleResolveReport} 
                  disabled={isResolvingReport || !resolutionNotes.trim()}
                >
                  {isResolvingReport ? 'Processing...' : 'Confirm Resolution'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Discrepancy Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between">
                <div>
                  <p className="text-sm text-[rgb(var(--color-text-500))]">Client</p>
                  <p className="font-medium">{client?.name || report.client_id}</p>
                </div>
                <div>
                  <p className="text-sm text-[rgb(var(--color-text-500))]">Status</p>
                  <Badge className={`${statusDisplay.color} flex items-center`}>
                    {statusDisplay.icon} {statusDisplay.text}
                  </Badge>
                </div>
              </div>
              
              <div className="flex justify-between">
                <div>
                  <p className="text-sm text-[rgb(var(--color-text-500))]">Detected</p>
                  <p className="font-medium">{formatDateTime(parseISO(report.detection_date), 'PPpp')}</p>
                </div>
                {report.status === 'resolved' && (
                  <div>
                    <p className="text-sm text-[rgb(var(--color-text-500))]">Resolved</p>
                    <p className="font-medium">{report.resolution_date ? formatDateTime(parseISO(report.resolution_date), 'PPpp') : 'N/A'}</p>
                  </div>
                )}
              </div>
              
              {report.status === 'resolved' && (
                <div>
                  <p className="text-sm text-[rgb(var(--color-text-500))]">Resolution Notes</p>
                  <p className="font-medium">{report.resolution_notes || 'No notes provided'}</p>
                </div>
              )}
              
              {isCreditTrackingIssue && report.metadata && (
                <div>
                  <p className="text-sm text-[rgb(var(--color-text-500))]">Issue Type</p>
                  <p className="font-medium">
                    {report.metadata.issue_type === 'missing_credit_tracking_entry' 
                      ? 'Missing Credit Tracking Entry' 
                      : 'Inconsistent Credit Remaining Amount'}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Balance Comparison</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[rgb(var(--color-primary-50))] p-4 rounded-lg">
                <p className="text-sm text-[rgb(var(--color-text-500))]">Expected Balance</p>
                <p className="text-2xl font-bold text-[rgb(var(--color-primary-700))]">
                  {formatCurrency(report.expected_balance)}
                </p>
              </div>
              
              <div className="bg-[rgb(var(--color-accent-50))] p-4 rounded-lg">
                <p className="text-sm text-[rgb(var(--color-text-500))]">Actual Balance</p>
                <p className="text-2xl font-bold text-[rgb(var(--color-accent-700))]">
                  {formatCurrency(report.actual_balance)}
                </p>
              </div>
              
              <div className="col-span-2 bg-[rgb(var(--color-secondary-50))] p-4 rounded-lg">
                <p className="text-sm text-[rgb(var(--color-text-500))]">Difference</p>
                <p className={`text-2xl font-bold ${report.difference >= 0 
                  ? 'text-[rgb(var(--color-primary-700))]' 
                  : 'text-[rgb(var(--color-destructive-600))]'}`}>
                  {formatCurrency(report.difference)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Recommended Fix Panel */}
      {report.status !== 'resolved' && (
        <div id="recommended-fix-panel">
          <RecommendedFixPanel
            report={report}
            onApplyFix={handleApplyFix}
          />
        </div>
      )}
      
      <CustomTabs
        tabs={tabsContent}
        defaultTab={tabsContent[0].label}
        onTabChange={(tab) => setActiveTab(tab)}
      />
    </div>
  );
};

export default DiscrepancyDetail;
