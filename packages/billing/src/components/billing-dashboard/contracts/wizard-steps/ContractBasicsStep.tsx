'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { ContractWizardData } from '../ContractWizard';
import { getAllClients } from '@alga-psa/clients/actions';
import { checkClientHasActiveContract } from '@alga-psa/billing/actions/contractActions';
import { BILLING_FREQUENCY_OPTIONS } from 'server/src/constants/billing';
import { CURRENCY_OPTIONS, getCurrencySymbol } from 'server/src/constants/currency';
import { formatCurrencyFromMinorUnits } from 'server/src/lib/utils/formatters';
import {
  Calendar,
  Building2,
  FileText,
  FileCheck,
  HelpCircle,
  Repeat,
  Info,
  Sparkles,
  Coins,
} from 'lucide-react';
import { format as formatDateFns, parse as parseDateFns } from 'date-fns';
import { ClientPicker } from '@alga-psa/clients/components/clients/ClientPicker';
import { IClient } from 'server/src/interfaces';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';

type TemplateOption = {
  contract_id: string;
  contract_name: string;
  contract_description?: string | null;
  billing_frequency?: string | null;
};

interface ContractBasicsStepProps {
  data: ContractWizardData;
  updateData: (data: Partial<ContractWizardData>) => void;
  templates: TemplateOption[];
  isLoadingTemplates: boolean;
  selectedTemplateId: string | null;
  onTemplateSelect: (templateId: string | null) => void;
  isTemplateLoading: boolean;
  templateError?: string | null;
}

const parseLocalYMD = (ymd?: string): Date | undefined => {
  if (!ymd) return undefined;
  const d = parseDateFns(ymd, 'yyyy-MM-dd', new Date());
  return isNaN(d.getTime()) ? undefined : d;
};

export function ContractBasicsStep({
  data,
  updateData,
  templates,
  isLoadingTemplates,
  selectedTemplateId,
  onTemplateSelect,
  isTemplateLoading,
  templateError,
}: ContractBasicsStepProps) {
  const [clients, setClients] = useState<IClient[]>([]);
  const [isLoadingClients, setIsLoadingClients] = useState(true);
  const [poAmountInput, setPoAmountInput] = useState<string>('');
  const [clientHasActiveContract, setClientHasActiveContract] = useState(false);
  const [checkingActiveContract, setCheckingActiveContract] = useState(false);
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [startDate, setStartDate] = useState<Date | undefined>(parseLocalYMD(data.start_date));
  const [endDate, setEndDate] = useState<Date | undefined>(parseLocalYMD(data.end_date));

  const currencyMeta = useMemo(() => {
    const currencyCode = data.currency_code || 'USD';
    const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode });
    const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return { currencyCode, fractionDigits, minorUnitFactor: Math.pow(10, fractionDigits) };
  }, [data.currency_code]);

  useEffect(() => {
    const loadClients = async () => {
      try {
        const fetchedClients = await getAllClients();
        setClients(fetchedClients);
      } catch (error) {
        console.error('Error loading clients:', error);
      } finally {
        setIsLoadingClients(false);
      }
    };

    void loadClients();
  }, []);

  useEffect(() => {
    if (data.po_amount !== undefined) {
      setPoAmountInput((data.po_amount / currencyMeta.minorUnitFactor).toFixed(currencyMeta.fractionDigits));
    }
  }, [data.po_amount, currencyMeta.fractionDigits, currencyMeta.minorUnitFactor]);

  useEffect(() => {
    setStartDate(parseLocalYMD(data.start_date));
    setEndDate(parseLocalYMD(data.end_date));
  }, [data.start_date, data.end_date]);

  useEffect(() => {
    const checkActiveContract = async () => {
      if (!data.client_id || data.is_draft) {
        setClientHasActiveContract(false);
        return;
      }

      setCheckingActiveContract(true);
      try {
        const hasActive = await checkClientHasActiveContract(data.client_id, data.contract_id);
        setClientHasActiveContract(hasActive);
      } catch (error) {
        console.error('Error checking for active contract:', error);
        setClientHasActiveContract(false);
      } finally {
        setCheckingActiveContract(false);
      }
    };

    void checkActiveContract();
  }, [data.client_id, data.is_draft, data.contract_id]);

  const templateOptions = templates.map((template) => ({
    value: template.contract_id,
    label: template.contract_name,
  }));

  const selectedTemplate = selectedTemplateId
    ? templates.find((template) => template.contract_id === selectedTemplateId)
    : undefined;

  return (
    <div className="space-y-6" data-automation-id="contract-basics-step">
      <div className="mb-6 space-y-3">
        <h3 className="text-lg font-semibold">Contract Basics</h3>
        <p className="text-sm text-gray-600">
          Choose a template (optional), select the client, and set foundational contract details.
          Service details load in the next steps.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="contract-template" className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-purple-500" />
          Start From Template
        </Label>
        <CustomSelect
          id="contract-template"
          value={selectedTemplateId ?? undefined}
          options={templateOptions}
          onValueChange={(value) => onTemplateSelect(value || null)}
          placeholder={isLoadingTemplates ? 'Loading templates…' : 'Select a template (optional)'}
          disabled={isLoadingTemplates || isTemplateLoading}
          allowClear
        />
        <p className="text-xs text-gray-500">
          Prefill services, notes, and billing cadence from an existing template. You can still
          adjust everything before publishing.
        </p>
        {isTemplateLoading && (
          <p className="text-xs text-blue-600">Loading template details…</p>
        )}
        {templateError && (
          <p className="text-xs text-red-600">{templateError}</p>
        )}
        {selectedTemplate && (
          <div className="text-xs text-gray-600 border border-purple-100 bg-purple-50 rounded-md p-3 mt-2 space-y-1">
            <p>
              <span className="font-semibold text-purple-700">Template:</span>{' '}
              {selectedTemplate.contract_name}
            </p>
            <p>
              <span className="font-semibold text-purple-700">Billing cadence:</span>{' '}
              {selectedTemplate.billing_frequency
                ? selectedTemplate.billing_frequency.replace(/_/g, ' ')
                : 'Not specified'}
            </p>
            {selectedTemplate.contract_description && (
              <p className="text-gray-700">{selectedTemplate.contract_description}</p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="client" className="flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          Client *
        </Label>
        <ClientPicker
          id="contract-basics-client-picker"
          clients={clients}
          selectedClientId={data.client_id || null}
          onSelect={(id) => {
            const selectedClient = clients.find((c) => c.client_id === id);
            const clientCurrency = selectedClient?.default_currency_code || data.currency_code;
            updateData({
              client_id: id || '',
              currency_code: clientCurrency,
            });
          }}
          filterState={filterState}
          onFilterStateChange={setFilterState}
          clientTypeFilter={clientTypeFilter}
          onClientTypeFilterChange={setClientTypeFilter}
          placeholder={isLoadingClients ? 'Loading clients…' : 'Select a client'}
          className="w-full"
        />
        {!data.client_id && (
          <p className="text-xs text-gray-500">Choose the client this contract is for.</p>
        )}
        {clientHasActiveContract && !data.is_draft && (
          <p className="text-sm text-red-600">
            This client already has an active contract. To create a new active contract, terminate
            their current contract or save this contract as a draft.
          </p>
        )}
        {checkingActiveContract && (
          <p className="text-xs text-gray-500">Checking current contract status…</p>
        )}
      </div>

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
        <p className="text-xs text-gray-500">Give this contract a descriptive name.</p>
      </div>

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

      <div className="space-y-2">
        <Label htmlFor="currency" className="flex items-center gap-2">
          <Coins className="h-4 w-4" />
          Currency *
        </Label>
        <CustomSelect
          id="currency"
          options={CURRENCY_OPTIONS.map((c) => ({ value: c.value, label: c.label }))}
          onValueChange={(value: string) => updateData({ currency_code: value })}
          value={data.currency_code}
          placeholder="Select currency"
          className="w-full"
        />
        <p className="text-xs text-gray-500">
          Currency for this contract. Defaults to the client's preferred currency.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="start_date" className="flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          Start Date *
        </Label>
        <DatePicker
          id="start-date"
          value={startDate}
          onChange={(date) => {
            setStartDate(date ?? undefined);
            updateData({ start_date: date ? formatDateFns(date, 'yyyy-MM-dd') : '' });
          }}
          className="w-full"
        />
        <p className="text-xs text-gray-500">When does this contract become active?</p>
      </div>

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
            setEndDate(date ?? undefined);
            updateData({ end_date: date ? formatDateFns(date, 'yyyy-MM-dd') : undefined });
          }}
          className="w-full"
          clearable
        />
        {endDate && startDate && endDate < startDate && (
          <p className="text-xs text-red-600">End date must be after start date</p>
        )}
        {!(endDate && startDate && endDate < startDate) && (
          <p className="text-xs text-gray-500">Leave blank for an ongoing contract.</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description (Optional)</Label>
        <TextArea
          id="description"
          value={data.description || ''}
          onChange={(e) => updateData({ description: e.target.value })}
          placeholder="Add any additional notes about this contract..."
          className="min-h-[100px] w-full"
        />
        <p className="text-xs text-gray-500">Internal notes or contract details.</p>
      </div>

      <div className="border-t pt-6 space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <FileCheck className="h-5 w-5 text-gray-700" />
          <h4 className="text-base font-semibold">Purchase Order (Optional)</h4>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="space-y-1 flex-1">
              <div className="flex items-center gap-2">
                <Label htmlFor="po_required" className="text-sm font-medium">
                  Require Purchase Order for invoicing
                </Label>
                <Tooltip content="When enabled, invoices cannot be generated for this contract unless a PO number is provided.">
                  <HelpCircle className="h-4 w-4 text-gray-400 cursor-help" />
                </Tooltip>
              </div>
              <p className="text-xs text-gray-500">Block invoice generation if PO is not provided.</p>
            </div>
            <Switch
              id="po_required"
              checked={data.po_required || false}
              onCheckedChange={(checked) => updateData({ po_required: checked })}
            />
          </div>
          <Alert variant="info">
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              <span className="font-medium">Note:</span> PO enforcement will apply when invoice
              automation is enabled. Configure now to stay ahead.
            </AlertDescription>
          </Alert>
        </div>

        {data.po_required && (
          <div className="space-y-4 pl-4 border-l-2 border-blue-200">
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
              <p className="text-xs text-gray-500">Client's purchase order reference number.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="po_amount">PO Amount</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                  {getCurrencySymbol(data.currency_code)}
                </span>
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
                      const majorUnits = parseFloat(poAmountInput) || 0;
                      const minorUnits = Math.round(majorUnits * currencyMeta.minorUnitFactor);
                      updateData({ po_amount: minorUnits });
                      setPoAmountInput((minorUnits / currencyMeta.minorUnitFactor).toFixed(currencyMeta.fractionDigits));
                    }
                  }}
                  placeholder={
                    currencyMeta.fractionDigits === 0 ? '0' : `0.${'0'.repeat(currencyMeta.fractionDigits)}`
                  }
                  className="pl-7"
                />
              </div>
              <p className="text-xs text-gray-500">
                Total authorized amount on the purchase order.
              </p>
            </div>
          </div>
        )}
      </div>

      {data.client_id && data.contract_name && data.start_date && (
        <Alert variant="info" className="mt-6">
          <AlertDescription>
            <h4 className="text-sm font-semibold mb-2">Contract Summary</h4>
            <div className="text-sm space-y-1">
              <p>
                <strong>Client:</strong>{' '}
                {clients.find((c) => c.client_id === data.client_id)?.client_name || 'Not selected'}
              </p>
              <p>
                <strong>Contract:</strong> {data.contract_name}
              </p>
              <p>
                <strong>Billing Frequency:</strong>{' '}
                {BILLING_FREQUENCY_OPTIONS.find((opt) => opt.value === data.billing_frequency)
                  ?.label || data.billing_frequency}
              </p>
              <p>
                <strong>Currency:</strong>{' '}
                {CURRENCY_OPTIONS.find((opt) => opt.value === data.currency_code)?.label ||
                  data.currency_code}
              </p>
              <p>
                <strong>Period:</strong>{' '}
                {formatDateFns(parseLocalYMD(data.start_date)!, 'MM/dd/yyyy')}
                {data.end_date
                  ? ` - ${formatDateFns(parseLocalYMD(data.end_date)!, 'MM/dd/yyyy')}`
                  : ' (Ongoing)'}
              </p>
              {data.po_required && (
                <>
                  <p>
                    <strong>PO Required:</strong> Yes
                  </p>
                  {data.po_number && (
                    <p>
                      <strong>PO Number:</strong> {data.po_number}
                    </p>
                  )}
                  {data.po_amount && (
                    <p>
                      <strong>PO Amount:</strong>{' '}
                      {formatCurrencyFromMinorUnits(
                        data.po_amount,
                        'en-US',
                        currencyMeta.currencyCode
                      )}
                    </p>
                  )}
                </>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
