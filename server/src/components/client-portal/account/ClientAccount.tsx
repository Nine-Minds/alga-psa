'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from 'server/src/components/ui/Card';
import { Table } from 'server/src/components/ui/Table';
import { getClientClient } from '@product/actions/client-portal-actions/client-client';
import { getClientContractLine, getClientInvoices } from '@product/actions/client-portal-actions/client-billing';
import { useTranslation } from 'server/src/lib/i18n/client';

import type { IClient } from 'server/src/interfaces/client.interfaces';
import type { IClientContractLine } from 'server/src/interfaces/billing.interfaces';
import type { InvoiceViewModel } from 'server/src/interfaces/invoice.interfaces';

export default function ClientAccount() {
  const { t } = useTranslation('clientPortal');
  const [isLoading, setIsLoading] = useState(true);
  const [client, setClient] = useState<IClient | null>(null);
  const [contractLine, setContractLine] = useState<IClientContractLine | null>(null);
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
        const [clientData, plan] = await Promise.all([
          getClientClient(),
          getClientContractLine(),
        ]);

        if (!mounted) return;
        setClient(clientData);
        setContractLine(plan);

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
        setError(t('clientSettings.messages.failedToLoad'));
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
        <Card id="client-details-card" className="p-6"><div>{t('common.loading')}</div></Card>
        <Card id="contract-line-card" className="p-6"><div>{t('common.loading')}</div></Card>
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
      {/* Client Details */}
      <Card id="client-details-card" className="bg-white">
        <CardHeader>
          <CardTitle>{t('clientSettings.tabs.clientDetails')}</CardTitle>
        </CardHeader>
        <CardContent>
          {client ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-gray-600">{t('clientSettings.fields.clientName')}</div>
                <div className="text-base font-medium">{client.client_name}</div>
              </div>
              <div>
                <div className="text-sm text-gray-600">{t('clientSettings.fields.website')}</div>
                <div className="text-base font-medium">{client.properties?.website || client.url || '—'}</div>
              </div>
            </div>
          ) : (
            <div>{t('common.noData')}</div>
          )}
        </CardContent>
      </Card>

      {/* Contract Line */}
      <Card id="contract-line-card" className="bg-white">
        <CardHeader>
          <CardTitle>{t('billing.currentContractLine')}</CardTitle>
        </CardHeader>
        <CardContent>
          {contractLine ? (
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <div className="text-base font-medium">{contractLine.contract_line_name}</div>
                <div className="text-sm text-gray-600">{contractLine.billing_frequency || '—'}</div>
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
