'use client';

import React, { useState, useEffect } from 'react';
import { Card, Box } from '@radix-ui/themes';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { Switch } from 'server/src/components/ui/Switch';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { Save, Calendar, FileCheck, HelpCircle, Info } from 'lucide-react';
import { IContract } from 'server/src/interfaces/contract.interfaces';
import { updateContract } from 'server/src/lib/actions/contractActions';
import { useTenant } from 'server/src/components/TenantProvider';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { DatePicker } from 'server/src/components/ui/DatePicker';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import { BILLING_FREQUENCY_OPTIONS } from 'server/src/constants/billing';
import { format as formatDateFns, parse as parseDateFns } from 'date-fns';

interface ContractFormProps {
  contract: IContract;
  onContractUpdated: () => void;
}

const ContractForm: React.FC<ContractFormProps> = ({ contract, onContractUpdated }) => {
  const [contractName, setContractName] = useState(contract.contract_name);
  const [description, setDescription] = useState(contract.contract_description ?? '');
  const [isActive, setIsActive] = useState<boolean>(contract.is_active);
  const [billingFrequency, setBillingFrequency] = useState(contract.billing_frequency);
  const [isSaving, setIsSaving] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const tenant = useTenant()!;

  // Helper to parse YYYY-MM-DD strings to Date
  const parseLocalYMD = (ymd?: string | null): Date | undefined => {
    if (!ymd) return undefined;
    const d = parseDateFns(ymd, 'yyyy-MM-dd', new Date());
    return isNaN(d.getTime()) ? undefined : d;
  };

  // New fields from wizard
  const [startDate, setStartDate] = useState<Date | undefined>(parseLocalYMD(contract.start_date));
  const [endDate, setEndDate] = useState<Date | undefined>(parseLocalYMD(contract.end_date));
  const [poRequired, setPoRequired] = useState<boolean>(contract.po_required ?? false);
  const [poNumber, setPoNumber] = useState(contract.po_number ?? '');
  const [poAmountInput, setPoAmountInput] = useState<string>(
    contract.po_amount !== undefined ? (contract.po_amount / 100).toFixed(2) : ''
  );

  // Update state when contract changes
  useEffect(() => {
    setContractName(contract.contract_name);
    setDescription(contract.contract_description ?? '');
    setIsActive(contract.is_active);
    setBillingFrequency(contract.billing_frequency);
    setStartDate(parseLocalYMD(contract.start_date));
    setEndDate(parseLocalYMD(contract.end_date));
    setPoRequired(contract.po_required ?? false);
    setPoNumber(contract.po_number ?? '');
    setPoAmountInput(
      contract.po_amount !== undefined ? (contract.po_amount / 100).toFixed(2) : ''
    );
  }, [contract]);

  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setValidationErrors([]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);

    const errors: string[] = [];
    if (!contractName.trim()) {
      errors.push('Contract name is required');
    }
    if (!billingFrequency) {
      errors.push('Billing frequency is required');
    }
    if (!startDate) {
      errors.push('Start date is required');
    }
    if (poRequired && !poNumber.trim()) {
      errors.push('PO Number is required when PO is marked as required');
    }

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setValidationErrors([]);
    setIsSaving(true);

    try {
      // Parse PO amount
      const poAmountCents = poAmountInput.trim() && poRequired
        ? Math.round(parseFloat(poAmountInput) * 100)
        : undefined;

      await updateContract(contract.contract_id, {
        contract_name: contractName,
        contract_description: description || undefined,
        billing_frequency: billingFrequency,
        is_active: isActive,
        start_date: startDate ? formatDateFns(startDate, 'yyyy-MM-dd') : undefined,
        end_date: endDate ? formatDateFns(endDate, 'yyyy-MM-dd') : undefined,
        po_required: poRequired,
        po_number: poRequired ? (poNumber.trim() || undefined) : undefined,
        po_amount: poAmountCents,
        tenant
      });

      onContractUpdated();
    } catch (error) {
      console.error('Error updating contract:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to update contract';
      setValidationErrors([errorMessage]);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card size="2">
      <Box p="4">
        <form onSubmit={handleSubmit} className="space-y-6" noValidate>
          <h3 className="text-lg font-medium mb-4">Contract Details</h3>

          {hasAttemptedSubmit && validationErrors.length > 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                <p className="font-medium mb-2">Please correct the following errors:</p>
                <ul className="list-disc list-inside space-y-1">
                  {validationErrors.map((err, index) => (
                    <li key={index}>{err}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div>
            <Label htmlFor="contract-name">Contract Name *</Label>
            <Input
              id="contract-name"
              value={contractName}
              onChange={(e) => {
                setContractName(e.target.value);
                clearErrorIfSubmitted();
              }}
              placeholder="Enter contract name"
              required
              className={hasAttemptedSubmit && !contractName.trim() ? 'border-red-500' : ''}
            />
          </div>

          <div>
            <Label htmlFor="billing-frequency">Billing Frequency *</Label>
            <CustomSelect
              id="billing-frequency"
              value={billingFrequency}
              onValueChange={(value) => {
                setBillingFrequency(value);
                clearErrorIfSubmitted();
              }}
              options={BILLING_FREQUENCY_OPTIONS}
              placeholder="Select billing frequency"
              className={hasAttemptedSubmit && !billingFrequency ? 'ring-1 ring-red-500' : ''}
            />
          </div>

          <div>
            <Label htmlFor="start-date" className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Start Date *
            </Label>
            <DatePicker
              id="start-date"
              value={startDate}
              onChange={(date) => {
                setStartDate(date);
                clearErrorIfSubmitted();
              }}
              className={hasAttemptedSubmit && !startDate ? 'ring-1 ring-red-500' : ''}
            />
            <p className="text-xs text-gray-500 mt-1">When does this contract become active?</p>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <Label htmlFor="end-date" className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                End Date (Optional)
              </Label>
              <Tooltip content="Leave blank for ongoing contracts that don't have a fixed end date">
                <HelpCircle className="h-4 w-4 text-gray-400 cursor-help" />
              </Tooltip>
            </div>
            <DatePicker
              id="end-date"
              value={endDate}
              onChange={(date) => setEndDate(date)}
              clearable
            />
            <p className="text-xs text-gray-500 mt-1">Leave blank for an ongoing contract</p>
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <TextArea
              id="description"
              value={description}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
              placeholder="Add any additional notes about this contract..."
              className="min-h-[100px]"
            />
          </div>

          {/* Purchase Order Section */}
          <div className="border-t pt-6 space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <FileCheck className="h-5 w-5 text-gray-700" />
              <h4 className="text-base font-semibold">Purchase Order</h4>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="po-required" className="text-sm font-medium">
                      Require Purchase Order for invoicing
                    </Label>
                    <Tooltip content="When enabled, invoices cannot be generated for this contract unless a PO number is provided">
                      <HelpCircle className="h-4 w-4 text-gray-400 cursor-help" />
                    </Tooltip>
                  </div>
                  <p className="text-xs text-gray-500">Block invoice generation if PO is not provided</p>
                </div>
                <Switch
                  id="po-required"
                  checked={poRequired}
                  onCheckedChange={(checked) => {
                    setPoRequired(checked);
                    clearErrorIfSubmitted();
                  }}
                />
              </div>

              {/* Coming Soon Notice */}
              <div className="flex gap-2 text-xs text-blue-700 bg-blue-50 p-2 rounded border border-blue-100">
                <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                <p>
                  <span className="font-medium">Note:</span> Invoice integration coming soon. You can configure this now and your settings will be saved, but PO enforcement won't be active until a future release.
                </p>
              </div>
            </div>

            {/* PO Fields - shown when toggle is on */}
            {poRequired && (
              <div className="space-y-4 pl-4 border-l-2 border-blue-200">
                <div className="space-y-2">
                  <Label htmlFor="po-number">PO Number *</Label>
                  <Input
                    id="po-number"
                    type="text"
                    value={poNumber}
                    onChange={(e) => {
                      setPoNumber(e.target.value);
                      clearErrorIfSubmitted();
                    }}
                    placeholder="e.g., PO-2024-12345"
                    className={hasAttemptedSubmit && poRequired && !poNumber.trim() ? 'border-red-500' : ''}
                  />
                  <p className="text-xs text-gray-500">Client's purchase order reference number</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="po-amount">PO Amount</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                    <Input
                      id="po-amount"
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
                        } else {
                          const dollars = parseFloat(poAmountInput) || 0;
                          setPoAmountInput(dollars.toFixed(2));
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

          <div className="flex items-center space-x-2 pt-4 border-t">
            <Checkbox
              id="is-active"
              checked={isActive}
              onChange={(checked) => setIsActive(!!checked)}
            />
            <Label htmlFor="is-active" className="cursor-pointer">Active Contract</Label>
          </div>

          <div className="flex justify-end">
            <Button
              id="save-contract-details-btn"
              type="submit"
              disabled={isSaving}
              className={!contractName.trim() || !billingFrequency || !startDate ? 'opacity-50' : ''}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
              {!isSaving && <Save className="ml-2 h-4 w-4" />}
            </Button>
          </div>
        </form>
      </Box>
    </Card>
  );
};

export default ContractForm;
