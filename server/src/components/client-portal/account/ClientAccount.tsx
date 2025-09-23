'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from 'server/src/components/ui/Card';
import { Table } from 'server/src/components/ui/Table';
import { getClientCompany } from 'server/src/lib/actions/client-portal-actions/client-company';
import { getClientBillingPlan, getClientInvoices } from 'server/src/lib/actions/client-portal-actions/client-billing';
import { useTranslation } from '@/lib/i18n/client';

import type { ICompany } from 'server/src/interfaces/company.interfaces';
import type { ICompanyBillingPlan } from 'server/src/interfaces/billing.interfaces';
import type { InvoiceViewModel } from 'server/src/interfaces/invoice.interfaces';

export default function ClientAccount() {
  const { t } = useTranslation('clientPortal');
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
        setError(t('companySettings.messages.failedToLoad'));
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
        <Card id="company-details-card" className="p-6"><div>{t('common.loading')}</div></Card>
        <Card id="billing-plan-card" className="p-6"><div>{t('common.loading')}</div></Card>
        <Card className="p-6"><div>{t('common.loading')}</div></Card>
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
          <CardTitle>{t('companySettings.tabs.companyDetails')}</CardTitle>
        </CardHeader>
        <CardContent>
          {company ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-gray-600">{t('companySettings.fields.companyName')}</div>
                <div className="text-base font-medium">{company.company_name}</div>
              </div>
              <div>
                <div className="text-sm text-gray-600">{t('companySettings.fields.website')}</div>
                <div className="text-base font-medium">{company.properties?.website || company.url || '—'}</div>
              </div>
            </div>
          ) : (
            <div>{t('common.noData')}</div>
          )}
        </CardContent>
      </Card>

      {/* Billing Plan */}
      <Card id="billing-plan-card" className="bg-white">
        <CardHeader>
          <CardTitle>{t('billing.currentPlan')}</CardTitle>
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
            <div className="text-gray-600">{t('common.noData')}</div>
          )}
        </CardContent>
      </Card>

      {/* Invoices */}
      <Card className="bg-white">
        <CardHeader>
          <CardTitle>{t('billing.invoices')}</CardTitle>
        </CardHeader>
        <CardContent>
          {!hasInvoiceAccess ? (
            <div className="text-sm text-gray-600">{t('billing.messages.noInvoices')}</div>
          ) : (
            <Table id="invoices-table">
              <thead>
                <tr>
                  <th>{t('billing.invoice.number')}</th>
                  <th>{t('billing.invoice.date')}</th>
                  <th>{t('billing.invoice.amount')}</th>
                  <th>{t('billing.invoice.status')}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center py-4 text-gray-500">{t('billing.messages.noInvoices')}</td>
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
