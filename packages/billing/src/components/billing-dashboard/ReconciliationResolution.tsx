'use client'

import React, { useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { formatCurrency } from 'server/src/lib/utils/formatters';
import { formatDateOnly, formatDateTime } from 'server/src/lib/utils/dateTimeUtils';
import { parseISO } from 'date-fns';
import { ICreditReconciliationReport, ITransaction, ICreditTracking } from 'server/src/interfaces/billing.interfaces';
import { resolveReconciliationReport } from '@alga-psa/billing/actions/creditReconciliationActions';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTrigger } from '@alga-psa/ui/components/Dialog';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { AlertCircle, CheckCircle, XCircle, ArrowLeft, AlertTriangle, Info } from 'lucide-react';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';

// Define the threshold for requiring four-eyes approval
const FOUR_EYES_THRESHOLD = 1000; // $1000

// Define the steps in the resolution workflow
const STEPS = [
  { id: 'review', label: 'Review Discrepancy' },
  { id: 'approve', label: 'Approval' },
  { id: 'confirm', label: 'Confirmation' }
];

// Map step IDs to URL-safe slugs
const stepIdToSlugMap: Record<string, string> = {
  'review': 'review-discrepancy',
  'approve': 'approval',
  'confirm': 'confirmation'
};

// Map URL slugs to step indices
const slugToStepIndexMap: Record<string, number> = {
  'review-discrepancy': 0,
  'approval': 1,
  'confirmation': 2
};

// Map step indices to URL slugs
const stepIndexToSlugMap: Record<number, string> = {
  0: 'review-discrepancy',
  1: 'approval',
  2: 'confirmation'
};

// Simple Stepper component
interface StepperProps {
  currentStep: number;
  steps: typeof STEPS;
  className?: string;
}

const Stepper: React.FC<StepperProps> = ({ currentStep, steps, className }) => {
  return (
    <div className={`flex items-center justify-between ${className || ''}`}>
      {steps.map((step, index) => {
        const isCompleted = currentStep > index;
        const isCurrent = currentStep === index;
        
        return (
          <div key={step.id} className="flex items-center flex-1">
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  isCompleted
                    ? 'bg-[rgb(var(--color-primary-600))] text-white'
                    : isCurrent
                      ? 'bg-[rgb(var(--color-primary-100))] text-[rgb(var(--color-primary-900))] border border-[rgb(var(--color-primary-600))]'
                      : 'bg-[rgb(var(--color-background-200))] text-[rgb(var(--color-text-500))]'
                }`}
              >
                {isCompleted ? (
                  <CheckCircle className="h-5 w-5" />
                ) : (
                  <span>{index + 1}</span>
                )}
              </div>
              <span className={`text-xs mt-1 ${
                isCurrent ? 'font-medium text-[rgb(var(--color-primary-900))]' : 'text-[rgb(var(--color-text-500))]'
              }`}>
                {step.label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-2 ${
                  isCompleted ? 'bg-[rgb(var(--color-primary-600))]' : 'bg-[rgb(var(--color-background-200))]'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

// Define the possible resolution types
type ResolutionType = 'recommended' | 'custom' | 'no_action';

// Define the approval state
interface ApprovalState {
  notes: string;
  secondaryApproval: boolean;
  secondaryApproverName: string;
  secondaryApproverEmail: string;
  secondaryApprovalCode: string;
  secondaryApprovalSent: boolean;
  secondaryApprovalVerified: boolean;
}

// Define the component props
interface ReconciliationResolutionProps {
  reportId?: string;
  onClose?: () => void;
  onComplete?: () => void;
}

const ReconciliationResolution: React.FC<ReconciliationResolutionProps> = ({
  reportId: propReportId,
  onClose,
  onComplete
}) => {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const stepParam = searchParams?.get('step');
  const reportId = propReportId || (params?.reportId as string);

  // Determine initial step based on URL parameter
  const getInitialStep = (): number => {
    if (stepParam && slugToStepIndexMap[stepParam] !== undefined) {
      return slugToStepIndexMap[stepParam];
    }
    return 0; // Default to first step (review-discrepancy)
  };

  // State for data
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<ICreditReconciliationReport | null>(null);
  const [client, setClient] = useState<{ id: string; name: string } | null>(null);
  const [transactionData, setTransactionData] = useState<ITransaction[]>([]);
  const [creditTrackingData, setCreditTrackingData] = useState<ICreditTracking[]>([]);

  // State for the wizard
  const [currentStep, setCurrentStep] = useState<number>(getInitialStep);
  const [resolutionType, setResolutionType] = useState<ResolutionType>('recommended');
  const [customAmount, setCustomAmount] = useState<string>('0');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConfirmationDialogOpen, setIsConfirmationDialogOpen] = useState(false);

  // State for approval
  const [approval, setApproval] = useState<ApprovalState>({
    notes: '',
    secondaryApproval: false,
    secondaryApproverName: '',
    secondaryApproverEmail: '',
    secondaryApprovalCode: '',
    secondaryApprovalSent: false,
    secondaryApprovalVerified: false
  });

  // Update URL when step changes
  const updateStepURL = (stepIndex: number): void => {
    const urlSlug = stepIndexToSlugMap[stepIndex];
    const currentSearchParams = new URLSearchParams(window.location.search);

    if (urlSlug && urlSlug !== 'review-discrepancy') {
      currentSearchParams.set('step', urlSlug);
    } else {
      currentSearchParams.delete('step');
    }

    const newUrl = currentSearchParams.toString()
      ? `${window.location.pathname}?${currentSearchParams.toString()}`
      : window.location.pathname;

    window.history.pushState({}, '', newUrl);
  };

  // Sync step from URL parameter when it changes externally
  useEffect(() => {
    if (stepParam) {
      const stepIndex = slugToStepIndexMap[stepParam];
      if (stepIndex !== undefined && stepIndex !== currentStep) {
        setCurrentStep(stepIndex);
      }
    } else if (currentStep !== 0) {
      // If no step param but we're not on first step, sync URL
      updateStepURL(currentStep);
    }
  }, [stepParam]);

  // Fetch report data
  useEffect(() => {
    const fetchReportData = async () => {
      if (!reportId) return;

      try {
        setLoading(true);
        
        // In a real implementation, this would be a server action to fetch the report
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

        // Fetch related transactions
        const transactionsResponse = await fetch(`/api/clients/${reportData.client_id}/transactions`);
        if (transactionsResponse.ok) {
          const transactionsData = await transactionsResponse.json();
          setTransactionData(transactionsData);
        }

        // Fetch credit tracking entries
        const creditTrackingResponse = await fetch(`/api/clients/${reportData.client_id}/credit-tracking`);
        if (creditTrackingResponse.ok) {
          const entriesData = await creditTrackingResponse.json();
          setCreditTrackingData(entriesData);
        }
        
        setLoading(false);
      } catch (error) {
        console.error('Error fetching report data:', error);
        setLoading(false);
        setError('Failed to load reconciliation report data');
      }
    };

    fetchReportData();
  }, [reportId]);

  // Determine if four-eyes principle is required
  const requiresFourEyes = report && Math.abs(report.difference) >= FOUR_EYES_THRESHOLD;

  // Handle next step
  const handleNextStep = () => {
    if (currentStep === 1 && requiresFourEyes && !approval.secondaryApprovalVerified) {
      setError('Secondary approval is required for this correction');
      return;
    }

    if (currentStep < STEPS.length - 1) {
      const newStep = currentStep + 1;
      setCurrentStep(newStep);
      updateStepURL(newStep);
      setError(null);
    }
  };

  // Handle previous step
  const handlePreviousStep = () => {
    if (currentStep > 0) {
      const newStep = currentStep - 1;
      setCurrentStep(newStep);
      updateStepURL(newStep);
      setError(null);
    }
  };

  // Handle resolution type change
  const handleResolutionTypeChange = (type: ResolutionType) => {
    setResolutionType(type);
    if (type === 'custom' && report) {
      setCustomAmount(report.difference.toString());
    }
  };

  // Handle custom amount change
  const handleCustomAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (/^-?\d*\.?\d*$/.test(value)) { // Allow negative numbers and decimals
      setCustomAmount(value);
    }
  };

  // Handle approval notes change
  const handleNotesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setApproval({ ...approval, notes: e.target.value });
  };

  // Handle secondary approver name change
  const handleSecondaryApproverNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setApproval({ ...approval, secondaryApproverName: e.target.value });
  };

  // Handle secondary approver email change
  const handleSecondaryApproverEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setApproval({ ...approval, secondaryApproverEmail: e.target.value });
  };

  // Handle sending secondary approval request
  const handleSendSecondaryApproval = () => {
    if (!approval.secondaryApproverName || !approval.secondaryApproverEmail) {
      setError('Please enter the name and email of the secondary approver');
      return;
    }

    // In a real implementation, this would send an email with a verification code
    // For now, we'll simulate it by generating a random code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`Verification code for ${approval.secondaryApproverEmail}: ${verificationCode}`);
    
    setApproval({
      ...approval,
      secondaryApprovalCode: verificationCode,
      secondaryApprovalSent: true
    });
  };

  // Handle verification code change
  const handleVerificationCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const code = e.target.value;
    if (/^\d*$/.test(code)) { // Only allow digits
      setApproval({ ...approval, secondaryApprovalCode: code });
    }
  };

  // Handle verification code submission
  const handleVerifyCode = () => {
    // In a real implementation, this would verify the code against what was sent
    // For now, we'll simulate it by checking if the code is 6 digits
    if (approval.secondaryApprovalCode.length === 6) {
      setApproval({ ...approval, secondaryApprovalVerified: true });
      setError(null);
    } else {
      setError('Invalid verification code');
    }
  };

  // Handle resolution submission
  const handleSubmitResolution = async () => {
    if (!report) return;

    try {
      setIsProcessing(true);
      setError(null);

      // If resolution type is 'no_action', we'll just update the status without making corrections
      if (resolutionType === 'no_action') {
        // In a real implementation, this would call a different server action
        // For now, we'll simulate it
        console.log('Marking report as resolved without correction');
        setIsProcessing(false);
        setIsConfirmationDialogOpen(true);
        return;
      }

      // Determine the correction amount
      const correctionAmount = resolutionType === 'recommended'
        ? report.difference
        : parseFloat(customAmount);

      // In a real implementation, this would call the server action
      const userId = 'current-user-id'; // This would come from authentication
      const resolvedReport = await resolveReconciliationReport(
        report.report_id,
        userId,
        approval.notes
      );
      
      // Update the report state with the resolved report
      setReport(resolvedReport);
      setIsProcessing(false);
      setIsConfirmationDialogOpen(true);
    } catch (error) {
      console.error('Error resolving report:', error);
      setError(error instanceof Error ? error.message : 'An unknown error occurred');
      setIsProcessing(false);
    }
  };

  // Handle closing the confirmation dialog
  const handleCloseConfirmation = () => {
    setIsConfirmationDialogOpen(false);
    if (onComplete) {
      onComplete();
    } else {
      // Navigate back to the reconciliation dashboard
      router.push('/billing-dashboard/reconciliation');
    }
  };

  // Handle canceling the resolution
  const handleCancel = () => {
    if (onClose) {
      onClose();
    } else {
      // Navigate back to the detail view
      router.push(`/billing-dashboard/reconciliation/${reportId}`);
    }
  };

  // Determine the correction amount based on resolution type
  const getCorrectionAmount = () => {
    if (!report) return 0;
    
    switch (resolutionType) {
      case 'recommended':
        return report.difference;
      case 'custom':
        return parseFloat(customAmount) || 0;
      case 'no_action':
        return 0;
      default:
        return report.difference;
    }
  };

  // Calculate the new balance after correction
  const getNewBalance = () => {
    if (!report) return 0;
    
    if (resolutionType === 'no_action') {
      return report.actual_balance;
    }
    
    return report.actual_balance + getCorrectionAmount();
  };

  // Determine if this is a credit tracking issue
  const isCreditTrackingIssue = report?.metadata &&
    (report.metadata.issue_type === 'missing_credit_tracking_entry' ||
     report.metadata.issue_type === 'inconsistent_credit_remaining_amount');

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
      </div>
    );
  }

  // Render error state if report not found
  if (!report) {
    return (
      <div className="space-y-6">
        <Button id="back-to-list-button" variant="outline" onClick={handleCancel} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <div className="font-semibold">Error</div>
          <AlertDescription>
            {error || 'Reconciliation report not found. The report may have been deleted or you may not have permission to view it.'}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Render the resolution workflow
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <Button id="back-button" variant="outline" onClick={handleCancel} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        
        <h2 className="text-xl font-bold">Resolve Credit Discrepancy</h2>
      </div>
      
      <Stepper currentStep={currentStep} steps={STEPS} className="mb-8" />
      
      {/* Step 1: Review Discrepancy */}
      {currentStep === 0 && (
        <div className="space-y-6">
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
                      <Badge className="bg-[rgb(var(--color-accent-100))] text-[rgb(var(--color-accent-900))] flex items-center">
                        <AlertCircle className="h-4 w-4 mr-1" /> Open
                      </Badge>
                    </div>
                  </div>
                  
                  <div>
                    <p className="text-sm text-[rgb(var(--color-text-500))]">Detected</p>
                    <p className="font-medium">{formatDateTime(parseISO(report.detection_date), 'PPpp')}</p>
                  </div>
                  
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
          
          {/* Issue-specific details */}
          {isCreditTrackingIssue && report.metadata && (
            <Card>
              <CardHeader>
                <CardTitle>Issue Details</CardTitle>
                <CardDescription>
                  Detailed information about the credit tracking issue
                </CardDescription>
              </CardHeader>
              <CardContent>
                {report.metadata.issue_type === 'missing_credit_tracking_entry' ? (
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
            </Card>
          )}
          
          {/* Resolution options */}
          <Card>
            <CardHeader>
              <CardTitle>Resolution Options</CardTitle>
              <CardDescription>
                Select how you want to resolve this discrepancy
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <input
                    type="radio"
                    id="recommended-fix"
                    name="resolution-type"
                    checked={resolutionType === 'recommended'}
                    onChange={() => handleResolutionTypeChange('recommended')}
                    className="h-4 w-4 text-[rgb(var(--color-primary-600))] focus:ring-[rgb(var(--color-primary-500))]"
                  />
                  <label htmlFor="recommended-fix" className="text-sm font-medium text-[rgb(var(--color-text-900))]">
                    Apply Recommended Fix ({formatCurrency(report.difference)})
                  </label>
                </div>
                
                <div className="flex items-start space-x-2">
                  <input
                    type="radio"
                    id="custom-fix"
                    name="resolution-type"
                    checked={resolutionType === 'custom'}
                    onChange={() => handleResolutionTypeChange('custom')}
                    className="h-4 w-4 mt-1 text-[rgb(var(--color-primary-600))] focus:ring-[rgb(var(--color-primary-500))]"
                  />
                  <div className="flex-1">
                    <label htmlFor="custom-fix" className="text-sm font-medium text-[rgb(var(--color-text-900))]">
                      Custom Correction
                    </label>
                    {resolutionType === 'custom' && (
                      <div className="mt-2">
                        <Label htmlFor="custom-amount">Correction Amount</Label>
                        <Input
                          id="custom-amount"
                          type="text"
                          value={customAmount}
                          onChange={handleCustomAmountChange}
                          className="mt-1"
                        />
                        <p className="text-xs text-[rgb(var(--color-text-500))] mt-1">
                          Enter a positive value to increase the balance, or a negative value to decrease it.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  <input
                    type="radio"
                    id="no-action"
                    name="resolution-type"
                    checked={resolutionType === 'no_action'}
                    onChange={() => handleResolutionTypeChange('no_action')}
                    className="h-4 w-4 text-[rgb(var(--color-primary-600))] focus:ring-[rgb(var(--color-primary-500))]"
                  />
                  <label htmlFor="no-action" className="text-sm font-medium text-[rgb(var(--color-text-900))]">
                    No Action Required (Mark as Resolved Without Correction)
                  </label>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button id="cancel-button" variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
              <Button id="next-button" onClick={handleNextStep}>
                Next
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}
      
      {/* Step 2: Approval */}
      {currentStep === 1 && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Approval Details</CardTitle>
              <CardDescription>
                Provide approval details for the correction
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div>
                  <Label htmlFor="resolution-notes" className="text-sm font-medium">
                    Resolution Notes <span className="text-[rgb(var(--color-destructive-500))]">*</span>
                  </Label>
                  <TextArea
                    id="resolution-notes"
                    value={approval.notes}
                    onChange={handleNotesChange}
                    placeholder="Explain the reason for this correction..."
                    className="w-full mt-1"
                    rows={4}
                  />
                  <p className="text-xs text-[rgb(var(--color-text-500))] mt-1">
                    Please provide detailed notes explaining the reason for this correction.
                  </p>
                </div>
                
                {requiresFourEyes && (
                  <div className="border p-4 rounded-md bg-[rgb(var(--color-accent-50))]">
                    <div className="flex items-start space-x-2 mb-4">
                      <AlertTriangle className="h-5 w-5 text-[rgb(var(--color-accent-700))] mt-0.5" />
                      <div>
                        <h4 className="font-medium text-[rgb(var(--color-accent-900))]">Four-Eyes Approval Required</h4>
                        <p className="text-sm text-[rgb(var(--color-accent-700))]">
                          This correction exceeds {formatCurrency(FOUR_EYES_THRESHOLD)} and requires secondary approval.
                        </p>
                      </div>
                    </div>
                    
                    {!approval.secondaryApprovalSent ? (
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="secondary-approver-name" className="text-sm font-medium">
                            Secondary Approver Name <span className="text-[rgb(var(--color-destructive-500))]">*</span>
                          </Label>
                          <Input
                            id="secondary-approver-name"
                            value={approval.secondaryApproverName}
                            onChange={handleSecondaryApproverNameChange}
                            className="mt-1"
                          />
                        </div>
                        
                        <div>
                          <Label htmlFor="secondary-approver-email" className="text-sm font-medium">
                            Secondary Approver Email <span className="text-[rgb(var(--color-destructive-500))]">*</span>
                          </Label>
                          <Input
                            id="secondary-approver-email"
                            type="email"
                            value={approval.secondaryApproverEmail}
                            onChange={handleSecondaryApproverEmailChange}
                            className="mt-1"
                          />
                        </div>
                        
                        <Button
                          id="send-approval-request-button"
                          onClick={handleSendSecondaryApproval}
                          disabled={!approval.secondaryApproverName || !approval.secondaryApproverEmail}
                        >
                          Send Approval Request
                        </Button>
                      </div>
                    ) : !approval.secondaryApprovalVerified ? (
                      <div className="space-y-4">
                        <Alert>
                          <Info className="h-4 w-4" />
                          <div className="font-semibold">Approval Request Sent</div>
                          <AlertDescription>
                            An approval request has been sent to {approval.secondaryApproverEmail}.
                          </AlertDescription>
                        </Alert>
                        
                        <div>
                          <Label htmlFor="verification-code" className="text-sm font-medium">
                            Verification Code <span className="text-[rgb(var(--color-destructive-500))]">*</span>
                          </Label>
                          <div className="flex space-x-2 mt-1">
                            <Input
                              id="verification-code"
                              value={approval.secondaryApprovalCode}
                              onChange={handleVerificationCodeChange}
                              maxLength={6}
                              className="flex-1"
                            />
                            <Button
                              id="verify-code-button"
                              onClick={handleVerifyCode}
                              disabled={approval.secondaryApprovalCode.length !== 6}
                            >
                              Verify
                            </Button>
                          </div>
                          <p className="text-xs text-[rgb(var(--color-text-500))] mt-1">
                            Enter the 6-digit verification code sent to the secondary approver.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <Alert className="bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-900))] border-[rgb(var(--color-primary-200))]">
                        <CheckCircle className="h-4 w-4 text-[rgb(var(--color-primary-600))]" />
                        <div className="font-semibold">Secondary Approval Verified</div>
                        <AlertDescription className="text-[rgb(var(--color-primary-800))]">
                          The secondary approval has been verified by {approval.secondaryApproverName}.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}
                
                <div className="bg-[rgb(var(--color-background-100))] p-4 rounded-md">
                  <h4 className="font-medium mb-2">Correction Summary</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="text-[rgb(var(--color-text-500))]">Resolution Type:</div>
                    <div className="font-medium">
                      {resolutionType === 'recommended' ? 'Recommended Fix' :
                       resolutionType === 'custom' ? 'Custom Correction' :
                       'No Action Required'}
                    </div>
                    
                    {resolutionType !== 'no_action' && (
                      <>
                        <div className="text-[rgb(var(--color-text-500))]">Correction Amount:</div>
                        <div className="font-medium">{formatCurrency(getCorrectionAmount())}</div>
                        
                        <div className="text-[rgb(var(--color-text-500))]">Current Balance:</div>
                        <div className="font-medium">{formatCurrency(report.actual_balance)}</div>
                        
                        <div className="text-[rgb(var(--color-text-500))]">New Balance:</div>
                        <div className="font-medium">{formatCurrency(getNewBalance())}</div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button id="back-button" variant="outline" onClick={handlePreviousStep}>
                Back
              </Button>
              <Button
                id="next-button"
                onClick={handleNextStep}
                disabled={!approval.notes || (!!requiresFourEyes && !approval.secondaryApprovalVerified)}
              >
                Next
              </Button>
            </CardFooter>
          </Card>
          
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <div className="font-semibold">Error</div>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
      )}
      
      {/* Step 3: Confirmation */}
      {currentStep === 2 && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Confirm Resolution</CardTitle>
              <CardDescription>
                Review and confirm the correction details
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <Alert className="bg-[rgb(var(--color-accent-50))] text-[rgb(var(--color-accent-900))] border-[rgb(var(--color-accent-200))]">
                  <AlertTriangle className="h-4 w-4 text-[rgb(var(--color-accent-600))]" />
                  <div className="font-semibold">Important</div>
                  <AlertDescription className="text-[rgb(var(--color-accent-800))]">
                    Please review the correction details carefully before confirming. This action cannot be undone.
                  </AlertDescription>
                </Alert>
                
                <div className="bg-[rgb(var(--color-background-100))] p-4 rounded-md">
                  <h4 className="font-medium mb-4">Resolution Details</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-[rgb(var(--color-text-500))]">Client</p>
                      <p className="font-medium">{client?.name || report.client_id}</p>
                    </div>
                    <div>
                      <p className="text-[rgb(var(--color-text-500))]">Report ID</p>
                      <p className="font-medium font-mono">{report.report_id}</p>
                    </div>
                    <div>
                      <p className="text-[rgb(var(--color-text-500))]">Resolution Type</p>
                      <p className="font-medium">
                        {resolutionType === 'recommended' ? 'Recommended Fix' :
                         resolutionType === 'custom' ? 'Custom Correction' :
                         'No Action Required'}
                      </p>
                    </div>
                    {resolutionType !== 'no_action' && (
                      <div>
                        <p className="text-[rgb(var(--color-text-500))]">Correction Amount</p>
                        <p className="font-medium">{formatCurrency(getCorrectionAmount())}</p>
                      </div>
                    )}
                    <div className="col-span-2">
                      <p className="text-[rgb(var(--color-text-500))]">Resolution Notes</p>
                      <p className="font-medium">{approval.notes}</p>
                    </div>
                  </div>
                </div>
                
                {resolutionType !== 'no_action' && (
                  <div className="bg-[rgb(var(--color-background-100))] p-4 rounded-md">
                    <h4 className="font-medium mb-4">Impact Summary</h4>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="p-3 bg-[rgb(var(--color-accent-50))] rounded-md text-center">
                        <p className="text-xs text-[rgb(var(--color-text-500))]">Current Balance</p>
                        <p className="text-lg font-bold">{formatCurrency(report.actual_balance)}</p>
                      </div>
                      <div className="p-3 bg-[rgb(var(--color-secondary-50))] rounded-md text-center flex items-center justify-center">
                        <span className="text-lg">→</span>
                      </div>
                      <div className="p-3 bg-[rgb(var(--color-primary-50))] rounded-md text-center">
                        <p className="text-xs text-[rgb(var(--color-text-500))]">New Balance</p>
                        <p className="text-lg font-bold">{formatCurrency(getNewBalance())}</p>
                      </div>
                    </div>
                  </div>
                )}
                
                {requiresFourEyes && approval.secondaryApprovalVerified && (
                  <div className="bg-[rgb(var(--color-primary-50))] p-4 rounded-md">
                    <div className="flex items-start space-x-2">
                      <CheckCircle className="h-5 w-5 text-[rgb(var(--color-primary-600))] mt-0.5" />
                      <div>
                        <h4 className="font-medium text-[rgb(var(--color-primary-900))]">Secondary Approval Verified</h4>
                        <p className="text-sm text-[rgb(var(--color-primary-700))]">
                          This correction has been approved by {approval.secondaryApproverName} ({approval.secondaryApproverEmail}).
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button id="back-button" variant="outline" onClick={handlePreviousStep}>
                Back
              </Button>
              <Button
                id="confirm-button"
                onClick={handleSubmitResolution}
                disabled={isProcessing}
              >
                {isProcessing ? 'Processing...' : 'Confirm Resolution'}
              </Button>
            </CardFooter>
          </Card>
          
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <div className="font-semibold">Error</div>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
      )}
      
      {/* Confirmation Dialog */}
      <Dialog
        isOpen={!!isConfirmationDialogOpen}
        onClose={() => setIsConfirmationDialogOpen(false)}
        title="Resolution Complete"
      >
        <DialogContent>
          <DialogDescription>
            The credit discrepancy has been successfully resolved.
          </DialogDescription>
          
          <div className="py-4">
            <div className="flex items-center justify-center mb-4">
              <div className="bg-[rgb(var(--color-primary-100))] p-3 rounded-full">
                <CheckCircle className="h-8 w-8 text-[rgb(var(--color-primary-600))]" />
              </div>
            </div>
            
            <div className="text-center mb-4">
              <p className="text-lg font-medium">Thank you!</p>
              <p className="text-sm text-[rgb(var(--color-text-500))]">
                The credit discrepancy has been resolved and all records have been updated.
              </p>
            </div>
            
            {resolutionType !== 'no_action' && (
              <div className="bg-[rgb(var(--color-background-100))] p-4 rounded-md mb-4">
                <h4 className="font-medium mb-2 text-center">Resolution Summary</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="text-[rgb(var(--color-text-500))]">Previous Balance:</div>
                  <div className="font-medium text-right">{formatCurrency(report.actual_balance)}</div>
                  
                  <div className="text-[rgb(var(--color-text-500))]">Correction Amount:</div>
                  <div className="font-medium text-right">{formatCurrency(getCorrectionAmount())}</div>
                  
                  <div className="text-[rgb(var(--color-text-500))]">New Balance:</div>
                  <div className="font-medium text-right">{formatCurrency(getNewBalance())}</div>
                </div>
              </div>
            )}
          </div>
          
          <DialogFooter>
            <Button id="close-confirmation-button" onClick={handleCloseConfirmation}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ReconciliationResolution;
