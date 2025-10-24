'use client'

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { IContract } from 'server/src/interfaces/contract.interfaces';
import { IContractLinePreset } from 'server/src/interfaces/billing.interfaces';
import { createContract, updateContract, checkClientHasActiveContract } from 'server/src/lib/actions/contractActions';
import { createClientContract } from 'server/src/lib/actions/clientContractActions';
import { getContractLinePresets, copyPresetToContractLine } from 'server/src/lib/actions/contractLinePresetActions';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { DatePicker } from 'server/src/components/ui/DatePicker';
import { Switch } from 'server/src/components/ui/Switch';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import { IClient } from 'server/src/interfaces';
import { getAllClients } from 'server/src/lib/actions/client-actions/clientActions';
import { BILLING_FREQUENCY_OPTIONS, CONTRACT_LINE_TYPE_DISPLAY } from 'server/src/constants/billing';
import { HelpCircle, Info, Plus, X, ChevronDown, ChevronUp, Search } from 'lucide-react';
import { ClientPicker } from 'server/src/components/clients/ClientPicker';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { Badge } from 'server/src/components/ui/Badge';
import { getContractLinePresetServices, getContractLinePresetFixedConfig } from 'server/src/lib/actions/contractLinePresetActions';
import { IContractLinePresetService, IContractLinePresetFixedConfig } from 'server/src/interfaces/billing.interfaces';
import { getServices } from 'server/src/lib/actions/serviceActions';

interface ContractLinePresetServiceWithName extends IContractLinePresetService {
  service_name?: string;
  default_rate?: number;
}

interface PresetServiceOverrides {
  quantity?: number;
  custom_rate?: number;
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

  // Contract line presets state
  const [availableContractLinePresets, setAvailableContractLinePresets] = useState<IContractLinePreset[]>([]);
  const [selectedContractLinePresetIds, setSelectedContractLinePresetIds] = useState<Set<string>>(new Set());
  const [isLoadingContractLinePresets, setIsLoadingContractLinePresets] = useState(false);
  const [contractLinePresetSearchTerm, setContractLinePresetSearchTerm] = useState('');
  const [contractLinePresetTypeFilter, setContractLinePresetTypeFilter] = useState<string>('all');
  const [expandedContractLinePresets, setExpandedContractLinePresets] = useState<Record<string, boolean>>({});
  const [contractLinePresetServices, setContractLinePresetServices] = useState<Record<string, ContractLinePresetServiceWithName[]>>({});
  const [contractLinePresetFixedConfigs, setContractLinePresetFixedConfigs] = useState<Record<string, IContractLinePresetFixedConfig | null>>({});
  const [contractLinePresetServiceCounts, setContractLinePresetServiceCounts] = useState<Record<string, number>>({});

  // Rate overrides for presets (stores in cents)
  const [presetRateOverrides, setPresetRateOverrides] = useState<Record<string, number | null>>({});
  const [presetRateInputs, setPresetRateInputs] = useState<Record<string, string>>({});

  // Service overrides for each preset
  const [presetServiceOverrides, setPresetServiceOverrides] = useState<Record<string, Record<string, PresetServiceOverrides>>>({});
  const [presetServiceInputs, setPresetServiceInputs] = useState<Record<string, Record<string, { quantity: string; rate: string }>>>({});

  // Load clients and contract line presets on mount
  useEffect(() => {
    loadClients();
    loadContractLinePresets();
  }, []);

  // Reload clients when dialog opens
  useEffect(() => {
    if (open) {
      loadClients();
      loadContractLinePresets();
    }
  }, [open]);

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

  const loadContractLinePresets = async () => {
    setIsLoadingContractLinePresets(true);
    try {
      const presets = await getContractLinePresets();
      setAvailableContractLinePresets(presets);

      // Load service counts for each preset
      const counts: Record<string, number> = {};
      await Promise.all(
        presets.map(async (preset) => {
          if (preset.preset_id) {
            try {
              const services = await getContractLinePresetServices(preset.preset_id);
              counts[preset.preset_id] = services.length;
            } catch (error) {
              console.error(`Error loading service count for preset ${preset.preset_id}:`, error);
              counts[preset.preset_id] = 0;
            }
          }
        })
      );
      setContractLinePresetServiceCounts(counts);
    } catch (error) {
      console.error('Error loading contract line presets:', error);
    } finally {
      setIsLoadingContractLinePresets(false);
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

  const toggleContractLinePreset = (presetId: string) => {
    const newSet = new Set(selectedContractLinePresetIds);
    if (newSet.has(presetId)) {
      newSet.delete(presetId);
    } else {
      newSet.add(presetId);
    }
    setSelectedContractLinePresetIds(newSet);
  };

  const toggleExpandContractLinePreset = async (presetId: string) => {
    const isExpanded = expandedContractLinePresets[presetId];

    setExpandedContractLinePresets(prev => ({
      ...prev,
      [presetId]: !isExpanded
    }));

    // Load services and fixed config if expanding and not already loaded
    if (!isExpanded && !contractLinePresetServices[presetId]) {
      try {
        // Load services
        const services = await getContractLinePresetServices(presetId);

        // Load all service details to get names and rates
        const allServices = await getServices(1, 999);
        const serviceMap = new Map(allServices.services.map((s) => [s.service_id, s]));

        // Enhance services with names and default rates
        const enhancedServices: ContractLinePresetServiceWithName[] = services.map(service => {
          const serviceDetails = serviceMap.get(service.service_id);
          return {
            ...service,
            service_name: serviceDetails?.service_name || 'Unknown Service',
            default_rate: serviceDetails?.default_rate || 0
          };
        });

        setContractLinePresetServices(prev => ({
          ...prev,
          [presetId]: enhancedServices
        }));

        // Initialize service input states with current quantities and rates
        const serviceInputs: Record<string, { quantity: string; rate: string }> = {};
        enhancedServices.forEach(service => {
          // Both custom_rate and default_rate are stored in cents in the database
          // If custom_rate exists, use it; otherwise use default_rate
          // Note: custom_rate might come as a string from the database, so we need to convert it
          const customRateValue = service.custom_rate !== undefined && service.custom_rate !== null
            ? (typeof service.custom_rate === 'string' ? parseFloat(service.custom_rate) : service.custom_rate)
            : null;

          const rateInCents = customRateValue !== null
            ? customRateValue
            : (service.default_rate || 0);

          serviceInputs[service.service_id] = {
            quantity: service.quantity?.toString() || '1',
            rate: (rateInCents / 100).toFixed(2)
          };
        });

        setPresetServiceInputs(prev => ({
          ...prev,
          [presetId]: serviceInputs
        }));

        // Load fixed config for Fixed type presets
        const preset = availableContractLinePresets.find(p => p.preset_id === presetId);
        if (preset?.contract_line_type === 'Fixed') {
          const fixedConfig = await getContractLinePresetFixedConfig(presetId);
          setContractLinePresetFixedConfigs(prev => ({
            ...prev,
            [presetId]: fixedConfig
          }));

          // Initialize preset rate input if it has a base_rate
          if (fixedConfig?.base_rate !== null && fixedConfig?.base_rate !== undefined) {
            setPresetRateInputs(prev => ({
              ...prev,
              [presetId]: (fixedConfig.base_rate! / 100).toFixed(2)
            }));
          }
        }
      } catch (error) {
        console.error(`Error loading services for contract line preset ${presetId}:`, error);
      }
    }
  };

  const filteredContractLinePresets = availableContractLinePresets.filter((preset) => {
    // Search filter
    const matchesSearch = !contractLinePresetSearchTerm ||
      preset.preset_name?.toLowerCase().includes(contractLinePresetSearchTerm.toLowerCase()) ||
      preset.billing_frequency?.toLowerCase().includes(contractLinePresetSearchTerm.toLowerCase()) ||
      preset.contract_line_type?.toLowerCase().includes(contractLinePresetSearchTerm.toLowerCase());

    // Type filter
    const matchesType = contractLinePresetTypeFilter === 'all' || preset.contract_line_type === contractLinePresetTypeFilter;

    return matchesSearch && matchesType;
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
      // Create the contract (without client-specific fields)
      const contractData: Omit<IContract, 'contract_id' | 'tenant' | 'created_at' | 'updated_at'> = {
        contract_name: contractName,
        contract_description: contractDescription || undefined,
        billing_frequency: billingFrequency,
        is_active: saveAsActive,
        status: (saveAsActive ? 'active' : 'draft') as 'active' | 'draft',
        is_template: false,
      };

      let contract;
      if (editingContract?.contract_id) {
        contract = await updateContract(editingContract.contract_id, contractData);
      } else {
        contract = await createContract(contractData);
      }

      // Add selected contract line presets to the contract (copy them into actual contract lines)
      if (contract && selectedContractLinePresetIds.size > 0) {
        await Promise.all(
          Array.from(selectedContractLinePresetIds).map(presetId => {
            const overrides: {
              base_rate?: number | null;
              services?: Record<string, { quantity?: number; custom_rate?: number }>;
            } = {};

            // Add base_rate override for Fixed type presets
            if (presetRateOverrides[presetId] !== undefined) {
              overrides.base_rate = presetRateOverrides[presetId];
            }

            // Add service-level overrides (quantity and custom_rate)
            const serviceOverrides = presetServiceOverrides[presetId];
            if (serviceOverrides && Object.keys(serviceOverrides).length > 0) {
              overrides.services = {};
              for (const [serviceId, override] of Object.entries(serviceOverrides)) {
                overrides.services[serviceId] = {
                  quantity: override.quantity,
                  custom_rate: override.custom_rate
                };
              }
            }

            return copyPresetToContractLine(contract.contract_id, presetId, Object.keys(overrides).length > 0 ? overrides : undefined);
          })
        );
      }

      // Then create the client contract assignment with PO fields
      if (contract && clientId && startDate) {
        await createClientContract({
          client_id: clientId,
          contract_id: contract.contract_id,
          start_date: startDate.toISOString().split('T')[0],
          end_date: endDate ? endDate.toISOString().split('T')[0] : null,
          is_active: saveAsActive,
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
    setSelectedContractLinePresetIds(new Set());
    setContractLinePresetSearchTerm('');
    setContractLinePresetTypeFilter('all');
    setExpandedContractLinePresets({});
    setPresetRateOverrides({});
    setPresetRateInputs({});
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

            {/* Contract Line Presets Selection */}
            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center gap-2">
                <Label>Contract Line Presets (Optional)</Label>
                <Tooltip content="Select contract line presets to copy into this contract. You can add more later.">
                  <HelpCircle className="h-4 w-4 text-gray-400 cursor-help" />
                </Tooltip>
              </div>

              {isLoadingContractLinePresets ? (
                <div className="text-sm text-gray-500">Loading contract line presets...</div>
              ) : availableContractLinePresets.length === 0 ? (
                <div className="text-sm text-gray-500">No contract line presets available. You can add them later.</div>
              ) : (
                <>
                  {/* Search and Filter Row */}
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    {/* Search Input */}
                    <div className="relative flex-1 min-w-[200px]">
                      <Search
                        className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400"
                        aria-hidden="true"
                      />
                      <Input
                        type="text"
                        placeholder="Search contract line presets..."
                        value={contractLinePresetSearchTerm}
                        onChange={(e) => setContractLinePresetSearchTerm(e.target.value)}
                        className="pl-10"
                      />
                    </div>

                    {/* Type Filter */}
                    <div className="w-48">
                      <CustomSelect
                        id="contract-line-preset-type-filter"
                        options={[
                          { value: 'all', label: 'All types' },
                          ...Object.entries(CONTRACT_LINE_TYPE_DISPLAY).map(([value, label]) => ({
                            value,
                            label
                          }))
                        ]}
                        value={contractLinePresetTypeFilter}
                        onValueChange={(value) => setContractLinePresetTypeFilter(value)}
                        placeholder="Select type"
                      />
                    </div>

                    {/* Clear filters button */}
                    {(contractLinePresetSearchTerm || contractLinePresetTypeFilter !== 'all') && (
                      <Button
                        id="clear-preset-filters-button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setContractLinePresetSearchTerm('');
                          setContractLinePresetTypeFilter('all');
                        }}
                      >
                        <X className="h-4 w-4 mr-1" />
                        Clear
                      </Button>
                    )}
                  </div>

                  {/* Contract Line Presets List */}
                  <div className="max-h-64 overflow-y-auto border rounded-md p-2 space-y-1">
                    {filteredContractLinePresets.length === 0 ? (
                      <div className="text-sm text-gray-500 p-2">No contract line presets match your search.</div>
                    ) : (
                      filteredContractLinePresets.map((preset) => {
                        if (!preset.preset_id) return null;
                        const isExpanded = expandedContractLinePresets[preset.preset_id];
                        const services = contractLinePresetServices[preset.preset_id] || [];
                        const serviceCount = contractLinePresetServiceCounts[preset.preset_id] || 0;

                        const fixedConfig = contractLinePresetFixedConfigs[preset.preset_id];

                        return (
                          <div key={preset.preset_id} className="border rounded bg-white shadow-sm">
                            {/* Main row - now fully clickable */}
                            <div
                              className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer transition-colors"
                              onClick={() => preset.preset_id && toggleExpandContractLinePreset(preset.preset_id)}
                            >
                              <div
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Checkbox
                                  id={`preset-${preset.preset_id}`}
                                  checked={selectedContractLinePresetIds.has(preset.preset_id)}
                                  onChange={() => preset.preset_id && toggleContractLinePreset(preset.preset_id)}
                                />
                              </div>
                              <div className="flex-1">
                                <div className="font-medium text-sm text-gray-900">{preset.preset_name}</div>
                                <div className="flex items-center gap-2 mt-1">
                                  <Badge
                                    className={
                                      preset.contract_line_type === 'Fixed'
                                        ? 'bg-green-100 text-green-800 border-green-200'
                                        : preset.contract_line_type === 'Hourly'
                                        ? 'bg-purple-100 text-purple-800 border-purple-200'
                                        : preset.contract_line_type === 'Usage'
                                        ? 'bg-indigo-100 text-indigo-800 border-indigo-200'
                                        : 'bg-gray-100 text-gray-800 border-gray-200'
                                    }
                                  >
                                    {preset.contract_line_type}
                                  </Badge>
                                  <span className="text-xs text-gray-600">{preset.billing_frequency}</span>
                                  {serviceCount > 0 && (
                                    <span className="text-xs text-gray-600">• {serviceCount} service{serviceCount !== 1 ? 's' : ''}</span>
                                  )}
                                </div>
                              </div>
                              <div className="text-gray-600">
                                {isExpanded ? (
                                  <ChevronUp className="h-5 w-5" />
                                ) : (
                                  <ChevronDown className="h-5 w-5" />
                                )}
                              </div>
                            </div>

                            {/* Expanded details */}
                            {isExpanded && (
                              <div className="px-5 py-4 bg-gray-50 border-t space-y-4">
                                {/* Fixed Rate Configuration for Fixed type presets */}
                                {preset.contract_line_type === 'Fixed' && (
                                  <div className="bg-white rounded-md p-4 border border-gray-200">
                                    <div className="flex items-center justify-between mb-3">
                                      <Label className="text-sm font-semibold text-gray-900">Fixed Rate Configuration</Label>
                                    </div>
                                    <div className="space-y-2">
                                      <div className="text-sm">
                                        <span className="font-medium text-gray-700">Default Base Rate:</span>
                                        <span className="ml-2 text-gray-900 font-semibold">
                                          {fixedConfig?.base_rate !== null && fixedConfig?.base_rate !== undefined
                                            ? `$${(fixedConfig.base_rate / 100).toFixed(2)}`
                                            : 'Not set'}
                                        </span>
                                      </div>
                                      <div>
                                        <Label htmlFor={`rate-override-${preset.preset_id}`} className="text-sm font-medium text-gray-700">
                                          Override Base Rate
                                        </Label>
                                        <div className="relative mt-1.5">
                                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                                          <Input
                                            id={`rate-override-${preset.preset_id}`}
                                            type="text"
                                            inputMode="decimal"
                                            value={presetRateInputs[preset.preset_id] || ''}
                                            onChange={(e) => {
                                              const value = e.target.value.replace(/[^0-9.]/g, '');
                                              const decimalCount = (value.match(/\./g) || []).length;
                                              if (decimalCount <= 1) {
                                                setPresetRateInputs({
                                                  ...presetRateInputs,
                                                  [preset.preset_id]: value
                                                });
                                              }
                                            }}
                                            onBlur={() => {
                                              const inputValue = presetRateInputs[preset.preset_id] || '';
                                              if (inputValue.trim() === '' || inputValue === '.') {
                                                const newInputs = { ...presetRateInputs };
                                                delete newInputs[preset.preset_id];
                                                setPresetRateInputs(newInputs);

                                                const newOverrides = { ...presetRateOverrides };
                                                delete newOverrides[preset.preset_id];
                                                setPresetRateOverrides(newOverrides);
                                              } else {
                                                const dollars = parseFloat(inputValue) || 0;
                                                const cents = Math.round(dollars * 100);
                                                setPresetRateOverrides({
                                                  ...presetRateOverrides,
                                                  [preset.preset_id]: cents
                                                });
                                                setPresetRateInputs({
                                                  ...presetRateInputs,
                                                  [preset.preset_id]: (cents / 100).toFixed(2)
                                                });
                                              }
                                            }}
                                            placeholder={fixedConfig?.base_rate ? `Default: $${(fixedConfig.base_rate / 100).toFixed(2)}` : 'Enter base rate'}
                                            className="pl-8 h-9 text-sm"
                                          />
                                        </div>
                                        <p className="text-xs text-gray-500 mt-1">
                                          Leave blank to use the default rate
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* Services Configuration */}
                                <div className="bg-white rounded-md p-4 border border-gray-200">
                                  <Label className="text-sm font-semibold text-gray-900 mb-3 block">
                                    {preset.contract_line_type === 'Fixed' ? 'Services Included (Reference)' : 'Services Configuration'}
                                  </Label>
                                  {services.length === 0 ? (
                                    <div className="text-sm text-gray-500 italic">No services configured for this preset</div>
                                  ) : preset.contract_line_type === 'Fixed' ? (
                                    /* For Fixed presets, show services as read-only reference */
                                    <div className="space-y-2">
                                      <p className="text-xs text-gray-600 mb-3">
                                        These services are included for reference only. The fixed rate above determines the billing amount.
                                      </p>
                                      {services.map((service) => (
                                        <div key={service.service_id} className="bg-gray-50 rounded-md p-2 border border-gray-200">
                                          <div className="flex items-center justify-between">
                                            <span className="text-sm text-gray-900">{service.service_name}</span>
                                            {service.quantity && service.quantity > 1 && (
                                              <span className="text-xs text-gray-600">Qty: {service.quantity}</span>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    /* For non-Fixed presets (Hourly/Usage), show editable fields */
                                    <div className="space-y-3">
                                      {services.map((service) => {
                                        // Fallback: calculate rate if not in state yet
                                        // Note: custom_rate might come as a string from the database
                                        const customRateValue = service.custom_rate !== undefined && service.custom_rate !== null
                                          ? (typeof service.custom_rate === 'string' ? parseFloat(service.custom_rate) : service.custom_rate)
                                          : null;

                                        const rateInCents = customRateValue !== null
                                          ? customRateValue
                                          : (service.default_rate || 0);

                                        const serviceInputs = presetServiceInputs[preset.preset_id]?.[service.service_id] || {
                                          quantity: service.quantity?.toString() || '1',
                                          rate: (rateInCents / 100).toFixed(2)
                                        };

                                        return (
                                          <div key={service.service_id} className="bg-gray-50 rounded-md p-3 border border-gray-200">
                                            <div className="font-medium text-sm text-gray-900 mb-2">{service.service_name}</div>
                                            <div className="grid grid-cols-2 gap-3">
                                              <div>
                                                <Label htmlFor={`quantity-${preset.preset_id}-${service.service_id}`} className="text-xs font-medium text-gray-700">
                                                  Quantity
                                                </Label>
                                                <Input
                                                  id={`quantity-${preset.preset_id}-${service.service_id}`}
                                                  type="number"
                                                  min="1"
                                                  step="1"
                                                  value={serviceInputs.quantity}
                                                  onChange={(e) => {
                                                    const newInputs = {
                                                      ...presetServiceInputs,
                                                      [preset.preset_id]: {
                                                        ...(presetServiceInputs[preset.preset_id] || {}),
                                                        [service.service_id]: {
                                                          ...serviceInputs,
                                                          quantity: e.target.value
                                                        }
                                                      }
                                                    };
                                                    setPresetServiceInputs(newInputs);
                                                  }}
                                                  onBlur={() => {
                                                    const quantity = parseInt(serviceInputs.quantity) || 1;
                                                    const newOverrides = {
                                                      ...presetServiceOverrides,
                                                      [preset.preset_id]: {
                                                        ...(presetServiceOverrides[preset.preset_id] || {}),
                                                        [service.service_id]: {
                                                          ...(presetServiceOverrides[preset.preset_id]?.[service.service_id] || {}),
                                                          quantity
                                                        }
                                                      }
                                                    };
                                                    setPresetServiceOverrides(newOverrides);
                                                  }}
                                                  className="h-9 text-sm mt-1"
                                                />
                                              </div>
                                              <div>
                                                <Label htmlFor={`rate-${preset.preset_id}-${service.service_id}`} className="text-xs font-medium text-gray-700">
                                                  Rate (per unit)
                                                </Label>
                                                <div className="relative mt-1">
                                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                                                  <Input
                                                    id={`rate-${preset.preset_id}-${service.service_id}`}
                                                    type="text"
                                                    inputMode="decimal"
                                                    value={serviceInputs.rate}
                                                    onChange={(e) => {
                                                      const value = e.target.value.replace(/[^0-9.]/g, '');
                                                      const decimalCount = (value.match(/\./g) || []).length;
                                                      if (decimalCount <= 1) {
                                                        const newInputs = {
                                                          ...presetServiceInputs,
                                                          [preset.preset_id]: {
                                                            ...(presetServiceInputs[preset.preset_id] || {}),
                                                            [service.service_id]: {
                                                              ...serviceInputs,
                                                              rate: value
                                                            }
                                                          }
                                                        };
                                                        setPresetServiceInputs(newInputs);
                                                      }
                                                    }}
                                                    onBlur={() => {
                                                      const dollars = parseFloat(serviceInputs.rate) || 0;
                                                      const cents = Math.round(dollars * 100);
                                                      const newOverrides = {
                                                        ...presetServiceOverrides,
                                                        [preset.preset_id]: {
                                                          ...(presetServiceOverrides[preset.preset_id] || {}),
                                                          [service.service_id]: {
                                                            ...(presetServiceOverrides[preset.preset_id]?.[service.service_id] || {}),
                                                            custom_rate: cents
                                                          }
                                                        }
                                                      };
                                                      setPresetServiceOverrides(newOverrides);
                                                      const newInputs = {
                                                        ...presetServiceInputs,
                                                        [preset.preset_id]: {
                                                          ...(presetServiceInputs[preset.preset_id] || {}),
                                                          [service.service_id]: {
                                                            ...serviceInputs,
                                                            rate: (cents / 100).toFixed(2)
                                                          }
                                                        }
                                                      };
                                                      setPresetServiceInputs(newInputs);
                                                    }}
                                                    placeholder={(service.default_rate! / 100).toFixed(2)}
                                                    className="pl-8 h-9 text-sm"
                                                  />
                                                </div>
                                                <p className="text-xs text-gray-500 mt-0.5">
                                                  Default: ${(service.default_rate! / 100).toFixed(2)}
                                                </p>
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
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

              {selectedContractLinePresetIds.size > 0 && (
                <div className="text-sm text-primary-600">
                  {selectedContractLinePresetIds.size} contract line preset{selectedContractLinePresetIds.size > 1 ? 's' : ''} selected
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
