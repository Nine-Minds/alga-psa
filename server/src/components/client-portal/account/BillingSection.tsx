'use client';

import { Card } from "server/src/components/ui/Card";
import { Table } from "server/src/components/ui/Table";
import { Button } from "server/src/components/ui/Button";
import { Dialog, DialogContent } from "server/src/components/ui/Dialog";
import { Input } from "server/src/components/ui/Input";
import { Checkbox } from "server/src/components/ui/Checkbox";
import { useState, useEffect } from 'react';
import { useTranslation } from 'server/src/lib/i18n/client';
import {
  getInvoices,
  getBillingCycles,
  getPaymentMethods,
  addPaymentMethod,
  removePaymentMethod,
  setDefaultPaymentMethod,
  type Invoice,
  type BillingCycle,
  type PaymentMethod
} from "server/src/lib/actions/account";

// Validation rules
const CARD_NUMBER_REGEX = /^[0-9]{16}$/;
const CVV_REGEX = /^[0-9]{3,4}$/;
const MONTH_REGEX = /^(0[1-9]|1[0-2])$/;
const YEAR_REGEX = /^20[2-9][0-9]$/;

interface ValidationErrors {
  cardNumber?: string;
  expMonth?: string;
  expYear?: string;
  cvv?: string;
}

export default function BillingSection() {
  const { t } = useTranslation('clientPortal');
  const [billingCycles, setBillingCycles] = useState<BillingCycle[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isAddingPayment, setIsAddingPayment] = useState(false);
  const [addPaymentError, setAddPaymentError] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});

  // Form state for adding payment method
  const [paymentForm, setPaymentForm] = useState({
    cardNumber: '',
    expMonth: '',
    expYear: '',
    cvv: '',
    setDefault: true
  });

  useEffect(() => {
    const loadBillingData = async () => {
      try {
        const [invoicesData, cyclesData, methodsData] = await Promise.all([
          getInvoices(),
          getBillingCycles(),
          getPaymentMethods()
        ]);
        setInvoices(invoicesData);
        setBillingCycles(cyclesData);
        setPaymentMethods(methodsData);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('account.billing.loadError', 'Failed to load billing data'));
      } finally {
        setIsLoading(false);
      }
    };

    loadBillingData();
  }, []);

  const validatePaymentForm = (): boolean => {
    const errors: ValidationErrors = {};
    let isValid = true;

    if (!CARD_NUMBER_REGEX.test(paymentForm.cardNumber)) {
      errors.cardNumber = t('account.billing.validation.cardNumber', 'Please enter a valid 16-digit card number');
      isValid = false;
    }

    if (!MONTH_REGEX.test(paymentForm.expMonth)) {
      errors.expMonth = t('account.billing.validation.expMonth', 'Please enter a valid month (01-12)');
      isValid = false;
    }

    if (!YEAR_REGEX.test(paymentForm.expYear)) {
      errors.expYear = t('account.billing.validation.expYear', 'Please enter a valid year (2024-2099)');
      isValid = false;
    }

    if (!CVV_REGEX.test(paymentForm.cvv)) {
      errors.cvv = t('account.billing.validation.cvv', 'Please enter a valid CVV');
      isValid = false;
    }

    setValidationErrors(errors);
    return isValid;
  };

  const handleAddPayment = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAddPaymentError('');
    
    if (!validatePaymentForm()) {
      return;
    }

    setIsProcessing(true);

    try {
      // This is a placeholder - you would integrate with your payment processor here
      const token = await processPaymentDetails(paymentForm);
      
      await addPaymentMethod({
        type: 'credit_card',
        token,
        setDefault: paymentForm.setDefault
      });

      // Refresh payment methods
      const updatedMethods = await getPaymentMethods();
      setPaymentMethods(updatedMethods);
      
      // Reset form and close dialog
      setPaymentForm({
        cardNumber: '',
        expMonth: '',
        expYear: '',
        cvv: '',
        setDefault: true
      });
      setIsAddingPayment(false);
    } catch (err) {
      setAddPaymentError(err instanceof Error ? err.message : t('account.billing.addPaymentError', 'Failed to add payment method'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRemovePayment = async (id: string) => {
    try {
      await removePaymentMethod(id);
      const updatedMethods = await getPaymentMethods();
      setPaymentMethods(updatedMethods);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('account.billing.removePaymentError', 'Failed to remove payment method'));
    }
  };

  const handleSetDefaultPayment = async (id: string) => {
    try {
      await setDefaultPaymentMethod(id);
      const updatedMethods = await getPaymentMethods();
      setPaymentMethods(updatedMethods);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('account.billing.setDefaultError', 'Failed to set default payment method'));
    }
  };

  // This is a placeholder function - replace with actual payment processor integration
  const processPaymentDetails = async (details: typeof paymentForm) => {
    // Simulate payment processor API call
    return new Promise<string>((resolve) => {
      setTimeout(() => {
        resolve('mock_payment_token');
      }, 500);
    });
  };

  const formatAmount = (amount: number, currencyCode: string = 'USD') => {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(Number(amount));
    } catch (err) {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(0);
    }
  };

  if (isLoading) {
    return <div className="text-center py-8">{t('account.billing.loadingBillingInfo', 'Loading billing information...')}</div>;
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
      {/* Billing Overview */}
      <section>
        <h3 className="text-lg font-medium mb-4">{t('account.billing.overviewTitle', 'Billing Overview')}</h3>
        <Card className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm font-medium mb-2">{t('account.billing.paymentMethodsTitle', 'Payment Methods')}</h4>
              {paymentMethods.length === 0 ? (
                <p className="text-sm text-gray-600 mb-4">
                  {t('account.billing.noPaymentMethods', 'No payment methods on file')}
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
                          {method.isDefault && ` ${t('account.billing.labels.defaultTag', '(Default)')}`}
                        </p>
                      </div>
                      <div className="flex space-x-2">
                        {!method.isDefault && (
                          <Button
                            id={`set-default-payment-${method.id}`}
                            variant="outline"
                            size="sm"
                            onClick={() => handleSetDefaultPayment(method.id)}
                          >
                            {t('account.billing.actions.setDefault', 'Set Default')}
                          </Button>
                        )}
                        <Button
                          id={`remove-payment-${method.id}`}
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemovePayment(method.id)}
                        >
                          {t('account.billing.actions.remove', 'Remove')}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Button
                id="add-payment-method"
                variant="outline"
                className="mt-4"
                onClick={() => setIsAddingPayment(true)}
              >
                {t('account.billing.actions.addPaymentMethod', 'Add Payment Method')}
              </Button>
            </div>
            <div>
              <h4 className="text-sm font-medium mb-2">{t('account.billing.billingCycleTitle', 'Billing Cycle')}</h4>
              <p className="text-sm text-gray-600">
                {billingCycles[0]?.period || t('account.billing.noBillingCycle', 'No billing cycle found')}
              </p>
            </div>
          </div>
        </Card>
      </section>

      {/* Add Payment Method Dialog */}
      <Dialog isOpen={isAddingPayment} onClose={() => setIsAddingPayment(false)}>
        <DialogContent>
          <form onSubmit={handleAddPayment} className="space-y-4">
            <h3 className="text-lg font-medium">{t('account.billing.actions.addPaymentMethod', 'Add Payment Method')}</h3>
            
            <div>
              <label htmlFor="cardNumber" className="block text-sm font-medium mb-1">
                {t('account.billing.fields.cardNumber', 'Card Number')}
              </label>
              <Input
                id="cardNumber"
                value={paymentForm.cardNumber}
                onChange={(e) => setPaymentForm(prev => ({
                  ...prev,
                  cardNumber: e.target.value
                }))}
                maxLength={16}
                placeholder="1234 5678 9012 3456"
                className={validationErrors.cardNumber ? 'border-red-500' : ''}
              />
              {validationErrors.cardNumber && (
                <p className="mt-1 text-sm text-red-500">{validationErrors.cardNumber}</p>
              )}
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label htmlFor="expMonth" className="block text-sm font-medium mb-1">
                  {t('account.billing.fields.expiryMonth', 'Month')}
                </label>
                <Input
                  id="expMonth"
                  value={paymentForm.expMonth}
                  onChange={(e) => setPaymentForm(prev => ({
                    ...prev,
                    expMonth: e.target.value
                  }))}
                  maxLength={2}
                  placeholder="MM"
                  className={validationErrors.expMonth ? 'border-red-500' : ''}
                />
                {validationErrors.expMonth && (
                  <p className="mt-1 text-sm text-red-500">{validationErrors.expMonth}</p>
                )}
              </div>

              <div>
                <label htmlFor="expYear" className="block text-sm font-medium mb-1">
                  {t('account.billing.fields.expiryYear', 'Year')}
                </label>
                <Input
                  id="expYear"
                  value={paymentForm.expYear}
                  onChange={(e) => setPaymentForm(prev => ({
                    ...prev,
                    expYear: e.target.value
                  }))}
                  maxLength={4}
                  placeholder="YYYY"
                  className={validationErrors.expYear ? 'border-red-500' : ''}
                />
                {validationErrors.expYear && (
                  <p className="mt-1 text-sm text-red-500">{validationErrors.expYear}</p>
                )}
              </div>

              <div>
                <label htmlFor="cvv" className="block text-sm font-medium mb-1">
                  {t('account.billing.fields.cvv', 'CVV')}
                </label>
                <Input
                  id="cvv"
                  value={paymentForm.cvv}
                  onChange={(e) => setPaymentForm(prev => ({
                    ...prev,
                    cvv: e.target.value
                  }))}
                  maxLength={4}
                  placeholder="123"
                  className={validationErrors.cvv ? 'border-red-500' : ''}
                />
                {validationErrors.cvv && (
                  <p className="mt-1 text-sm text-red-500">{validationErrors.cvv}</p>
                )}
              </div>
            </div>

            <div className="flex items-center">
              <Checkbox
                id="setDefault"
                label="Set as default payment method"
                checked={paymentForm.setDefault}
                onChange={(e) => setPaymentForm(prev => ({
                  ...prev,
                  setDefault: (e.target as HTMLInputElement).checked
                }))}
              />
              <label htmlFor="setDefault" className="text-sm">
                {t('account.billing.fields.setAsDefault', 'Set as default payment method')}
              </label>
            </div>

            {addPaymentError && (
              <p className="text-sm text-red-500">{addPaymentError}</p>
            )}

            <div className="flex justify-end space-x-2">
              <Button
                id="cancel-add-payment"
                type="button"
                variant="ghost"
                onClick={() => setIsAddingPayment(false)}
                disabled={isProcessing}
              >
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                id="submit-add-payment"
                type="submit"
                disabled={isProcessing}
              >
                {isProcessing
                  ? t('account.billing.actions.adding', 'Adding...')
                  : t('account.billing.actions.addPaymentMethod', 'Add Payment Method')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Recent Invoices */}
      <section>
        <h3 className="text-lg font-medium mb-4">{t('account.billing.recentInvoicesTitle', 'Recent Invoices')}</h3>
        <Table>
          <thead>
            <tr>
              <th>{t('billing.invoice.number', 'Invoice #')}</th>
              <th>{t('billing.invoice.date', 'Invoice Date')}</th>
              <th>{t('billing.invoice.amount', 'Amount')}</th>
              <th>{t('billing.invoice.status', 'Status')}</th>
              <th>{t('clientPortal.common.actions', 'Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-4 text-gray-500">
                  {t('billing.messages.noInvoices', 'No invoices found')}
                </td>
              </tr>
            ) : (
              invoices.map((invoice): React.JSX.Element => (
                <tr key={invoice.id}>
                  <td>{invoice.number}</td>
                  <td>{invoice.date}</td>
                  <td>{formatAmount(invoice.amount)}</td>
                  <td>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      invoice.status === 'paid' ? 'bg-green-100 text-green-800' : 
                      invoice.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 
                      'bg-red-100 text-red-800'
                    }`}>
                      {invoice.status}
                    </span>
                  </td>
                  <td>
                    <Button id={`view-invoice-${invoice.id}`} variant="ghost" size="sm">
                      {t('account.billing.actions.view', 'View')}
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
        <h3 className="text-lg font-medium mb-4">{t('account.billing.billingHistoryTitle', 'Billing History')}</h3>
        <Table>
          <thead>
            <tr>
              <th>{t('account.billing.history.period', 'Period')}</th>
              <th>{t('account.billing.history.startDate', 'Start Date')}</th>
              <th>{t('account.billing.history.endDate', 'End Date')}</th>
              <th>{t('account.billing.history.status', 'Status')}</th>
            </tr>
          </thead>
          <tbody>
            {billingCycles.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-4 text-gray-500">
                  {t('account.billing.history.empty', 'No billing history available')}
                </td>
              </tr>
            ) : (
              billingCycles.map((cycle): React.JSX.Element => (
                <tr key={cycle.id}>
                  <td>{cycle.period}</td>
                  <td>{cycle.startDate}</td>
                  <td>{cycle.endDate}</td>
                  <td>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      cycle.status === 'active' ? 'bg-green-100 text-green-800' : 
                      cycle.status === 'upcoming' ? 'bg-blue-100 text-blue-800' : 
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {cycle.status}
                    </span>
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
