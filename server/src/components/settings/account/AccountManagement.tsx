'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { Badge } from 'server/src/components/ui/Badge';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { toast } from 'react-hot-toast';
import { CreditCard, User, Rocket, MinusCircle, Info } from 'lucide-react';
import {
  getLicenseUsageAction,
  getLicensePricingAction,
  getSubscriptionInfoAction,
  getPaymentMethodInfoAction,
  getRecentInvoicesAction,
  createCustomerPortalSessionAction,
  cancelSubscriptionAction,
  getScheduledLicenseChangesAction,
} from 'server/src/lib/actions/license-actions';
import { checkAccountManagementPermission } from 'server/src/lib/actions/permission-actions';
import { useRouter } from 'next/navigation';
import { ILicenseInfo, IPaymentMethod, ISubscriptionInfo, IInvoiceInfo, IScheduledLicenseChange } from 'server/src/interfaces/subscription.interfaces';
import ReduceLicensesModal from 'server/src/components/licensing/ReduceLicensesModal';

export default function AccountManagement() {
  const [loading, setLoading] = useState(true);
  const [licenseInfo, setLicenseInfo] = useState<ILicenseInfo | null>(null);
  const [paymentInfo, setPaymentInfo] = useState<IPaymentMethod | null>(null);
  const [subscriptionInfo, setSubscriptionInfo] = useState<ISubscriptionInfo | null>(null);
  const [invoices, setInvoices] = useState<IInvoiceInfo[]>([]);
  const [canManageAccount, setCanManageAccount] = useState<boolean>(false);
  const [showReduceModal, setShowReduceModal] = useState(false);
  const [scheduledChanges, setScheduledChanges] = useState<IScheduledLicenseChange | null>(null);
  const router = useRouter();

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

  const handleCancelSubscription = async () => {
    if (!canManageAccount) {
      toast.error('You do not have permission to cancel subscription');
      return;
    }

    // Confirm cancellation
    const confirmed = window.confirm(
      'Are you sure you want to cancel your subscription? Access will continue until the end of the current billing period.'
    );

    if (!confirmed) {
      return;
    }

    try {
      const result = await cancelSubscriptionAction();
      if (result.success) {
        toast.success('Subscription will be cancelled at the end of the billing period');
        // Refresh subscription info
        const subscriptionResult = await getSubscriptionInfoAction();
        if (subscriptionResult.success && subscriptionResult.data) {
          setSubscriptionInfo(subscriptionResult.data);
        }
      } else {
        toast.error(result.error || 'Failed to cancel subscription');
      }
    } catch (error) {
      console.error('Error canceling subscription:', error);
      toast.error('Failed to cancel subscription');
    }
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

  return (
    <div className="space-y-6">
      {/* License Management Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <User className="h-5 w-5" />
            <CardTitle>License Management</CardTitle>
          </div>
          <CardDescription>
            Manage your user licenses and plan details
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
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

          {/* Scheduled License Changes Alert */}
          {scheduledChanges && (
            <Alert
              className="border"
              style={{
                backgroundColor: 'rgba(var(--color-secondary-600), 0.08)',
                borderColor: 'rgba(var(--color-secondary-600), 0.3)'
              }}
            >
              <Info
                className="h-4 w-4"
                style={{ color: 'rgb(var(--color-secondary-600))' }}
              />
              <AlertDescription>
                <p
                  className="font-semibold mb-2"
                  style={{ color: 'rgb(var(--color-secondary-600))' }}
                >
                  Scheduled License Change
                </p>
                <p
                  className="text-sm mb-2"
                  style={{ color: 'rgb(var(--color-secondary-600))' }}
                >
                  Your license count will change from <strong>{scheduledChanges.current_quantity}</strong> to{' '}
                  <strong>{scheduledChanges.scheduled_quantity}</strong> on{' '}
                  <strong>{new Date(scheduledChanges.effective_date).toLocaleDateString()}</strong>.
                </p>
                <div
                  className="text-sm space-y-1"
                  style={{ color: 'rgb(var(--color-secondary-600))' }}
                >
                  <div className="flex justify-between">
                    <span>Current monthly cost:</span>
                    <span className="font-medium">${scheduledChanges.current_monthly_cost.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>New monthly cost:</span>
                    <span
                      className="font-medium"
                      style={{ color: 'rgb(var(--color-secondary-600))' }}
                    >
                      ${scheduledChanges.scheduled_monthly_cost.toFixed(2)}
                    </span>
                  </div>
                  <div
                    className="flex justify-between pt-1 border-t"
                    style={{ borderColor: 'rgba(var(--color-secondary-600), 0.3)' }}
                  >
                    <span className="font-semibold">Monthly savings:</span>
                    <span
                      className="font-semibold"
                      style={{ color: 'rgb(var(--color-secondary-600))' }}
                    >
                      ${scheduledChanges.monthly_savings.toFixed(2)}
                    </span>
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Actions */}
          <div className="flex space-x-2 pt-4">
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
        </CardContent>
      </Card>

      {/* Payment Information Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <CreditCard className="h-5 w-5" />
            <CardTitle>Payment Information</CardTitle>
          </div>
          <CardDescription>
            Manage your payment methods and billing details
          </CardDescription>
        </CardHeader>
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
      </Card>

      {/* Subscription Management Section */}
      <Card>
        <CardHeader>
          <CardTitle>Subscription Management</CardTitle>
          <CardDescription>
            View and manage your subscription details
          </CardDescription>
        </CardHeader>
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
                  {new Date(subscriptionInfo?.current_period_start || '').toLocaleDateString()} - {' '}
                  {new Date(subscriptionInfo?.current_period_end || '').toLocaleDateString()}
                </span>
              </div>
              <div className="flex justify-between">
                <Label className="text-muted-foreground">Next Billing Date</Label>
                <span className="text-sm font-medium">
                  {new Date(subscriptionInfo?.next_billing_date || '').toLocaleDateString()}
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t">
                <Label className="font-semibold">Monthly Amount</Label>
                <span className="text-lg font-bold">
                  ${subscriptionInfo?.monthly_amount?.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* Billing History */}
          <div className="rounded-lg border p-4">
            <h3 className="text-sm font-semibold mb-3">Recent Invoices</h3>
            {invoices.length > 0 ? (
              <div className="space-y-2 text-sm">
                {invoices.map((invoice) => (
                  <div key={invoice.invoice_id} className="flex justify-between items-center py-2 border-b last:border-b-0">
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
                          View Invoice
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No invoices found</p>
            )}
          </div>

          {/* Danger Zone */}
          <div className="rounded-lg border border-destructive/50 p-4">
            <h3 className="text-sm font-semibold text-destructive mb-2">Danger Zone</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Canceling your subscription will disable access for all users at the end of the current billing period.
            </p>
            <Button id="cancel-subscription-btn" variant="destructive" onClick={handleCancelSubscription}>
              Cancel Subscription
            </Button>
          </div>
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
    </div>
  );
}
