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
import { ICompany } from 'server/src/interfaces';
import { getAllCompanies } from 'server/src/lib/actions/company-actions/companyActions';
import { Calendar, Building2, FileText, FileCheck, HelpCircle } from 'lucide-react';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';

interface ContractBasicsStepProps {
  data: ContractWizardData;
  updateData: (data: Partial<ContractWizardData>) => void;
}

export function ContractBasicsStep({ data, updateData }: ContractBasicsStepProps) {
  const [companies, setCompanies] = useState<ICompany[]>([]);
  const [isLoadingCompanies, setIsLoadingCompanies] = useState(true);
  const [poAmountInput, setPoAmountInput] = useState<string>('');
  const [startDate, setStartDate] = useState<Date | undefined>(
    data.start_date ? new Date(data.start_date) : undefined
  );
  const [endDate, setEndDate] = useState<Date | undefined>(
    data.end_date ? new Date(data.end_date) : undefined
  );

  useEffect(() => {
    loadCompanies();
  }, []);

  useEffect(() => {
    // Initialize PO amount input from data
    if (data.po_amount !== undefined) {
      setPoAmountInput((data.po_amount / 100).toFixed(2));
    }
  }, [data.po_amount]);

  useEffect(() => {
    // Sync local date state with data prop
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

  const loadCompanies = async () => {
    try {
      const fetchedCompanies = await getAllCompanies();
      setCompanies(fetchedCompanies);
    } catch (error) {
      console.error('Error loading companies:', error);
    } finally {
      setIsLoadingCompanies(false);
    }
  };

  const companyOptions = companies.map(company => ({
    value: company.company_id,
    label: company.company_name
  }));

  return (
    <ReflectionContainer id="contract-basics-step">
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
            id="company-select"
            value={data.company_id}
            onValueChange={(value: string) => updateData({ company_id: value })}
            options={companyOptions}
            placeholder={isLoadingCompanies ? "Loading clients..." : "Select a client"}
            disabled={isLoadingCompanies}
            className="w-full"
          />
          {!data.company_id && (
            <p className="text-xs text-gray-500">
              Choose the client this contract is for
            </p>
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
          <p className="text-xs text-gray-500">
            Give this contract a descriptive name
          </p>
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
          <p className="text-xs text-gray-500">
            When does this contract become active?
          </p>
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
        <p className="text-xs text-gray-500">
          Leave blank for an ongoing contract with no end date
        </p>
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description">
          Description (Optional)
        </Label>
        <TextArea
          id="description"
          value={data.description || ''}
          onChange={(e) => updateData({ description: e.target.value })}
          placeholder="Add any additional notes about this contract..."
          className="min-h-[100px] w-full"
        />
        <p className="text-xs text-gray-500">
          Internal notes or contract details
        </p>
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
                <Label htmlFor="po_required" className="text-sm font-medium">
                  Require Purchase Order for invoicing
                </Label>
                <Tooltip content="When enabled, invoices cannot be generated for this contract unless a PO number is provided. This helps ensure compliance with client procurement policies.">
                  <HelpCircle className="h-4 w-4 text-gray-400 cursor-help" />
                </Tooltip>
              </div>
              <p className="text-xs text-gray-500">
                Block invoice generation if PO is not provided
              </p>
            </div>
            <Switch
              id="po_required"
              checked={data.po_required || false}
              onCheckedChange={(checked) => updateData({ po_required: checked })}
            />
          </div>
        </div>

        {/* Show PO fields only when toggle is on */}
        {data.po_required && (
          <div className="space-y-4 pl-4 border-l-2 border-blue-200">
            {/* PO Number */}
            <div className="space-y-2">
              <Label htmlFor="po_number">
                PO Number *
              </Label>
              <Input
                id="po_number"
                type="text"
                value={data.po_number || ''}
                onChange={(e) => updateData({ po_number: e.target.value })}
                placeholder="e.g., PO-2024-12345"
                className="w-full"
              />
              <p className="text-xs text-gray-500">
                Client's purchase order reference number
              </p>
            </div>

            {/* PO Amount */}
            <div className="space-y-2">
              <Label htmlFor="po_amount">
                PO Amount
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                <Input
                  id="po_amount"
                  type="text"
                  inputMode="decimal"
                  value={poAmountInput}
                  onChange={(e) => {
                    const value = e.target.value.replace(/[^0-9.]/g, '');
                    // Allow only one decimal point
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
              <p className="text-xs text-gray-500">
                Total authorized amount on the purchase order
              </p>
            </div>
          </div>
        )}
        </div>

        {/* Summary Card */}
        {data.company_id && data.contract_name && data.start_date && (
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
            <h4 className="text-sm font-semibold text-blue-900 mb-2">Contract Summary</h4>
            <div className="text-sm text-blue-800 space-y-1">
              <p><strong>Client:</strong> {companyOptions.find(c => c.value === data.company_id)?.label}</p>
              <p><strong>Contract:</strong> {data.contract_name}</p>
              <p><strong>Period:</strong> {new Date(data.start_date).toLocaleDateString()}
                {data.end_date ? ` - ${new Date(data.end_date).toLocaleDateString()}` : ' (Ongoing)'}</p>
              {data.po_required && (
                <>
                  <p><strong>PO Required:</strong> Yes</p>
                  {data.po_number && <p><strong>PO Number:</strong> {data.po_number}</p>}
                  {data.po_amount && <p><strong>PO Amount:</strong> ${(data.po_amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </ReflectionContainer>
  );
}
