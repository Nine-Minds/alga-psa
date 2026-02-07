'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { toast } from 'react-hot-toast';
import { CreditCard, User, Rocket, MinusCircle, Info, ChevronDown, ChevronUp, DollarSign, Calendar, CheckCircle } from 'lucide-react';
import {
  getLicenseUsageAction,
  getLicensePricingAction,
  getSubscriptionInfoAction,
  getPaymentMethodInfoAction,
  getRecentInvoicesAction,
  createCustomerPortalSessionAction,
  cancelSubscriptionAction,
  getScheduledLicenseChangesAction,
  sendCancellationFeedbackAction,
} from 'ee/server/src/lib/actions/license-actions';
import { checkAccountManagementPermission } from '@alga-psa/auth/actions';
import { useRouter } from 'next/navigation';
import { ILicenseInfo, IPaymentMethod, ISubscriptionInfo, IInvoiceInfo, IScheduledLicenseChange } from 'server/src/interfaces/subscription.interfaces';
import ReduceLicensesModal from '@ee/components/licensing/ReduceLicensesModal';
import CancellationFeedbackModal from './CancellationFeedbackModal';
import { signOut } from 'next-auth/react';

export default function AccountManagement() {
  const [loading, setLoading] = useState(true);
  const [licenseInfo, setLicenseInfo] = useState<ILicenseInfo | null>(null);
  const [paymentInfo, setPaymentInfo] = useState<IPaymentMethod | null>(null);
  const [subscriptionInfo, setSubscriptionInfo] = useState<ISubscriptionInfo | null>(null);
  const [invoices, setInvoices] = useState<IInvoiceInfo[]>([]);
  const [canManageAccount, setCanManageAccount] = useState<boolean>(false);
  const [showReduceModal, setShowReduceModal] = useState(false);
  const [showCancellationFeedback, setShowCancellationFeedback] = useState(false);
  const [scheduledChanges, setScheduledChanges] = useState<IScheduledLicenseChange | null>(null);

  // Collapsible sections state
  const [expandedSections, setExpandedSections] = useState({
    licenseDetails: true,
    paymentInfo: true,
    subscriptionDetails: true,
    invoices: true,
  });

  const router = useRouter();

  const formatDate = (value?: string | Date | null) => {
    if (!value) return 'N/A';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleDateString();
  };

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  useEffect(() => {
    const init = async () => {
      try {
        setLoading(true);

        // Check permission first
        const hasPermission = await checkAccountManagementPermission();
        setCanManageAccount(hasPermission);

        if (!hasPermission) {
          toast.error('You do not have permission to access Account Management');
          router.push('/msp');
          return;
        }

        // Fetch license usage, pricing, subscription, payment, invoices, and scheduled changes in parallel
        const [licenseResult, pricingResult, subscriptionResult, paymentResult, invoicesResult, scheduledChangesResult] = await Promise.all([
          getLicenseUsageAction(),
          getLicensePricingAction(),
          getSubscriptionInfoAction(),
          getPaymentMethodInfoAction(),
          getRecentInvoicesAction(5),
          getScheduledLicenseChangesAction(),
        ]);

        // Set license info with pricing
        if (licenseResult.success && licenseResult.data && pricingResult.success && pricingResult.data) {
          const usage = licenseResult.data;
          const pricing = pricingResult.data;

          setLicenseInfo({
            total_licenses: usage.limit,
            active_licenses: usage.used,
            available_licenses: usage.remaining,
            plan_name: 'Professional', // Could fetch from tenant settings if needed
            price_per_license: pricing.unitAmount / 100, // Convert cents to dollars
          });
        }

        // Set subscription info
        if (subscriptionResult.success && subscriptionResult.data) {
          setSubscriptionInfo(subscriptionResult.data);
        }

        // Set payment info
        if (paymentResult.success && paymentResult.data) {
          setPaymentInfo(paymentResult.data);
        }

        // Set invoices
        if (invoicesResult.success && invoicesResult.data) {
          setInvoices(invoicesResult.data);
        }

        // Set scheduled changes
        if (scheduledChangesResult.success && scheduledChangesResult.data) {
          setScheduledChanges(scheduledChangesResult.data);
        }

      } catch (err) {
        console.error('Error loading account info:', err);
        toast.error('Failed to load account information');
      } finally {
        setLoading(false);
      }
    };

    init();
  }, []);

  const handleBuyMoreLicenses = () => {
    window.location.href = '/msp/licenses/purchase';
  };

  const handleUpdatePaymentMethod = async () => {
    if (!canManageAccount) {
      toast.error('You do not have permission to update payment methods');
      return;
    }

    try {
      const result = await createCustomerPortalSessionAction();
      if (result.success && result.data?.portal_url) {
        // Open Stripe Customer Portal in new tab
        window.open(result.data.portal_url, '_blank', 'noopener,noreferrer');
      } else {
        toast.error(result.error || 'Failed to open payment portal');
      }
    } catch (error) {
      console.error('Error opening payment portal:', error);
      toast.error('Failed to update payment method');
    }
  };

  const handleCancelSubscription = () => {
    if (!canManageAccount) {
      toast.error('You do not have permission to cancel subscription');
      return;
    }

    // Open feedback modal instead of window.confirm
    setShowCancellationFeedback(true);
  };

  const handleConfirmCancellation = async (reasonText: string, reasonCategory?: string) => {
    try {
      // Send feedback email
      const feedbackResult = await sendCancellationFeedbackAction(reasonText, reasonCategory);
      if (!feedbackResult.success) {
        toast.error(feedbackResult.error || 'Failed to send feedback');
        return;
      }

      // Actually cancel the subscription
      const cancelResult = await cancelSubscriptionAction();
      if (!cancelResult.success) {
        toast.error(cancelResult.error || 'Failed to cancel subscription');
        return;
      }

      // Success - the modal will show the toast and then log the user out
    } catch (error) {
      console.error('Error submitting cancellation feedback:', error);
      throw error; // Re-throw to let modal handle the error
    }
  };

  const handleLogout = async () => {
    await signOut({ callbackUrl: '/auth/msp/login' });
  };

  const handleReduceLicenses = () => {
    if (!canManageAccount) {
      toast.error('You do not have permission to manage licenses');
      return;
    }

    setShowReduceModal(true);
  };

  const handleReduceSuccess = async () => {
    // Refresh license info and scheduled changes after successful removal
    try {
      const [licenseResult, pricingResult, scheduledChangesResult] = await Promise.all([
        getLicenseUsageAction(),
        getLicensePricingAction(),
        getScheduledLicenseChangesAction(),
      ]);

      if (licenseResult.success && licenseResult.data && pricingResult.success && pricingResult.data) {
        const usage = licenseResult.data;
        const pricing = pricingResult.data;

        setLicenseInfo({
          total_licenses: usage.limit,
          active_licenses: usage.used,
          available_licenses: usage.remaining,
          plan_name: 'Professional',
          price_per_license: pricing.unitAmount / 100,
        });
      }

      if (scheduledChangesResult.success && scheduledChangesResult.data) {
        setScheduledChanges(scheduledChangesResult.data);
      }
    } catch (error) {
      console.error('Error refreshing license info:', error);
    }
  };

  if (loading) {
    return (
      <Card className="p-6">
        <div>Loading account information...</div>
      </Card>
    );
  }

  const monthlyTotal = licenseInfo?.total_licenses !== null
    ? ((licenseInfo?.total_licenses || 0) * (licenseInfo?.price_per_license || 0))
    : 0;

  return (
    <div className="space-y-6">
      {/* Summary Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Licenses Used Card */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <User className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-2xl font-bold">
              {licenseInfo?.active_licenses}/{licenseInfo?.total_licenses ?? '∞'}
            </p>
            <p className="text-sm text-muted-foreground">Licenses Used</p>
          </div>
        </Card>

        {/* Monthly Cost Card */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <DollarSign className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-2xl font-bold">${monthlyTotal.toFixed(2)}</p>
            <p className="text-sm text-muted-foreground">Per Month</p>
          </div>
        </Card>

        {/* Status Card */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-2xl font-bold capitalize">{subscriptionInfo?.status || 'Unknown'}</p>
            <p className="text-sm text-muted-foreground">Status</p>
          </div>
        </Card>

        {/* Next Billing Card */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <Calendar className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-2xl font-bold">
              {subscriptionInfo?.next_billing_date
                ? new Date(subscriptionInfo.next_billing_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : 'N/A'}
            </p>
            <p className="text-sm text-muted-foreground">Next Billing</p>
          </div>
        </Card>
      </div>

      {/* Scheduled License Changes Alert */}
      {scheduledChanges && (
        <Alert className="bg-blue-50 border-blue-200">
          <Info className="h-4 w-4 text-blue-600" />
          <AlertDescription>
            <p className="font-semibold mb-2 text-blue-900">
              Scheduled License Change
            </p>
            <p className="text-sm mb-2 text-blue-800">
              Your license count will change from <strong>{scheduledChanges.current_quantity}</strong> to{' '}
              <strong>{scheduledChanges.scheduled_quantity}</strong> on{' '}
              <strong>{new Date(scheduledChanges.effective_date).toLocaleDateString()}</strong>.
            </p>
            <div className="text-sm space-y-1 text-blue-800">
              <div className="flex justify-between">
                <span>Current monthly cost:</span>
                <span className="font-medium">${scheduledChanges.current_monthly_cost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>New monthly cost:</span>
                <span className="font-medium text-blue-600">
                  ${scheduledChanges.scheduled_monthly_cost.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between pt-1 border-t border-blue-200">
                <span className="font-semibold">Monthly savings:</span>
                <span className="font-semibold text-blue-600">
                  ${scheduledChanges.monthly_savings.toFixed(2)}
                </span>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Primary Actions */}
      <div className="flex space-x-2">
        <Button id="buy-more-licenses-btn" onClick={handleBuyMoreLicenses}>
          <Rocket className="mr-2 h-4 w-4" />
          Add Licenses
        </Button>
        <Button
          id="reduce-licenses-btn"
          variant="outline"
          onClick={handleReduceLicenses}
        >
          <MinusCircle className="mr-2 h-4 w-4" />
          Remove Licenses
        </Button>
      </div>

      {/* Collapsible License Details Section */}
      <Card>
        <CardHeader
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => toggleSection('licenseDetails')}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <User className="h-5 w-5" />
              <CardTitle>License Details</CardTitle>
            </div>
            {expandedSections.licenseDetails ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </CardHeader>
        {expandedSections.licenseDetails && (
          <CardContent className="space-y-4">
          {/* Current Plan */}
          <div className="rounded-lg border p-4 bg-muted/50">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold">Current Plan</h3>
                <p className="text-sm text-muted-foreground">
                  {licenseInfo?.plan_name} Plan
                </p>
              </div>
              <Badge className="bg-green-100 text-green-800">
                Active
              </Badge>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label className="text-sm text-muted-foreground">Total Licenses</Label>
                <p className="text-2xl font-bold">{licenseInfo?.total_licenses ?? 'Unlimited'}</p>
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Active Users</Label>
                <p className="text-2xl font-bold text-green-600">{licenseInfo?.active_licenses}</p>
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Available</Label>
                <p className="text-2xl font-bold text-blue-600">{licenseInfo?.available_licenses ?? 'Unlimited'}</p>
              </div>
            </div>
          </div>

          {/* Pricing Info */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label>Price per License</Label>
              <span className="font-semibold">${licenseInfo?.price_per_license?.toFixed(2)}/month</span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t">
              <Label className="font-semibold">Current Monthly Total</Label>
              <span className="text-xl font-bold">
                {licenseInfo?.total_licenses !== null
                  ? `$${((licenseInfo?.total_licenses || 0) * (licenseInfo?.price_per_license || 0)).toFixed(2)}`
                  : 'Contact Sales'
                }
              </span>
            </div>
          </div>
          </CardContent>
        )}
      </Card>

      {/* Payment Information Section */}
      <Card>
        <CardHeader
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => toggleSection('paymentInfo')}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <CreditCard className="h-5 w-5" />
              <CardTitle>Payment Information</CardTitle>
            </div>
            {expandedSections.paymentInfo ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </CardHeader>
        {expandedSections.paymentInfo && (
          <CardContent className="space-y-6">
          {/* Current Payment Method */}
          <div className="rounded-lg border p-4">
            <h3 className="text-sm font-semibold mb-4">Current Payment Method</h3>

            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-4">
                <div className="h-12 w-16 rounded border flex items-center justify-center bg-muted">
                  <CreditCard className="h-6 w-6" />
                </div>
                <div>
                  <p className="font-semibold">
                    {paymentInfo?.card_brand} •••• {paymentInfo?.card_last4}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Expires {paymentInfo?.card_exp_month}/{paymentInfo?.card_exp_year}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <Label>Billing Email</Label>
                <span className="text-sm">{paymentInfo?.billing_email}</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex space-x-2">
            <Button id="update-payment-method-btn" onClick={handleUpdatePaymentMethod}>
              Update Payment Method
            </Button>
          </div>
          </CardContent>
        )}
      </Card>

      {/* Subscription Details Section */}
      <Card>
        <CardHeader
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => toggleSection('subscriptionDetails')}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Calendar className="h-5 w-5" />
              <CardTitle>Subscription Details</CardTitle>
            </div>
            {expandedSections.subscriptionDetails ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </CardHeader>
        {expandedSections.subscriptionDetails && (
          <CardContent className="space-y-6">
          {/* Subscription Status */}
          <div className="rounded-lg border p-4 bg-muted/50">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Subscription Status</h3>
              <Badge className={subscriptionInfo?.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
                {subscriptionInfo?.status ? subscriptionInfo.status.charAt(0).toUpperCase() + subscriptionInfo.status.slice(1) : 'Unknown'}
              </Badge>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between">
                <Label className="text-muted-foreground">Current Period</Label>
                <span className="text-sm font-medium">
                  {subscriptionInfo?.current_period_start && subscriptionInfo?.current_period_end
                    ? `${formatDate(subscriptionInfo.current_period_start)} - ${formatDate(subscriptionInfo.current_period_end)}`
                    : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between">
                <Label className="text-muted-foreground">Next Billing Date</Label>
                <span className="text-sm font-medium">
                  {formatDate(subscriptionInfo?.next_billing_date)}
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t">
                <Label className="font-semibold">Monthly Amount</Label>
                <span className="text-lg font-bold">
                  {typeof subscriptionInfo?.monthly_amount === 'number'
                    ? `$${subscriptionInfo.monthly_amount.toFixed(2)}`
                    : 'N/A'}
                </span>
              </div>
            </div>
          </div>
          </CardContent>
        )}
      </Card>

      {/* Recent Invoices Section */}
      <Card>
        <CardHeader
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => toggleSection('invoices')}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <CreditCard className="h-5 w-5" />
              <CardTitle>Recent Invoices</CardTitle>
            </div>
            {expandedSections.invoices ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </CardHeader>
        {expandedSections.invoices && (
          <CardContent>
            {invoices.length > 0 ? (
              <div className="space-y-2 text-sm">
                {invoices.map((invoice) => (
                  <div key={invoice.invoice_id} className="flex justify-between items-center py-3 border-b last:border-b-0">
                    <div>
                      <p className="font-medium">{invoice.period_label}</p>
                      <p className="text-xs text-muted-foreground">
                        {invoice.paid_at
                          ? `Paid on ${new Date(invoice.paid_at).toLocaleDateString()}`
                          : `Status: ${invoice.status}`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">${invoice.amount.toFixed(2)}</p>
                      {invoice.invoice_pdf_url && (
                        <Button
                          id={`view-invoice-${invoice.invoice_id}`}
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-xs"
                          onClick={() => window.open(invoice.invoice_pdf_url!, '_blank')}
                        >
                          View PDF
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No invoices found</p>
            )}
          </CardContent>
        )}
      </Card>

      {/* Danger Zone */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Canceling your subscription will disable access for all users at the end of the current billing period.
          </p>
          <Button id="cancel-subscription-btn" variant="destructive" onClick={handleCancelSubscription}>
            Cancel Subscription
          </Button>
        </CardContent>
      </Card>

      {/* Reduce Licenses Modal */}
      <ReduceLicensesModal
        isOpen={showReduceModal}
        onClose={() => setShowReduceModal(false)}
        currentLicenseCount={licenseInfo?.total_licenses || 0}
        activeUserCount={licenseInfo?.active_licenses || 0}
        onSuccess={handleReduceSuccess}
      />

      {/* Cancellation Feedback Modal */}
      <CancellationFeedbackModal
        isOpen={showCancellationFeedback}
        onClose={() => setShowCancellationFeedback(false)}
        onConfirm={handleConfirmCancellation}
        onLogout={handleLogout}
      />
    </div>
  );
}
