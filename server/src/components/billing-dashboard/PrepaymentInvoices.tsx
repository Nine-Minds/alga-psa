'use client'

import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import CustomSelect from '../ui/CustomSelect';
import { ClientPicker } from '../clients/ClientPicker';
import { createPrepaymentInvoice } from '../../lib/actions/creditActions';
import { IClient } from '../../interfaces';

interface SelectOption {
  value: string;
  label: string;
}

interface PrepaymentInvoicesProps {
  clients: IClient[];
  onGenerateSuccess: () => void;
}

const PrepaymentInvoices: React.FC<PrepaymentInvoicesProps> = ({ clients, onGenerateSuccess }) => {
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
      setError('Please fill in all fields');
      return;
    }

    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      if (type === 'credit_memo') {
        throw new Error('Credit memos are not yet supported');
      }

      await createPrepaymentInvoice(selectedClient || '', numericAmount);
      
      // Clear form
      setSelectedClient(null);
      setAmount('');
      setDescription('');
      setType('prepayment');
      
      onGenerateSuccess();
    } catch (err) {
      setError('Error generating invoice');
      console.error('Error generating invoice:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const typeOptions: SelectOption[] = [
    { value: 'prepayment', label: 'Prepayment Invoice' },
    { value: 'credit_memo', label: 'Credit Memo' }
  ];

  return (
    <Card>
      <div className="p-6">
        <h2 className="text-lg font-semibold mb-4">
          {type === 'prepayment' ? 'Generate Prepayment Invoice' : 'Generate Credit Memo'}
        </h2>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Type
            </label>
            <CustomSelect
              value={type}
              onValueChange={(value: string) => setType(value as 'prepayment' | 'credit_memo')}
              options={typeOptions}
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Client
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
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Amount
            </label>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter amount"
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <Input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={type === 'prepayment' ? 'Prepayment for future services' : 'Reason for credit memo'}
              className="w-full"
            />
          </div>

          <Button
            id='generate-button'
            type="submit"
            disabled={isGenerating || !selectedClient || !amount || !description}
            className="w-full"
          >
            {isGenerating ? 'Generating...' : `Generate ${type === 'prepayment' ? 'Prepayment Invoice' : 'Credit Memo'}`}
          </Button>
        </form>
      </div>
    </Card>
  );
};

export default PrepaymentInvoices;
