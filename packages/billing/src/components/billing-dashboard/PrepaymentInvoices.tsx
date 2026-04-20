'use client'

import React, { useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { createPrepaymentInvoice } from '@alga-psa/billing/actions/creditActions';
import type { IClient } from '@alga-psa/types';
import { useTranslation } from 'react-i18next';

interface SelectOption {
  value: string;
  label: string;
}

interface PrepaymentInvoicesProps {
  clients: IClient[];
  onGenerateSuccess: () => void;
}

const CREDIT_MEMOS_UNSUPPORTED_ERROR = 'credit_memos_unsupported';

const PrepaymentInvoices: React.FC<PrepaymentInvoicesProps> = ({ clients, onGenerateSuccess }) => {
  const { t } = useTranslation('msp/invoicing');
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [amount, setAmount] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<'prepayment' | 'credit_memo'>('prepayment');
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedClient === null || !amount || !description) {
      setError(t('prepayment.errors.allFieldsRequired', { defaultValue: 'Please fill in all fields' }));
      return;
    }

    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      setError(t('prepayment.errors.validAmount', { defaultValue: 'Please enter a valid amount' }));
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      if (type === 'credit_memo') {
        throw new Error(CREDIT_MEMOS_UNSUPPORTED_ERROR);
      }

      await createPrepaymentInvoice(selectedClient || '', numericAmount);
      
      // Clear form
      setSelectedClient(null);
      setAmount('');
      setDescription('');
      setType('prepayment');
      
      onGenerateSuccess();
    } catch (err) {
      if (err instanceof Error && err.message === CREDIT_MEMOS_UNSUPPORTED_ERROR) {
        setError(t('prepayment.errors.creditMemosUnsupported', {
          defaultValue: 'Credit memos are not yet supported',
        }));
      } else {
        setError(t('prepayment.errors.generateFailed', { defaultValue: 'Error generating invoice' }));
      }
      console.error('Error generating invoice:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const typeOptions: SelectOption[] = [
    {
      value: 'prepayment',
      label: t('prepayment.types.prepaymentInvoice', { defaultValue: 'Prepayment Invoice' }),
    },
    {
      value: 'credit_memo',
      label: t('prepayment.types.creditMemo', { defaultValue: 'Credit Memo' }),
    }
  ];

  return (
    <Card>
      <div className="p-6">
        <h2 className="text-lg font-semibold mb-4">
          {type === 'prepayment'
            ? t('prepayment.titles.prepayment', { defaultValue: 'Generate Prepayment Invoice' })
            : t('prepayment.titles.creditMemo', { defaultValue: 'Generate Credit Memo' })}
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          {type === 'prepayment'
            ? t('prepayment.descriptions.prepayment', {
                defaultValue: 'Prepayment invoices create client credit for future value. They do not create recurring service periods; later recurring invoices keep their own service-period coverage.',
              })
            : t('prepayment.descriptions.creditMemo', {
                defaultValue: 'Credit memos adjust financial balances without redefining recurring service-period coverage on the source invoice.',
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
              {t('prepayment.fields.type', { defaultValue: 'Type' })}
            </label>
            <CustomSelect
              value={type}
              onValueChange={(value: string) => setType(value as 'prepayment' | 'credit_memo')}
              options={typeOptions}
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
              {t('prepayment.fields.client', { defaultValue: 'Client' })}
            </label>
            <ClientPicker
              id='client-picker'
              clients={clients}
              selectedClientId={selectedClient}
              onSelect={setSelectedClient}
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
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={t('prepayment.placeholders.amount', { defaultValue: 'Enter amount' })}
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
              {t('prepayment.fields.description', { defaultValue: 'Description' })}
            </label>
            <Input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={type === 'prepayment'
                ? t('prepayment.placeholders.prepaymentDescription', {
                    defaultValue: 'Prepayment for future services',
                  })
                : t('prepayment.placeholders.creditMemoDescription', {
                    defaultValue: 'Reason for credit memo',
                  })}
              className="w-full"
            />
          </div>

          <Button
            id='generate-button'
            type="submit"
            disabled={isGenerating || !selectedClient || !amount || !description}
            className="w-full"
          >
            {isGenerating
              ? t('prepayment.actions.generating', { defaultValue: 'Generating...' })
              : type === 'prepayment'
                ? t('prepayment.actions.generatePrepayment', {
                    defaultValue: 'Generate Prepayment Invoice',
                  })
                : t('prepayment.actions.generateCreditMemo', {
                    defaultValue: 'Generate Credit Memo',
                  })}
          </Button>
        </form>
      </div>
    </Card>
  );
};

export default PrepaymentInvoices;
