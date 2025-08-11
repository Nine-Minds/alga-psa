'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from 'server/src/components/ui/Card';
import { Table } from 'server/src/components/ui/Table';
// import { Button } from 'server/src/components/ui/Button';
// import { toast } from 'react-hot-toast';

import { getClientCompany } from 'server/src/lib/actions/client-portal-actions/client-company';
import { getClientBillingPlan, getClientInvoices } from 'server/src/lib/actions/client-portal-actions/client-billing';

import type { ICompany } from 'server/src/interfaces/company.interfaces';
import type { ICompanyBillingPlan } from 'server/src/interfaces/billing.interfaces';
import type { InvoiceViewModel } from 'server/src/interfaces/invoice.interfaces';

export default function ClientAccount() {
  const [isLoading, setIsLoading] = useState(true);
  const [company, setCompany] = useState<ICompany | null>(null);
  const [billingPlan, setBillingPlan] = useState<ICompanyBillingPlan | null>(null);
  const [invoices, setInvoices] = useState<InvoiceViewModel[]>([]);
  const [hasInvoiceAccess, setHasInvoiceAccess] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const formatCurrency = useCallback((amount: number | string | null | undefined) => {
    try {
      const n = typeof amount === 'string' ? Number(amount) : (amount ?? 0);
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n as number);
    } catch {
      return '$0.00';
    }
  }, []);

  const formatDate = useCallback((date: any) => {
    if (!date) return 'N/A';
    try {
      const d = new Date(typeof date === 'string' ? date : date.toString());
      return d.toLocaleDateString();
    } catch {
      return 'N/A';
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [companyData, plan] = await Promise.all([
          getClientCompany(),
          getClientBillingPlan(),
        ]);

        if (!mounted) return;
        setCompany(companyData);
        setBillingPlan(plan);

        try {
          const inv = await getClientInvoices();
          if (!mounted) return;
          setInvoices(inv);
          setHasInvoiceAccess(true);
        } catch (e) {
          if (!mounted) return;
          setHasInvoiceAccess(false);
        }
      } catch (e) {
        if (!mounted) return;
        setError('Failed to load account information');
      } finally {
        if (mounted) setIsLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, []);

  // const onCancelSubscription = () => {
  //   toast('Cancel subscription is not implemented yet.');
  // };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card id="company-details-card" className="p-6"><div>Loading company details…</div></Card>
        <Card id="billing-plan-card" className="p-6"><div>Loading billing plan…</div></Card>
        <Card className="p-6"><div>Loading invoices…</div></Card>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <div className="text-red-600">{error}</div>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      {/* Company Details */}
      <Card id="company-details-card" className="bg-white">
        <CardHeader>
          <CardTitle>Company Details</CardTitle>
        </CardHeader>
        <CardContent>
          {company ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-gray-600">Company Name</div>
                <div className="text-base font-medium">{company.company_name}</div>
              </div>
              <div>
                <div className="text-sm text-gray-600">Website</div>
                <div className="text-base font-medium">{company.properties?.website || company.url || '—'}</div>
              </div>
            </div>
          ) : (
            <div>No company information available.</div>
          )}
        </CardContent>
      </Card>

      {/* Billing Plan */}
      <Card id="billing-plan-card" className="bg-white">
        <CardHeader>
          <CardTitle>Billing Plan</CardTitle>
        </CardHeader>
        <CardContent>
          {billingPlan ? (
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <div className="text-base font-medium">{billingPlan.plan_name}</div>
                <div className="text-sm text-gray-600">{billingPlan.billing_frequency || '—'}</div>
              </div>
              {/* <div className="flex items-center gap-2">
                <Button id="cancel-subscription-button" variant="outline" onClick={onCancelSubscription}>
                  Cancel Subscription
                </Button>
              </div> */}
            </div>
          ) : (
            <div className="text-gray-600">No active plan found.</div>
          )}
        </CardContent>
      </Card>

      {/* Invoices */}
      <Card className="bg-white">
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {!hasInvoiceAccess ? (
            <div className="text-sm text-gray-600">You do not have access to view invoices.</div>
          ) : (
            <Table id="invoices-table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Date</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center py-4 text-gray-500">No invoices found</td>
                  </tr>
                ) : (
                  invoices.slice(0, 10).map((inv) => (
                    <tr key={inv.invoice_id}>
                      <td>{inv.invoice_number}</td>
                      <td>{formatDate(inv.invoice_date)}</td>
                      <td>{formatCurrency(inv.total_amount ?? inv.total)}</td>
                      <td>{inv.status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
