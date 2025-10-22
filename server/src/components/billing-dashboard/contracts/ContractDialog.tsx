'use client'

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { IContract } from 'server/src/interfaces/contract.interfaces';
import { IContractLine } from 'server/src/interfaces/billing.interfaces';
import { createContract, updateContract, checkClientHasActiveContract } from 'server/src/lib/actions/contractActions';
import { createClientContract } from 'server/src/lib/actions/clientContractActions';
import { getContractLines } from 'server/src/lib/actions/contractLineAction';
import { addContractLine } from 'server/src/lib/actions/contractLineMappingActions';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { DatePicker } from 'server/src/components/ui/DatePicker';
import { Switch } from 'server/src/components/ui/Switch';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import { IClient } from 'server/src/interfaces';
import { getAllClients } from 'server/src/lib/actions/client-actions/clientActions';
import { BILLING_FREQUENCY_OPTIONS } from 'server/src/constants/billing';
import { HelpCircle, Info, Plus, X, ChevronDown, ChevronUp, Search } from 'lucide-react';
import { ClientPicker } from 'server/src/components/clients/ClientPicker';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { getContractLineServicesWithNames } from 'server/src/lib/actions/contractLineServiceActions';
import { IContractLineService } from 'server/src/interfaces/billing.interfaces';

interface ContractLineServiceWithName extends IContractLineService {
  service_name?: string;
}

interface ContractDialogProps {
  onContractSaved: () => void;
  editingContract?: IContract | null;
  onClose?: () => void;
  triggerButton?: React.ReactNode;
}

export function ContractDialog({ onContractSaved, editingContract, onClose, triggerButton }: ContractDialogProps) {
  const [open, setOpen] = useState(false);
  const [contractName, setContractName] = useState(editingContract?.contract_name ?? '');
  const [contractDescription, setContractDescription] = useState(editingContract?.contract_description ?? '');
  const [status, setStatus] = useState<string>(editingContract?.status ?? 'active');
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
  const [clientHasActiveContract, setClientHasActiveContract] = useState(false);
  const [checkingActiveContract, setCheckingActiveContract] = useState(false);
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');

  // Contract lines state
  const [availableContractLines, setAvailableContractLines] = useState<IContractLine[]>([]);
  const [selectedContractLineIds, setSelectedContractLineIds] = useState<Set<string>>(new Set());
  const [isLoadingContractLines, setIsLoadingContractLines] = useState(false);
  const [contractLineSearchTerm, setContractLineSearchTerm] = useState('');
  const [expandedContractLines, setExpandedContractLines] = useState<Record<string, boolean>>({});
  const [contractLineServices, setContractLineServices] = useState<Record<string, ContractLineServiceWithName[]>>({});

  // Load clients and contract lines on mount
  useEffect(() => {
    loadClients();
    loadContractLines();
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

  const loadContractLines = async () => {
    setIsLoadingContractLines(true);
    try {
      const lines = await getContractLines();
      setAvailableContractLines(lines);
    } catch (error) {
      console.error('Error loading contract lines:', error);
    } finally {
      setIsLoadingContractLines(false);
    }
  };

  // Update form when editingContract changes
  useEffect(() => {
    if (editingContract) {
      setContractName(editingContract.contract_name);
      setContractDescription(editingContract.contract_description ?? '');
      setStatus(editingContract.status);
      setOpen(true);
    }
  }, [editingContract]);

  // Check for active contract when client or status changes
  useEffect(() => {
    const checkActiveContract = async () => {
      if (!clientId || status !== 'active') {
        setClientHasActiveContract(false);
        return;
      }

      setCheckingActiveContract(true);
      try {
        const hasActive = await checkClientHasActiveContract(clientId, editingContract?.contract_id);
        setClientHasActiveContract(hasActive);
      } catch (error) {
        console.error('Error checking for active contract:', error);
        setClientHasActiveContract(false);
      } finally {
        setCheckingActiveContract(false);
      }
    };

    checkActiveContract();
  }, [clientId, status, editingContract?.contract_id]);

  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setValidationErrors([]);
    }
  };

  const toggleContractLine = (contractLineId: string) => {
    const newSet = new Set(selectedContractLineIds);
    if (newSet.has(contractLineId)) {
      newSet.delete(contractLineId);
    } else {
      newSet.add(contractLineId);
    }
    setSelectedContractLineIds(newSet);
  };

  const toggleExpandContractLine = async (contractLineId: string) => {
    const isExpanded = expandedContractLines[contractLineId];

    setExpandedContractLines(prev => ({
      ...prev,
      [contractLineId]: !isExpanded
    }));

    // Load services if expanding and not already loaded
    if (!isExpanded && !contractLineServices[contractLineId]) {
      try {
        const servicesWithNames = await getContractLineServicesWithNames(contractLineId);
        setContractLineServices(prev => ({
          ...prev,
          [contractLineId]: servicesWithNames
        }));
      } catch (error) {
        console.error(`Error loading services for contract line ${contractLineId}:`, error);
      }
    }
  };

  const filteredContractLines = availableContractLines.filter((line) => {
    if (!contractLineSearchTerm) return true;
    const search = contractLineSearchTerm.toLowerCase();
    return (
      line.contract_line_name?.toLowerCase().includes(search) ||
      line.billing_frequency?.toLowerCase().includes(search) ||
      line.contract_line_type?.toLowerCase().includes(search) ||
      line.service_category?.toLowerCase().includes(search)
    );
  });

  const handleSubmit = async (e: React.FormEvent, saveAsActive: boolean = true) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);

    // Validate form
    const errors: string[] = [];
    if (!clientId) {
      errors.push('Client');
    }
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

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setValidationErrors([]);

    try {
      // Create the contract template first (without client-specific fields)
      const contractData: Omit<IContract, 'contract_id' | 'tenant' | 'created_at' | 'updated_at'> = {
        contract_name: contractName,
        contract_description: contractDescription || undefined,
        billing_frequency: billingFrequency,
        is_active: saveAsActive,
        status: (saveAsActive ? 'active' : 'draft') as 'active' | 'draft',
      };

      let contract;
      if (editingContract?.contract_id) {
        contract = await updateContract(editingContract.contract_id, contractData);
      } else {
        contract = await createContract(contractData);
      }

      // Add selected contract lines to the contract
      if (contract && selectedContractLineIds.size > 0) {
        await Promise.all(
          Array.from(selectedContractLineIds).map(lineId =>
            addContractLine(contract.contract_id, lineId)
          )
        );
      }

      // Then create the client contract assignment with PO fields
      if (contract && clientId && startDate) {
        await createClientContract({
          client_id: clientId,
          contract_id: contract.contract_id,
          start_date: startDate.toISOString().split('T')[0],
          end_date: endDate ? endDate.toISOString().split('T')[0] : null,
          po_required: poRequired,
          po_number: poRequired ? poNumber : null,
          po_amount: poRequired ? poAmount : null,
        });
      }

      resetForm();
      setOpen(false);
      onContractSaved();
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
    setStatus('active');
    setClientId('');
    setBillingFrequency('monthly');
    setStartDate(null);
    setEndDate(null);
    setPoRequired(false);
    setPoNumber('');
    setPoAmountInput('');
    setPoAmount(undefined);
    setSelectedContractLineIds(new Set());
    setContractLineSearchTerm('');
    setExpandedContractLines({});
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
            setContractName(editingContract.contract_name);
            setContractDescription(editingContract.contract_description ?? '');
            setStatus(editingContract.status);
          }
          setOpen(true);
        }}>
          {triggerButton}
        </div>
      )}
      <Dialog
        isOpen={open || !!editingContract}
        onClose={handleClose}
        title={editingContract ? 'Edit Contract' : 'Quick Add Contract'}
        className="max-w-3xl max-h-[90vh]"
      >
        <DialogContent className="overflow-y-auto max-h-[calc(90vh-120px)]">
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
              <ClientPicker
                id="contract-dialog-client-picker"
                clients={clients}
                selectedClientId={clientId}
                onSelect={(id) => {
                  setClientId(id || '');
                  clearErrorIfSubmitted();
                }}
                filterState={filterState}
                onFilterStateChange={setFilterState}
                clientTypeFilter={clientTypeFilter}
                onClientTypeFilterChange={setClientTypeFilter}
                placeholder="Select a client"
                className="w-full"
              />
              {clientHasActiveContract && status === 'active' && (
                <p className="mt-1 text-sm text-red-600">
                  This client already has an active contract. To create a new active contract, terminate their current contract or save this contract as a draft.
                </p>
              )}
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
                value={startDate ?? undefined}
                onChange={(date) => {
                  setStartDate(date ?? null);
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
                value={endDate ?? undefined}
                onChange={(date) => setEndDate(date ?? null)}
                className="w-full"
              />
            </div>

            {/* Description */}
            <div>
              <Label htmlFor="contract_description">Description (Optional)</Label>
              <TextArea
                id="contract-description"
                value={contractDescription}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setContractDescription(e.target.value)}
                placeholder="Add any additional notes about this contract..."
                className="min-h-[80px]"
              />
            </div>

            {/* Contract Lines Selection */}
            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center gap-2">
                <Label>Contract Lines (Optional)</Label>
                <Tooltip content="Select existing contract lines to include in this contract. You can add more later.">
                  <HelpCircle className="h-4 w-4 text-gray-400 cursor-help" />
                </Tooltip>
              </div>

              {isLoadingContractLines ? (
                <div className="text-sm text-gray-500">Loading contract lines...</div>
              ) : availableContractLines.length === 0 ? (
                <div className="text-sm text-gray-500">No contract lines available. You can add them later.</div>
              ) : (
                <>
                  {/* Search Input */}
                  <div className="relative">
                    <Search
                      className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400"
                      aria-hidden="true"
                    />
                    <Input
                      type="text"
                      placeholder="Search contract lines..."
                      value={contractLineSearchTerm}
                      onChange={(e) => setContractLineSearchTerm(e.target.value)}
                      className="pl-10"
                    />
                  </div>

                  {/* Contract Lines List */}
                  <div className="max-h-64 overflow-y-auto border rounded-md p-2 space-y-1">
                    {filteredContractLines.length === 0 ? (
                      <div className="text-sm text-gray-500 p-2">No contract lines match your search.</div>
                    ) : (
                      filteredContractLines.map((line) => {
                        if (!line.contract_line_id) return null;
                        const isExpanded = expandedContractLines[line.contract_line_id];
                        const services = contractLineServices[line.contract_line_id] || [];

                        return (
                          <div key={line.contract_line_id} className="border rounded">
                            {/* Main row with checkbox and expand button */}
                            <div className="flex items-center gap-2 p-2 hover:bg-gray-50">
                              <Checkbox
                                id={`line-${line.contract_line_id}`}
                                checked={selectedContractLineIds.has(line.contract_line_id)}
                                onChange={() => line.contract_line_id && toggleContractLine(line.contract_line_id)}
                              />
                              <Label
                                htmlFor={`line-${line.contract_line_id}`}
                                className="flex-1 cursor-pointer text-sm"
                              >
                                <div className="font-medium">{line.contract_line_name}</div>
                                <div className="text-xs text-gray-500 mt-0.5">
                                  {line.contract_line_type} • {line.billing_frequency}
                                </div>
                              </Label>
                              <button
                                type="button"
                                onClick={() => line.contract_line_id && toggleExpandContractLine(line.contract_line_id)}
                                className="p-1 hover:bg-gray-200 rounded"
                              >
                                {isExpanded ? (
                                  <ChevronUp className="h-4 w-4 text-gray-600" />
                                ) : (
                                  <ChevronDown className="h-4 w-4 text-gray-600" />
                                )}
                              </button>
                            </div>

                            {/* Expanded details */}
                            {isExpanded && (
                              <div className="px-4 py-2 bg-gray-50 border-t text-xs space-y-2">
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <span className="font-medium text-gray-600">Type:</span>
                                    <span className="ml-1">{line.contract_line_type}</span>
                                  </div>
                                  <div>
                                    <span className="font-medium text-gray-600">Frequency:</span>
                                    <span className="ml-1">{line.billing_frequency}</span>
                                  </div>
                                  {line.service_category && (
                                    <div className="col-span-2">
                                      <span className="font-medium text-gray-600">Category:</span>
                                      <span className="ml-1">{line.service_category}</span>
                                    </div>
                                  )}
                                </div>

                                {/* Services */}
                                <div>
                                  <div className="font-medium text-gray-600 mb-1">Services Included:</div>
                                  {services.length === 0 ? (
                                    <div className="text-gray-500 italic">No services configured</div>
                                  ) : (
                                    <ul className="list-disc list-inside space-y-0.5 text-gray-700">
                                      {services.map((service, idx) => (
                                        <li key={idx}>
                                          {service.service_name || 'Unknown Service'}
                                          {service.quantity && ` (Qty: ${service.quantity})`}
                                          {service.custom_rate && ` - $${(service.custom_rate / 100).toFixed(2)}`}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </>
              )}

              {selectedContractLineIds.size > 0 && (
                <div className="text-sm text-blue-600">
                  {selectedContractLineIds.size} contract line{selectedContractLineIds.size > 1 ? 's' : ''} selected
                </div>
              )}
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
                onClick={(e) => void handleSubmit(e, false)}
                className={!contractName.trim() || !clientId ? 'opacity-50' : ''}
              >
                Save as Draft
              </Button>
              <Button
                id="save-contract-btn"
                type="submit"
                disabled={!contractName.trim() || !clientId || (clientHasActiveContract && status === 'active')}
                className={(!contractName.trim() || !clientId || (clientHasActiveContract && status === 'active')) ? 'opacity-50' : ''}
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
