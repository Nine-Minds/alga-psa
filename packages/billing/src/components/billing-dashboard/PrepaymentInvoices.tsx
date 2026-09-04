'use client'

import React, { useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { CurrencyInput } from '@alga-psa/ui/components/CurrencyInput';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { createPrepaymentInvoice } from '@alga-psa/billing/actions/creditActions';
import type { IClient } from '@alga-psa/types';
import { toMinorUnits } from '@alga-psa/core';
import { useTranslation } from 'react-i18next';

interface PrepaymentInvoicesProps {
  clients: IClient[];
  onGenerateSuccess: () => void;
}

function getReturnedActionError(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as { actionError?: unknown; permissionError?: unknown };
  return typeof candidate.permissionError === 'string'
    ? candidate.permissionError
    : typeof candidate.actionError === 'string'
      ? candidate.actionError
      : null;
}

const PrepaymentInvoices: React.FC<PrepaymentInvoicesProps> = ({ clients, onGenerateSuccess }) => {
  const { t, i18n } = useTranslation('msp/invoicing');
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | undefined>();
  const [description, setDescription] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const selectedClientRecord = clients.find((client) => client.client_id === selectedClient);
  const currencyCode = selectedClientRecord?.default_currency_code || 'USD';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedClient === null || amount === undefined) {
      setError(t('prepayment.errors.allFieldsRequired', { defaultValue: 'Please fill in all fields' }));
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      setError(t('prepayment.errors.validAmount', { defaultValue: 'Please enter a valid amount' }));
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const result = await createPrepaymentInvoice(
        selectedClient,
        toMinorUnits(amount, i18n.language, currencyCode),
        undefined,
        undefined,
        description.trim() || undefined,
      );
      const returnedError = getReturnedActionError(result);
      if (returnedError) {
        setError(returnedError);
        return;
      }
      
      // Clear form
      setSelectedClient(null);
      setAmount(undefined);
      setDescription('');
      
      onGenerateSuccess();
    } catch (err) {
      setError(t('prepayment.errors.generateFailed', { defaultValue: 'Error generating invoice' }));
      console.error('Error generating invoice:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Card>
      <div className="p-6">
        <h2 className="text-lg font-semibold mb-4">
          {t('prepayment.titles.prepayment', { defaultValue: 'Generate Prepayment Invoice' })}
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          {t('prepayment.descriptions.prepayment', {
            defaultValue: 'Prepayment invoices create client credit for future value. They do not create recurring service periods; later recurring invoices keep their own service-period coverage.',
          })}
        </p>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
              {t('prepayment.fields.client', { defaultValue: 'Client' })}
            </label>
            <ClientPicker
              id='client-picker'
              clients={clients}
              selectedClientId={selectedClient}
              onSelect={(clientId) => {
                setSelectedClient(clientId);
                setAmount(undefined);
              }}
              filterState={filterState}
              onFilterStateChange={setFilterState}
              clientTypeFilter={clientTypeFilter}
              onClientTypeFilterChange={setClientTypeFilter}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
              {t('prepayment.fields.amount', { defaultValue: 'Amount' })}
            </label>
            <CurrencyInput
              id="prepayment-amount-input"
              value={amount}
              onChange={setAmount}
              currencyCode={currencyCode}
              placeholder={t('prepayment.placeholders.amount', { defaultValue: 'Enter amount' })}
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
              {t('prepayment.fields.descriptionOptional', { defaultValue: 'Description (optional)' })}
            </label>
            <Input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('prepayment.placeholders.prepaymentDescription', {
                defaultValue: 'Prepayment for future services',
              })}
              className="w-full"
            />
          </div>

          <Button
            id='generate-button'
            type="submit"
            disabled={isGenerating || !selectedClient || amount === undefined || amount <= 0}
            className="w-full"
          >
            {isGenerating
              ? t('prepayment.actions.generating', { defaultValue: 'Generating...' })
              : t('prepayment.actions.generatePrepayment', {
                  defaultValue: 'Generate Prepayment Invoice',
                })}
          </Button>
        </form>
      </div>
    </Card>
  );
};

export default PrepaymentInvoices;
