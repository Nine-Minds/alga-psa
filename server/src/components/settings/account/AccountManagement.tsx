'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { Badge } from 'server/src/components/ui/Badge';
import { toast } from 'react-hot-toast';
import { IdCardIcon, PersonIcon, RocketIcon } from '@radix-ui/react-icons';
import { getLicenseUsageAction } from 'server/src/lib/actions/license-actions';
import { LicenseUsage } from 'server/src/lib/license/get-license-usage';

// Placeholder data - will be replaced with actual API calls later
interface LicenseInfo {
  total_licenses: number | null;
  active_licenses: number;
  available_licenses: number | null;
  plan_name: string;
  price_per_license: number;
}

interface PaymentInfo {
  card_brand: string;
  card_last4: string;
  card_exp_month: number;
  card_exp_year: number;
  billing_email: string;
}

interface SubscriptionInfo {
  status: string;
  current_period_start: string;
  current_period_end: string;
  next_billing_date: string;
  monthly_amount: number;
}

export default function AccountManagement() {
  const [loading, setLoading] = useState(true);
  const [licenseInfo, setLicenseInfo] = useState<LicenseInfo | null>(null);
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);
  const [subscriptionInfo, setSubscriptionInfo] = useState<SubscriptionInfo | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        setLoading(true);

        // Fetch real license usage data
        const licenseResult = await getLicenseUsageAction();
        if (licenseResult.success && licenseResult.data) {
          const usage = licenseResult.data;
          setLicenseInfo({
            total_licenses: usage.limit,
            active_licenses: usage.used,
            available_licenses: usage.remaining,
            plan_name: 'Professional', // TODO: Get from tenant settings
            price_per_license: 49.99 // TODO: Get from subscription info
          });
        }

        // TODO: Replace with actual API calls for payment and subscription
        setPaymentInfo({
          card_brand: 'Visa',
          card_last4: '4242',
          card_exp_month: 12,
          card_exp_year: 2025,
          billing_email: 'billing@company.com'
        });

        setSubscriptionInfo({
          status: 'active',
          current_period_start: '2024-10-01',
          current_period_end: '2024-11-01',
          next_billing_date: '2024-11-01',
          monthly_amount: 1249.75
        });

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
    // TODO: Implement license purchase flow
    toast.success('License purchase flow - Coming soon!');
  };

  const handleUpdatePaymentMethod = () => {
    // TODO: Implement payment method update flow
    toast.success('Update payment method - Coming soon!');
  };

  const handleCancelSubscription = () => {
    // TODO: Implement cancellation flow with confirmation
    toast.error('Cancel subscription flow - Coming soon!');
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
            <PersonIcon className="h-5 w-5" />
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
              <Badge variant="default" className="text-sm">
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

          {/* Actions */}
          <div className="flex space-x-2 pt-4">
            <Button id="buy-more-licenses-btn" onClick={handleBuyMoreLicenses}>
              <RocketIcon className="mr-2 h-4 w-4" />
              Buy More Licenses
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Payment Information Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <IdCardIcon className="h-5 w-5" />
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
                  <IdCardIcon className="h-6 w-6" />
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
              <Badge variant={subscriptionInfo?.status === 'active' ? 'default' : 'secondary'}>
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
            <div className="space-y-2 text-sm">
              <div className="flex justify-between items-center py-2 border-b">
                <div>
                  <p className="font-medium">October 2024</p>
                  <p className="text-xs text-muted-foreground">Paid on Oct 1, 2024</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">${subscriptionInfo?.monthly_amount?.toFixed(2)}</p>
                  <Button id="view-invoice-oct-2024" variant="link" size="sm" className="h-auto p-0 text-xs">
                    View Invoice
                  </Button>
                </div>
              </div>
              <div className="flex justify-between items-center py-2 border-b">
                <div>
                  <p className="font-medium">September 2024</p>
                  <p className="text-xs text-muted-foreground">Paid on Sep 1, 2024</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">${subscriptionInfo?.monthly_amount?.toFixed(2)}</p>
                  <Button id="view-invoice-sep-2024" variant="link" size="sm" className="h-auto p-0 text-xs">
                    View Invoice
                  </Button>
                </div>
              </div>
            </div>
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
    </div>
  );
}
