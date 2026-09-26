'use client';

import { Card } from "@alga-psa/ui/components/Card";
import { Badge } from "@alga-psa/ui/components/Badge";
import { Table } from "@alga-psa/ui/components/Table";
import { Button } from "@alga-psa/ui/components/Button";
import { Checkbox } from "@alga-psa/ui/components/Checkbox";
import CustomSelect from "@alga-psa/ui/components/CustomSelect";
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { Dialog, DialogContent } from "@alga-psa/ui/components/Dialog";
import { useState, useEffect } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getInvoices,
  getBillingCycles,
  getPaymentMethods,
  startClientPortalCardSetup,
  getClientPortalAutopayProfile,
  enrollClientPortalAutopay,
  disableClientPortalAutopay,
  removePaymentMethod,
  setDefaultPaymentMethod,
  type Invoice,
  type BillingCycle,
  type PaymentMethod
} from "@alga-psa/client-portal/actions";
import {
  getPortalBillingProfiles,
  type PortalBillingProfile,
} from "../../actions/client-portal-actions/client-billing-segments";
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useSearchParams } from 'next/navigation';

const isReturnedActionError = (
  value: unknown
): value is { readonly actionError: string } | { readonly permissionError: string } =>
  isActionMessageError(value) || isActionPermissionError(value);

type PortalAutopayInfo = {
  enabled: boolean;
  consentText: string;
  consentTextVersion: string;
  enrollment: { is_enabled: boolean; payment_method_id: string; authorized_at: string; authorization_source: string; authorized_by_user_id?: string } | null;
  methods: Array<{ payment_method_id: string; brand: string | null; last4: string; exp_month: string; exp_year: string; status: string }>;
  chargeableMethods: Array<{ payment_method_id: string; brand: string | null; last4: string; exp_month: string; exp_year: string; status: string }>;
  attempts: Array<{ attempt_id: string; status: string; scheduled_for: string; failure_code?: string | null }>;
};

export default function BillingSection() {
  const searchParams = useSearchParams();
  const { money } = useCurrencyFormat();
  const { t: tAccount } = useTranslation('client-portal');
  const { t: tBilling } = useTranslation('features/billing');
  const { t: tCommon } = useTranslation('common');
  const tAccountBilling = (key: string, options?: Record<string, any> | string): string => {
    if (typeof options === 'string') {
      return tAccount(`account.billing.${key}`, { defaultValue: options });
    }
    return tAccount(`account.billing.${key}`, options) as string;
  };
  const [billingCycles, setBillingCycles] = useState<BillingCycle[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [billingProfiles, setBillingProfiles] = useState<PortalBillingProfile[]>([]);
  // Decision D6: a client with one profile sees no profile surface at all. The
  // same `> 1` rule the rest of the feature uses, so a card list and a spend
  // report can never disagree about whether this client is segmented.
  const isSegmented = billingProfiles.length > 1;
  const defaultProfileId =
    billingProfiles.find((profile) => profile.isDefault)?.billingProfileId ?? '';
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [setupError, setSetupError] = useState('');
  const [startingSetup, setStartingSetup] = useState(false);
  const [autopayByProfile, setAutopayByProfile] = useState<Record<string, PortalAutopayInfo>>({});
  const [autopaySelections, setAutopaySelections] = useState<Record<string, string>>({});
  const [autopayConsents, setAutopayConsents] = useState<Record<string, boolean>>({});
  const [autopayBusyProfileId, setAutopayBusyProfileId] = useState<string | null>(null);

  useEffect(() => {
    const loadBillingData = async () => {
      try {
        const [invoicesData, cyclesData, methodsData, profilesData] = await Promise.all([
          getInvoices(),
          getBillingCycles(),
          getPaymentMethods(),
          getPortalBillingProfiles()
        ]);
        const expectedError = [invoicesData, cyclesData, methodsData, profilesData].find(isReturnedActionError);
        if (expectedError) {
          setError(getErrorMessage(expectedError));
          return;
        }
        setInvoices(invoicesData);
        setBillingCycles(cyclesData);
        setPaymentMethods(methodsData);
        setBillingProfiles(profilesData as PortalBillingProfile[]);
        const profileResults = await Promise.all((profilesData as PortalBillingProfile[]).map(async (profile) => ({
          id: profile.billingProfileId,
          info: await getClientPortalAutopayProfile(profile.billingProfileId),
        })));
        const autopayInfo: Record<string, PortalAutopayInfo> = {};
        for (const result of profileResults) {
          if (!isReturnedActionError(result.info) && result.info) autopayInfo[result.id] = result.info as PortalAutopayInfo;
        }
        setAutopayByProfile(autopayInfo);
        setAutopaySelections(Object.fromEntries(Object.entries(autopayInfo).map(([id, info]) => [id, info.chargeableMethods[0]?.payment_method_id ?? ''])));
      } catch (err) {
        console.error('Failed to load billing data:', err);
        setError(tAccountBilling('loadError', 'Failed to load billing data'));
      } finally {
        setIsLoading(false);
      }
    };

    loadBillingData();
  }, []);

  const handleRemovePayment = async (id: string) => {
    try {
      const result = await removePaymentMethod(id);
      if (isReturnedActionError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      const updatedMethods = await getPaymentMethods();
      if (isReturnedActionError(updatedMethods)) {
        setError(getErrorMessage(updatedMethods));
        return;
      }
      setPaymentMethods(updatedMethods);
    } catch (err) {
      console.error('Failed to remove payment method:', err);
      setError(tAccountBilling('removePaymentError', 'Failed to remove payment method'));
    }
  };

  const handleSetDefaultPayment = async (id: string) => {
    try {
      const result = await setDefaultPaymentMethod(id);
      if (isReturnedActionError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      const updatedMethods = await getPaymentMethods();
      if (isReturnedActionError(updatedMethods)) {
        setError(getErrorMessage(updatedMethods));
        return;
      }
      setPaymentMethods(updatedMethods);
    } catch (err) {
      console.error('Failed to set default payment method:', err);
      setError(tAccountBilling('setDefaultError', 'Failed to set default payment method'));
    }
  };

  const handleAddPaymentMethod = async () => {
    const billingProfileId = defaultProfileId || billingProfiles[0]?.billingProfileId;
    if (!billingProfileId) return;
    setStartingSetup(true);
    setSetupError('');
    try {
      const result = await startClientPortalCardSetup(billingProfileId);
      if (isReturnedActionError(result)) {
        setSetupError(getErrorMessage(result));
        return;
      }
      window.location.assign(result.url);
    } catch (setupFailure) {
      setSetupError(getErrorMessage(setupFailure));
    } finally {
      setStartingSetup(false);
    }
  };

  const handleAutopayChange = async (billingProfileId: string, enabled: boolean) => {
    const info = autopayByProfile[billingProfileId];
    setAutopayBusyProfileId(billingProfileId);
    try {
      const result = enabled
        ? await enrollClientPortalAutopay(billingProfileId, autopaySelections[billingProfileId] ?? '', info?.consentTextVersion ?? '1')
        : await disableClientPortalAutopay(billingProfileId);
      if (isReturnedActionError(result)) throw new Error(getErrorMessage(result));
      const refreshed = await getClientPortalAutopayProfile(billingProfileId);
      if (!isReturnedActionError(refreshed) && refreshed) setAutopayByProfile((current) => ({ ...current, [billingProfileId]: refreshed as PortalAutopayInfo }));
    } catch (autopayFailure) {
      setSetupError(getErrorMessage(autopayFailure));
    } finally {
      setAutopayBusyProfileId(null);
    }
  };

  // money() takes minor units and formats with the tenant's locale + currency
  // from CurrencyFormatProvider; amounts here are major units.
  const formatAmount = (amount: number, currencyCode?: string) => {
    try {
      return money(Math.round(Number(amount) * 100), currencyCode);
    } catch (err) {
      return money(0);
    }
  };

  if (isLoading) {
    return <div className="text-center py-8">{tAccountBilling('loadingBillingInfo', 'Loading billing information...')}</div>;
  }

  if (error) {
    return (
      <div className="text-center py-8 text-red-500">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {searchParams.get('cardSetup') === 'success' && <p className="text-sm text-success">{tAccountBilling('cardSetup.success', 'Card saved securely.')}</p>}
      {searchParams.get('cardSetup') === 'error' && <p className="text-sm text-destructive">{tAccountBilling('cardSetup.error', 'We could not save the card. Please try again.')}</p>}
      {/* Billing Overview */}
      {billingProfiles.map((profile) => {
        const info = autopayByProfile[profile.billingProfileId];
        if (!info?.enabled) return null;
        const enrolled = info.enrollment?.is_enabled === true;
        return <Card key={`autopay-${profile.billingProfileId}`} className="p-5">
          <h4 className="text-sm font-medium">{tAccountBilling('autopay.title', { defaultValue: 'Auto-pay · {{profile}}', profile: profile.name })}</h4>
          {enrolled ? <div className="mt-2 text-sm text-muted-foreground">
            <p>{tAccountBilling('autopay.enrolled', { defaultValue: 'Auto-pay is enabled for this billing profile.' })}</p>
            <p>{info.methods.find((method) => method.payment_method_id === info.enrollment?.payment_method_id)?.brand} •••• {info.methods.find((method) => method.payment_method_id === info.enrollment?.payment_method_id)?.last4}</p>
            <p>{tAccountBilling('autopay.authorizedAt', { defaultValue: 'Authorized {{date}}', date: new Date(info.enrollment!.authorized_at).toLocaleDateString() })}</p>
            <Button id={`disable-autopay-${profile.billingProfileId}`} className="mt-3" variant="outline" disabled={autopayBusyProfileId === profile.billingProfileId} onClick={() => void handleAutopayChange(profile.billingProfileId, false)}>{tAccountBilling('autopay.disable', 'Turn off auto-pay')}</Button>
          </div> : <div className="mt-3 space-y-3">
            {info.chargeableMethods.length ? <>
              <CustomSelect id={`autopay-card-${profile.billingProfileId}`} value={autopaySelections[profile.billingProfileId] ?? ''} onValueChange={(value) => setAutopaySelections((current) => ({ ...current, [profile.billingProfileId]: value }))} options={info.chargeableMethods.map((method) => ({ value: method.payment_method_id, label: `${method.brand ?? 'Card'} •••• ${method.last4} (${method.exp_month}/${method.exp_year})` }))} />
              <p className="text-sm text-muted-foreground">{info.consentText}</p>
              <Checkbox id={`autopay-consent-${profile.billingProfileId}`} checked={autopayConsents[profile.billingProfileId] ?? false} onChange={(event) => setAutopayConsents((current) => ({ ...current, [profile.billingProfileId]: (event.target as HTMLInputElement).checked }))} label={tAccountBilling('autopay.consent', 'I authorize recurring charges to this card for finalized invoices.')} />
              <Button id={`enable-autopay-${profile.billingProfileId}`} disabled={!autopaySelections[profile.billingProfileId] || !autopayConsents[profile.billingProfileId] || autopayBusyProfileId === profile.billingProfileId} onClick={() => void handleAutopayChange(profile.billingProfileId, true)}>{tAccountBilling('autopay.enable', 'Enable auto-pay')}</Button>
            </> : <p className="text-sm text-muted-foreground">{tAccountBilling('autopay.noCards', 'Add a card to enable auto-pay.')}</p>}
          </div>}
        </Card>;
      })}
      <section>
        <h3 className="text-lg font-medium mb-4">{tAccountBilling('overviewTitle', 'Billing Overview')}</h3>
        <Card className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm font-medium mb-2">{tAccountBilling('paymentMethodsTitle', 'Payment Methods')}</h4>
              {paymentMethods.length === 0 ? (
                <p className="text-sm text-gray-600 mb-4">
                  {tAccountBilling('noPaymentMethods', 'No payment methods on file')}
                </p>
              ) : (
                <div className="space-y-4">
                  {paymentMethods.map((method): React.JSX.Element => (
                    <div key={method.id} className="flex items-center justify-between">
                      <div>
                        <p className="text-sm">
                          {method.type === 'credit_card' ? '•••• ' : ''}
                          {method.last4}
                          {method.expMonth && method.expYear && ` (${method.expMonth}/${method.expYear})`}
                          {method.isDefault && ` ${tAccountBilling('labels.defaultTag', '(Default)')}`}
                        </p>
                        {/* Which entity this card pays for. Shown only when the
                            client is actually segmented — otherwise it is a
                            label with one possible value. */}
                        {isSegmented && method.billingProfileName && (
                          <p className="text-xs text-gray-500">
                            {tAccount('account.billing.labels.paysFor', {
                              defaultValue: 'Pays for {{profile}}',
                              profile: method.billingProfileName,
                            }) as string}
                          </p>
                        )}
                      </div>
                      <div className="flex space-x-2">
                        {!method.isDefault && (
                          <Button
                            id={`set-default-payment-${method.id}`}
                            variant="outline"
                            size="sm"
                            onClick={() => handleSetDefaultPayment(method.id)}
                          >
                            {tAccountBilling('actions.setDefault', 'Set Default')}
                          </Button>
                        )}
                        <Button
                          id={`remove-payment-${method.id}`}
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemovePayment(method.id)}
                        >
                          {tAccountBilling('actions.remove', 'Remove')}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Button id="add-payment-method" variant="outline" className="mt-4" onClick={handleAddPaymentMethod} disabled={startingSetup || !defaultProfileId}>
                {startingSetup ? tAccountBilling('actions.adding', 'Opening secure setup…') : tAccountBilling('actions.addPaymentMethod', 'Add Payment Method')}
              </Button>
              {setupError && <p className="mt-2 text-sm text-destructive">{setupError}</p>}
            </div>
            <div>
              <h4 className="text-sm font-medium mb-2">{tAccountBilling('billingCycleTitle', 'Billing Cycle')}</h4>
              <p className="text-sm text-gray-600">
                {billingCycles[0]?.period || tAccountBilling('noBillingCycle', 'No billing cycle found')}
              </p>
            </div>
          </div>
        </Card>
      </section>

      {/* Recent Invoices */}
      <section>
        <h3 className="text-lg font-medium mb-4">{tAccountBilling('recentInvoicesTitle', 'Recent Invoices')}</h3>
        <Table>
          <thead>
            <tr>
              <th>{tBilling('invoice.number', 'Invoice #')}</th>
              <th>{tBilling('invoice.date', 'Invoice Date')}</th>
              <th>{tBilling('invoice.amount', 'Amount')}</th>
              <th>{tBilling('invoice.status', 'Status')}</th>
              <th>{tCommon('common.actions', 'Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-4 text-gray-500">
                  {tBilling('messages.noInvoices', 'No invoices found')}
                </td>
              </tr>
            ) : (
              invoices.map((invoice): React.JSX.Element => (
                <tr key={invoice.id}>
                  <td>{invoice.number}{invoice.autopay && <p className="mt-1 text-xs text-muted-foreground">{tAccountBilling('autopay.willCharge', { defaultValue: 'Will be charged on {{date}} to {{brand}} •••• {{last4}}', date: new Date(invoice.autopay.scheduledFor).toLocaleDateString(), brand: invoice.autopay.brand ?? 'Card', last4: invoice.autopay.last4 })}</p>}</td>
                  <td>{invoice.date}</td>
                  <td>{formatAmount(invoice.amount)}</td>
                  <td>
                    <Badge variant={
                      invoice.status === 'paid' ? 'success' :
                      invoice.status === 'pending' ? 'warning' :
                      'error'
                    }>
                      {invoice.status}
                    </Badge>
                  </td>
                  <td>
                    <Button id={`view-invoice-${invoice.id}`} variant="ghost" size="sm">
                      {tAccountBilling('actions.view', 'View')}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </section>

      {/* Billing History */}
      <section>
        <h3 className="text-lg font-medium mb-4">{tAccountBilling('billingHistoryTitle', 'Billing History')}</h3>
        <Table>
          <thead>
            <tr>
              <th>{tAccountBilling('history.period', 'Period')}</th>
              <th>{tAccountBilling('history.startDate', 'Start Date')}</th>
              <th>{tAccountBilling('history.endDate', 'End Date')}</th>
              <th>{tAccountBilling('history.status', 'Status')}</th>
            </tr>
          </thead>
          <tbody>
            {billingCycles.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-4 text-gray-500">
                  {tAccountBilling('history.empty', 'No billing history available')}
                </td>
              </tr>
            ) : (
              billingCycles.map((cycle): React.JSX.Element => (
                <tr key={cycle.id}>
                  <td>{cycle.period}</td>
                  <td>{cycle.startDate}</td>
                  <td>{cycle.endDate}</td>
                  <td>
                    <Badge variant={
                      cycle.status === 'active' ? 'success' :
                      cycle.status === 'upcoming' ? 'info' :
                      'default-muted'
                    }>
                      {cycle.status}
                    </Badge>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </section>
    </div>
  );
}
