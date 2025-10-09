'use client'

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { DatePicker } from 'server/src/components/ui/DatePicker';
import { Switch } from 'server/src/components/ui/Switch';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import { IPlanBundle } from 'server/src/interfaces/planBundle.interfaces';
import { IClient } from 'server/src/interfaces';
import { createPlanBundle, updatePlanBundle } from 'server/src/lib/actions/planBundleActions';
import { getAllClients } from 'server/src/lib/actions/client-actions/clientActions';
import { useTenant } from 'server/src/components/TenantProvider';
import { BILLING_FREQUENCY_OPTIONS } from 'server/src/constants/billing';
import { HelpCircle, Info } from 'lucide-react';

interface ContractDialogProps {
  onContractAdded: () => void;
  editingContract?: IPlanBundle | null;
  onClose?: () => void;
  triggerButton?: React.ReactNode;
}

export function ContractDialog({ onContractAdded, editingContract, onClose, triggerButton }: ContractDialogProps) {
  const [open, setOpen] = useState(false);
  const [contractName, setContractName] = useState(editingContract?.bundle_name || '');
  const [contractDescription, setContractDescription] = useState(editingContract?.bundle_description || '');
  const [clientId, setClientId] = useState<string>('');
  const [billingFrequency, setBillingFrequency] = useState<string>('monthly');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [poRequired, setPoRequired] = useState<boolean>(false);
  const [poNumber, setPoNumber] = useState<string>('');
  const [poAmountInput, setPoAmountInput] = useState<string>('');
  const [poAmount, setPoAmount] = useState<number | undefined>(undefined);
  const [clients, setClients] = useState<IClient[]>([]);
  const [isLoadingClients, setIsLoadingClients] = useState(true);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const tenant = useTenant()!;

  // Load clients on mount
  useEffect(() => {
    loadClients();
  }, []);

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

  // Update form when editingContract changes
  useEffect(() => {
    if (editingContract) {
      setContractName(editingContract.bundle_name);
      setContractDescription(editingContract.bundle_description || '');
      setOpen(true);
    }
  }, [editingContract]);

  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setValidationErrors([]);
    }
  };

  const handleSubmit = async (e: React.FormEvent, saveAsDraft: boolean = false) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);

    // Validate form
    const errors: string[] = [];
    if (!clientId) {
      errors.push('Client');
    }

    // For drafts, only client is required
    if (!saveAsDraft) {
      if (!contractName.trim()) {
        errors.push('Contract name');
      }
      if (!billingFrequency) {
        errors.push('Billing frequency');
      }
      if (!startDate) {
        errors.push('Start date');
      }
      if (poRequired && !poNumber.trim()) {
        errors.push('PO number (required when PO is enabled)');
      }
    }

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setValidationErrors([]);

    try {
      // TODO: Update to use full contract creation with client assignment
      // For now, we create the bundle and log the additional data
      const bundleData = {
        bundle_name: contractName || `Draft Contract - ${new Date().toLocaleDateString()}`,
        bundle_description: contractDescription || undefined,
        is_active: !saveAsDraft, // Drafts are inactive
        tenant: tenant
      };

      // Additional contract data that will need to be saved to IClientPlanBundle
      const contractAssignmentData = {
        client_id: clientId,
        billing_frequency: billingFrequency,
        start_date: startDate ? startDate.toISOString().split('T')[0] : '',
        end_date: endDate ? endDate.toISOString().split('T')[0] : null,
        po_required: poRequired,
        po_number: poRequired ? poNumber : null,
        po_amount: poRequired ? poAmount : null,
        is_draft: saveAsDraft,
      };

      console.log('Contract assignment data (will be saved in future):', contractAssignmentData);

      if (editingContract?.bundle_id) {
        await updatePlanBundle(editingContract.bundle_id, bundleData);
      } else {
        await createPlanBundle(bundleData);
        // TODO: Call assignBundleToClient or new comprehensive create endpoint
      }

      // Clear form fields and close dialog
      resetForm();
      setOpen(false);
      onContractAdded();
      if (onClose) {
        onClose();
      }
    } catch (error) {
      console.error('Error saving contract:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to save contract';
      setValidationErrors([errorMessage]);
    }
  };

  const resetForm = () => {
    setContractName('');
    setContractDescription('');
    setClientId('');
    setBillingFrequency('monthly');
    setStartDate(null);
    setEndDate(null);
    setPoRequired(false);
    setPoNumber('');
    setPoAmountInput('');
    setPoAmount(undefined);
    setHasAttemptedSubmit(false);
    setValidationErrors([]);
  };

  const handleClose = () => {
    resetForm();
    setOpen(false);
    if (onClose) {
      onClose();
    }
  };

  return (
    <>
      {triggerButton && (
        <div onClick={() => {
          if (editingContract) {
            setContractName(editingContract.bundle_name);
            setContractDescription(editingContract.bundle_description || '');
          }
          setOpen(true);
        }}>
          {triggerButton}
        </div>
      )}
      <Dialog
        isOpen={open || !!editingContract}
        onClose={handleClose}
        title={editingContract ? 'Edit Contract' : 'Add New Contract'}
        className="max-w-lg"
      >
        <DialogContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {hasAttemptedSubmit && validationErrors.length > 0 && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>
                  <p className="font-medium mb-2">Please fill in the required fields:</p>
                  <ul className="list-disc list-inside space-y-1">
                    {validationErrors.map((err, index) => (
                      <li key={index}>{err}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {/* Client Selection */}
            <div>
              <Label htmlFor="client">Client *</Label>
              <CustomSelect
                value={clientId}
                onValueChange={(value: string) => {
                  setClientId(value);
                  clearErrorIfSubmitted();
                }}
                options={clients.map(client => ({
                  value: client.client_id,
                  label: client.client_name
                }))}
                placeholder={isLoadingClients ? "Loading clients..." : "Select a client"}
                disabled={isLoadingClients}
                className="w-full"
              />
            </div>

            {/* Contract Name */}
            <div>
              <Label htmlFor="contract-name">Contract Name *</Label>
              <Input
                id="contract-name"
                type="text"
                value={contractName}
                onChange={(e) => {
                  setContractName(e.target.value);
                  clearErrorIfSubmitted();
                }}
                placeholder="e.g., Standard MSP Services"
                required
                className={hasAttemptedSubmit && !contractName.trim() ? 'border-red-500' : ''}
              />
            </div>

            {/* Billing Frequency */}
            <div>
              <Label htmlFor="billing-frequency">Billing Frequency *</Label>
              <CustomSelect
                id="billing-frequency"
                options={BILLING_FREQUENCY_OPTIONS}
                onValueChange={(value: string) => {
                  setBillingFrequency(value);
                  clearErrorIfSubmitted();
                }}
                value={billingFrequency}
                placeholder="Select billing frequency"
                className="w-full"
              />
            </div>

            {/* Start Date */}
            <div>
              <Label htmlFor="start_date">Start Date *</Label>
              <DatePicker
                value={startDate}
                onChange={(date) => {
                  setStartDate(date);
                  clearErrorIfSubmitted();
                }}
                className="w-full"
              />
            </div>

            {/* End Date */}
            <div>
              <div className="flex items-center gap-2">
                <Label htmlFor="end_date">End Date (Optional)</Label>
                <Tooltip content="Leave blank for ongoing contracts that don't have a fixed end date.">
                  <HelpCircle className="h-4 w-4 text-gray-400 cursor-help" />
                </Tooltip>
              </div>
              <DatePicker
                value={endDate}
                onChange={(date) => setEndDate(date)}
                className="w-full"
              />
            </div>

            {/* Description */}
            <div>
              <Label htmlFor="contract_description">Description (Optional)</Label>
              <TextArea
                id="contract_description"
                value={contractDescription}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setContractDescription(e.target.value)}
                placeholder="Add any additional notes about this contract..."
                className="min-h-[80px]"
              />
            </div>

            {/* Purchase Order Section */}
            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="po_required" className="text-sm font-medium">
                      Require Purchase Order
                    </Label>
                    <Tooltip content="When enabled, invoices cannot be generated for this contract unless a PO number is provided.">
                      <HelpCircle className="h-4 w-4 text-gray-400 cursor-help" />
                    </Tooltip>
                  </div>
                </div>
                <Switch
                  id="po_required"
                  checked={poRequired}
                  onCheckedChange={setPoRequired}
                />
              </div>

              {/* Coming Soon Notice */}
              {poRequired && (
                <div className="flex gap-2 text-xs text-blue-700 bg-blue-50 p-2 rounded border border-blue-100">
                  <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                  <p>
                    <span className="font-medium">Note:</span> Invoice integration coming soon. Settings will be saved but PO enforcement won't be active until a future release.
                  </p>
                </div>
              )}

              {/* PO Fields */}
              {poRequired && (
                <div className="space-y-3 pl-4 border-l-2 border-blue-200">
                  <div>
                    <Label htmlFor="po_number">PO Number *</Label>
                    <Input
                      id="po_number"
                      type="text"
                      value={poNumber}
                      onChange={(e) => {
                        setPoNumber(e.target.value);
                        clearErrorIfSubmitted();
                      }}
                      placeholder="e.g., PO-2024-12345"
                      className="w-full"
                    />
                  </div>

                  <div>
                    <Label htmlFor="po_amount">PO Amount (Optional)</Label>
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
                            setPoAmount(undefined);
                          } else {
                            const dollars = parseFloat(poAmountInput) || 0;
                            const cents = Math.round(dollars * 100);
                            setPoAmount(cents);
                            setPoAmountInput((cents / 100).toFixed(2));
                          }
                        }}
                        placeholder="0.00"
                        className="pl-7"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                id="cancel-contract-btn"
                type="button"
                variant="outline"
                onClick={handleClose}
              >
                Cancel
              </Button>
              <Button
                id="save-draft-btn"
                type="button"
                variant="secondary"
                onClick={(e) => handleSubmit(e, true)}
                disabled={!clientId}
              >
                Save as Draft
              </Button>
              <Button
                id="save-contract-btn"
                type="submit"
                className={!contractName.trim() || !clientId ? 'opacity-50' : ''}
              >
                {editingContract ? 'Update Contract' : 'Create Contract'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}