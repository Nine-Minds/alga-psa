'use client';

import React, { useState, useEffect } from 'react';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Switch } from 'server/src/components/ui/Switch';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import { DatePicker } from 'server/src/components/ui/DatePicker';
import { ContractWizardData } from '../ContractWizard';
import { getClients } from 'server/src/lib/actions/clientAction';
import { BILLING_FREQUENCY_OPTIONS } from 'server/src/constants/billing';
import { Calendar, Building2, FileText, FileCheck, HelpCircle, Repeat, Info } from 'lucide-react';

interface ContractBasicsStepProps {
  data: ContractWizardData;
  updateData: (data: Partial<ContractWizardData>) => void;
}

type ClientOption = Awaited<ReturnType<typeof getClients>>[number];

export function ContractBasicsStep({ data, updateData }: ContractBasicsStepProps) {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [isLoadingClients, setIsLoadingClients] = useState(true);
  const [poAmountInput, setPoAmountInput] = useState<string>('');
  const [startDate, setStartDate] = useState<Date | undefined>(
    data.start_date ? new Date(data.start_date) : undefined
  );
  const [endDate, setEndDate] = useState<Date | undefined>(
    data.end_date ? new Date(data.end_date) : undefined
  );

  useEffect(() => {
    loadClients();
  }, []);

  useEffect(() => {
    if (data.po_amount !== undefined) {
      setPoAmountInput((data.po_amount / 100).toFixed(2));
    }
  }, [data.po_amount]);

  useEffect(() => {
    if (data.start_date) {
      setStartDate(new Date(data.start_date));
    } else {
      setStartDate(undefined);
    }
    if (data.end_date) {
      setEndDate(new Date(data.end_date));
    } else {
      setEndDate(undefined);
    }
  }, [data.start_date, data.end_date]);

  const loadClients = async () => {
    try {
      const fetchedClients = await getClients();
      setClients(fetchedClients);
    } catch (error) {
      console.error('Error loading clients:', error);
    } finally {
      setIsLoadingClients(false);
    }
  };

  const clientOptions = clients.map(client => ({ value: client.id, label: client.name }));

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">Contract Basics</h3>
        <p className="text-sm text-gray-600">
          Start by selecting a client and naming this contract. You'll configure services in the next steps.
        </p>
      </div>

      {/* Client Selection */}
      <div className="space-y-2">
        <Label htmlFor="client" className="flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          Client *
        </Label>
        <CustomSelect
          value={data.client_id || data.company_id}
          onValueChange={(value: string) => updateData({ client_id: value, company_id: value })}
          options={clientOptions}
          placeholder={isLoadingClients ? 'Loading clients...' : 'Select a client'}
          disabled={isLoadingClients}
          className="w-full"
        />
        {!(data.client_id || data.company_id) && (
          <p className="text-xs text-gray-500">Choose the client this contract is for</p>
        )}
      </div>

      {/* Contract Name */}
      <div className="space-y-2">
        <Label htmlFor="contract_name" className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Contract Name *
        </Label>
        <Input
          id="contract_name"
          type="text"
          value={data.contract_name}
          onChange={(e) => updateData({ contract_name: e.target.value })}
          placeholder="e.g., Standard MSP Services, Premium Support Package"
          className="w-full"
        />
        <p className="text-xs text-gray-500">Give this contract a descriptive name</p>
      </div>

      {/* Billing Frequency */}
      <div className="space-y-2">
        <Label htmlFor="billing-frequency" className="flex items-center gap-2">
          <Repeat className="h-4 w-4" />
          Billing Frequency *
        </Label>
        <CustomSelect
          id="billing-frequency"
          options={BILLING_FREQUENCY_OPTIONS}
          onValueChange={(value: string) => updateData({ billing_frequency: value })}
          value={data.billing_frequency}
          placeholder="Select billing frequency"
          className="w-full"
        />
        <p className="text-xs text-gray-500">How often should this contract be billed?</p>
      </div>

      {/* Start Date */}
      <div className="space-y-2">
        <Label htmlFor="start_date" className="flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          Start Date *
        </Label>
        <DatePicker
          id="start-date"
          value={startDate}
          onChange={(date) => {
            setStartDate(date);
            updateData({ start_date: date ? date.toISOString().split('T')[0] : '' });
          }}
          className="w-full"
        />
        <p className="text-xs text-gray-500">When does this contract become active?</p>
      </div>

      {/* End Date (Optional) */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="end_date" className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            End Date (Optional)
          </Label>
          <Tooltip content="Leave blank for ongoing contracts that don't have a fixed end date. You can always set an end date later when the contract is terminated or expires.">
            <HelpCircle className="h-4 w-4 text-gray-400 cursor-help" />
          </Tooltip>
        </div>
        <DatePicker
          id="end-date"
          value={endDate}
          onChange={(date) => {
            setEndDate(date);
            updateData({ end_date: date ? date.toISOString().split('T')[0] : undefined });
          }}
          className="w-full"
          clearable
        />
        <p className="text-xs text-gray-500">Leave blank for an ongoing contract with no end date</p>
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description">Description (Optional)</Label>
        <TextArea
          id="description"
          value={data.description || ''}
          onChange={(e) => updateData({ description: e.target.value })}
          placeholder="Add any additional notes about this contract..."
          className="min-h-[100px] w-full"
        />
        <p className="text-xs text-gray-500">Internal notes or contract details</p>
      </div>

      {/* Purchase Order Section */}
      <div className="border-t pt-6 space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <FileCheck className="h-5 w-5 text-gray-700" />
          <h4 className="text-base font-semibold">Purchase Order (Optional)</h4>
        </div>

        {/* PO Required Toggle */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="space-y-1 flex-1">
              <div className="flex items-center gap-2">
                <Label htmlFor="po_required" className="text-sm font-medium">Require Purchase Order for invoicing</Label>
                <Tooltip content="When enabled, invoices cannot be generated for this contract unless a PO number is provided. This helps ensure compliance with client procurement policies.">
                  <HelpCircle className="h-4 w-4 text-gray-400 cursor-help" />
                </Tooltip>
              </div>
              <p className="text-xs text-gray-500">Block invoice generation if PO is not provided</p>
            </div>
            <Switch id="po_required" checked={data.po_required || false} onCheckedChange={(checked) => updateData({ po_required: checked })} />
          </div>
          {/* Coming Soon Notice - Below Toggle */}
          <div className="flex gap-2 text-xs text-blue-700 bg-blue-50 p-2 rounded border border-blue-100">
            <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            <p>
              <span className="font-medium">Note:</span> Invoice integration coming soon. You can configure this now and your settings will be saved, but PO enforcement won't be active until a future release.
            </p>
          </div>
        </div>

        {/* Show PO fields only when toggle is on */}
        {data.po_required && (
          <div className="space-y-4 pl-4 border-l-2 border-blue-200">
            {/* PO Number */}
            <div className="space-y-2">
              <Label htmlFor="po_number">PO Number *</Label>
              <Input
                id="po_number"
                type="text"
                value={data.po_number || ''}
                onChange={(e) => updateData({ po_number: e.target.value })}
                placeholder="e.g., PO-2024-12345"
                className="w-full"
              />
              <p className="text-xs text-gray-500">Client's purchase order reference number</p>
            </div>

            {/* PO Amount */}
            <div className="space-y-2">
              <Label htmlFor="po_amount">PO Amount</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                <Input
                  id="po_amount"
                  type="text"
                  inputMode="decimal"
                  value={poAmountInput}
                  onChange={(e) => {
                    const value = e.target.value.replace(/[^0-9.]/g, '');
                    const decimalCount = (value.match(/\./g) || []).length;
                    if (decimalCount <= 1) {
                      setPoAmountInput(value);
                    }
                  }}
                  onBlur={() => {
                    if (poAmountInput.trim() === '' || poAmountInput === '.') {
                      setPoAmountInput('');
                      updateData({ po_amount: undefined });
                    } else {
                      const dollars = parseFloat(poAmountInput) || 0;
                      const cents = Math.round(dollars * 100);
                      updateData({ po_amount: cents });
                      setPoAmountInput((cents / 100).toFixed(2));
                    }
                  }}
                  placeholder="0.00"
                  className="pl-7"
                />
              </div>
              <p className="text-xs text-gray-500">Total authorized amount on the purchase order</p>
            </div>
          </div>
        )}
      </div>

      {/* Summary Card */}
      {(data.client_id || data.company_id) && data.contract_name && data.start_date && (
        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
          <h4 className="text-sm font-semibold text-blue-900 mb-2">Contract Summary</h4>
          <div className="text-sm text-blue-800 space-y-1">
            <p><strong>Client:</strong> {clientOptions.find(c => c.value === (data.client_id || data.company_id))?.label || 'Not selected'}</p>
            <p><strong>Contract:</strong> {data.contract_name}</p>
            <p><strong>Billing Frequency:</strong> {BILLING_FREQUENCY_OPTIONS.find(opt => opt.value === data.billing_frequency)?.label || data.billing_frequency}</p>
            <p><strong>Period:</strong> {new Date(data.start_date).toLocaleDateString()}{data.end_date ? ` - ${new Date(data.end_date).toLocaleDateString()}` : ' (Ongoing)'}</p>
            {data.po_required && (
              <>
                <p><strong>PO Required:</strong> Yes</p>
                {data.po_number && <p><strong>PO Number:</strong> {data.po_number}</p>}
                {data.po_amount && (
                  <p><strong>PO Amount:</strong> {(data.po_amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
