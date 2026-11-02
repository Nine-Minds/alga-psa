'use client'


import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { IContract } from '@alga-psa/types';
import { createContract, updateContract } from '@alga-psa/billing/actions/contractActions';
import { copyPresetToContractLine } from '@alga-psa/billing/actions/contractLinePresetActions';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { IClient } from '@alga-psa/types';
import { createClientContractForBilling, getAllClientsForBilling } from '@alga-psa/billing/actions/billingClientsActions';
import { useBillingFrequencyOptions } from '@alga-psa/billing/hooks/useBillingEnumOptions';
import { CURRENCY_OPTIONS } from '@alga-psa/core';
import { HelpCircle, Info, Coins } from 'lucide-react';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { BillingProfilePicker } from '@alga-psa/ui/components/BillingProfilePicker';
import { getClientBillingProfilesForBilling } from '@alga-psa/billing/actions/billingProfileActions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { useQuickAddClient } from '@alga-psa/ui/context';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { ContractLinePresetPicker } from './ContractLinePresetPicker';
import { useContractLinePresetSelection } from './useContractLinePresetSelection';

const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

const loadBillingProfiles = (clientId: string) => getClientBillingProfilesForBilling(clientId);

interface ContractDialogProps {
  onContractSaved: () => void;
  editingContract?: IContract | null;
  onClose?: () => void;
  triggerButton?: React.ReactNode;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialClientId?: string;
}

export function ContractDialog({
  onContractSaved,
  editingContract,
  onClose,
  triggerButton,
  isOpen: externalIsOpen,
  onOpenChange: externalOnOpenChange,
  initialClientId,
}: ContractDialogProps) {
  const { t } = useTranslation('msp/contracts');
  const { symbol } = useCurrencyFormat();
  const { renderQuickAddClient } = useQuickAddClient();
  const billingFrequencyOptions = useBillingFrequencyOptions();
  const renewalModeOptions = [
    { value: 'manual', label: t('renewal.modes.manual', { defaultValue: 'Manual renewal' }) },
    { value: 'auto', label: t('renewal.modes.auto', { defaultValue: 'Auto-renew' }) },
    { value: 'none', label: t('renewal.modes.none', { defaultValue: 'Non-renewing' }) },
  ];

  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = externalIsOpen !== undefined;
  const open = isControlled ? externalIsOpen : internalOpen;
  const setOpen = (next: boolean) => {
    if (isControlled) {
      externalOnOpenChange?.(next);
    } else {
      setInternalOpen(next);
    }
  };
  const [contractName, setContractName] = useState(editingContract?.contract_name ?? '');
  const [contractDescription, setContractDescription] = useState(editingContract?.contract_description ?? '');
  const [status, setStatus] = useState<string>(editingContract?.status ?? 'active');
  const [clientId, setClientId] = useState<string>(initialClientId ?? '');
  const [billingProfileId, setBillingProfileId] = useState<string | null>(null);
  const [billingFrequency, setBillingFrequency] = useState<string>('monthly');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [renewalMode, setRenewalMode] = useState<'none' | 'manual' | 'auto'>('manual');
  const [useTenantRenewalDefaults, setUseTenantRenewalDefaults] = useState<boolean>(true);
  const [noticePeriodDays, setNoticePeriodDays] = useState<string>('30');
  const [renewalTermMonths, setRenewalTermMonths] = useState<string>('');
  const [poRequired, setPoRequired] = useState<boolean>(false);
  const [poNumber, setPoNumber] = useState<string>('');
  const [poAmountInput, setPoAmountInput] = useState<string>('');
  const [poAmount, setPoAmount] = useState<number | undefined>(undefined);
  const [clients, setClients] = useState<IClient[]>([]);
  const [isLoadingClients, setIsLoadingClients] = useState(true);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [isQuickAddClientOpen, setIsQuickAddClientOpen] = useState(false);

  // Contract line preset selection, rate editing and overrides (shared with
  // AddContractLinesDialog).
  const presetSelection = useContractLinePresetSelection({
    onActionError: (message) => setValidationErrors([message]),
  });
  const {
    availablePresets: availableContractLinePresets,
    isLoading: isLoadingContractLinePresets,
    selectedPresetIds: selectedContractLinePresetIds,
    buildPresetOverrides,
    reset: resetPresetSelection,
  } = presetSelection;

  // Load clients and contract line presets when the dialog opens
  useEffect(() => {
    if (open) {
      void Promise.all([loadClients(), presetSelection.loadPresets()]);
      if (initialClientId) {
        setClientId(initialClientId);
      }
    }
  }, [open, initialClientId]);

  const loadClients = async () => {
    try {
      const fetchedClients = await getAllClientsForBilling();
      if (isReturnedActionError(fetchedClients)) {
        setValidationErrors([getErrorMessage(fetchedClients)]);
        setClients([]);
        return;
      }
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
      setContractName(editingContract.contract_name);
      setContractDescription(editingContract.contract_description ?? '');
      setStatus(editingContract.status);
      setOpen(true);
    }
  }, [editingContract]);

  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setValidationErrors([]);
    }
  };

  const handleSubmit = async (e: React.FormEvent, saveAsActive: boolean = true) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);

    // Validate form
    const errors: string[] = [];
    if (!clientId) {
      errors.push(t('contractDialog.validation.client', { defaultValue: 'Client' }));
    }
    if (!contractName.trim()) {
      errors.push(t('contractDialog.validation.contractName', { defaultValue: 'Contract name' }));
    }
    if (!billingFrequency) {
      errors.push(t('contractDialog.validation.billingFrequency', { defaultValue: 'Billing frequency' }));
    }
    if (!startDate) {
      errors.push(t('contractDialog.validation.startDate', { defaultValue: 'Start date' }));
    }
    if (poRequired && !poNumber.trim()) {
      errors.push(t('contractDialog.validation.poNumberRequired', {
        defaultValue: 'PO number (required when PO is enabled)',
      }));
    }

    const parsedNoticePeriodDays = noticePeriodDays.trim()
      ? Number.parseInt(noticePeriodDays.trim(), 10)
      : undefined;
    if (
      !useTenantRenewalDefaults &&
      parsedNoticePeriodDays !== undefined &&
      (!Number.isFinite(parsedNoticePeriodDays) || parsedNoticePeriodDays < 0)
    ) {
      errors.push(t('contractDialog.validation.noticePeriodInvalid', {
        defaultValue: 'Notice period days must be a non-negative whole number',
      }));
    }

    const parsedRenewalTermMonths = renewalTermMonths.trim()
      ? Number.parseInt(renewalTermMonths.trim(), 10)
      : undefined;
    if (!useTenantRenewalDefaults && renewalMode === 'auto') {
      if (
        parsedRenewalTermMonths === undefined ||
        !Number.isFinite(parsedRenewalTermMonths) ||
        parsedRenewalTermMonths <= 0
      ) {
        errors.push(t('contractDialog.validation.renewalTermInvalid', {
          defaultValue: 'Renewal term months must be a positive whole number for auto-renew contracts',
        }));
      }
    }

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setValidationErrors([]);

    try {
      // Get currency code from client or editing contract
      const currencyCode = resolvedContractCurrency;

      // Create the contract (without client-specific fields)
      const contractData: Omit<IContract, 'contract_id' | 'tenant' | 'created_at' | 'updated_at'> = {
        contract_name: contractName,
        contract_description: contractDescription || undefined,
        owner_client_id: clientId,
        billing_frequency: billingFrequency,
        is_active: saveAsActive,
        status: (saveAsActive ? 'active' : 'draft') as 'active' | 'draft',
        is_template: false,
        currency_code: currencyCode,
      };

      let contract: IContract | null = null;
      if (editingContract?.contract_id) {
        contract = await updateContract(editingContract.contract_id, contractData);
      } else {
        contract = await createContract(contractData);
      }
      if (isReturnedActionError(contract)) {
        setValidationErrors([getErrorMessage(contract)]);
        return;
      }

      // Add selected contract line presets to the contract (copy them into actual contract lines)
      if (contract && selectedContractLinePresetIds.size > 0) {
        const copyResults = await Promise.all(
          Array.from(selectedContractLinePresetIds).map(presetId =>
            copyPresetToContractLine(contract!.contract_id, presetId, buildPresetOverrides(presetId))
          )
        );
        const expectedCopyError = copyResults.find(isReturnedActionError);
        if (expectedCopyError) {
          setValidationErrors([getErrorMessage(expectedCopyError)]);
          return;
        }
      }

      // Then create the client contract assignment with PO fields
      if (contract && clientId && startDate) {
        const assignmentResult = await createClientContractForBilling({
          client_id: clientId,
          contract_id: contract.contract_id,
          billing_profile_id: billingProfileId,
          start_date: startDate.toISOString().split('T')[0],
          end_date: endDate ? endDate.toISOString().split('T')[0] : null,
          is_active: saveAsActive,
          use_tenant_renewal_defaults: useTenantRenewalDefaults,
          renewal_mode: useTenantRenewalDefaults ? undefined : renewalMode,
          notice_period_days:
            !useTenantRenewalDefaults && renewalMode !== 'none' ? parsedNoticePeriodDays : undefined,
          renewal_term_months:
            !useTenantRenewalDefaults && renewalMode === 'auto' ? parsedRenewalTermMonths : undefined,
          po_required: poRequired,
          po_number: poRequired ? poNumber : null,
          po_amount: poRequired ? poAmount : null,
        });
        if (isReturnedActionError(assignmentResult)) {
          setValidationErrors([getErrorMessage(assignmentResult)]);
          return;
        }
      }

      resetForm();
      setOpen(false);
      onContractSaved();
      if (onClose) {
        onClose();
      }
    } catch (error) {
      console.error('Error saving contract:', error);
      const errorMessage = error instanceof Error
        ? error.message
        : t('contractDialog.validation.failedToSave', { defaultValue: 'Failed to save contract' });
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
    setRenewalMode('manual');
    setUseTenantRenewalDefaults(true);
    setNoticePeriodDays('30');
    setRenewalTermMonths('');
    setPoRequired(false);
    setPoNumber('');
    setPoAmountInput('');
    setPoAmount(undefined);
    resetPresetSelection();
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

  // LEVERAGE: pattern contract-currency-resolution — contract currency falls back to client default then USD; repeated across dialogs
  const resolvedContractCurrency =
    editingContract?.currency_code ||
    clients.find(c => c.client_id === clientId)?.default_currency_code ||
    'USD';

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
        title={editingContract
          ? t('contractDialog.title.edit', { defaultValue: 'Edit Contract' })
          : t('contractDialog.title.create', { defaultValue: 'Create Contract' })}
        className="max-w-3xl max-h-[90vh]"
        disableFocusTrap
        footer={(
          <div className="flex justify-end space-x-2">
            <Button
              id="cancel-contract-btn"
              type="button"
              variant="outline"
              onClick={handleClose}
            >
              {t('common.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              id="save-draft-btn"
              type="button"
              variant="secondary"
              onClick={(e) => void handleSubmit(e, false)}
              className={!contractName.trim() || !clientId ? 'opacity-50' : ''}
            >
              {t('contractDialog.actions.saveAsDraft', { defaultValue: 'Save as Draft' })}
            </Button>
            <Button
              id="save-contract-btn"
              type="button"
              onClick={() => (document.getElementById('contract-dialog-form') as HTMLFormElement | null)?.requestSubmit()}
              disabled={!contractName.trim() || !clientId}
              className={(!contractName.trim() || !clientId) ? 'opacity-50' : ''}
            >
              {editingContract
                ? t('contractDialog.actions.updateContract', { defaultValue: 'Update Contract' })
                : t('contractDialog.actions.createContract', { defaultValue: 'Create Contract' })}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <form id="contract-dialog-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
            {hasAttemptedSubmit && validationErrors.length > 0 && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>
                  <p className="font-medium mb-2">
                    {t('contractDialog.validation.requiredFields', {
                      defaultValue: 'Please fill in the required fields:',
                    })}
                  </p>
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
              <Label htmlFor="client">
                {t('contractDialog.form.clientLabel', { defaultValue: 'Client *' })}
              </Label>
              <ClientPicker
                id="contract-dialog-client-picker"
                clients={clients}
                selectedClientId={clientId}
                onSelect={(id) => {
                  setClientId(id || '');
                  // Profiles belong to one client; a stale pick would be rejected on save.
                  setBillingProfileId(null);
                  clearErrorIfSubmitted();
                }}
                filterState={filterState}
                onFilterStateChange={setFilterState}
                clientTypeFilter={clientTypeFilter}
                onClientTypeFilterChange={setClientTypeFilter}
                placeholder={t('contractDialog.form.clientPlaceholder', {
                  defaultValue: 'Select a client',
                })}
                className="w-full"
                onAddNew={() => setIsQuickAddClientOpen(true)}
              />
            </div>

            {/* Billing profile — rendered only for a segmented client, and only
                while creating: this dialog edits the contract, not the client
                assignment that carries the profile, so on edit the profile is
                changed on the contract's client-assignment card instead. */}
            {!editingContract && (
            <BillingProfilePicker
              id="contract-dialog-billing-profile"
              clientId={clientId || null}
              loadProfiles={loadBillingProfiles}
              value={billingProfileId}
              onChange={setBillingProfileId}
              label={t('contractDialog.form.billingProfileLabel', { defaultValue: 'Billing Profile' })}
              unassignedLabel={t('contractDialog.form.billingProfileNone', {
                defaultValue: "Use the client's default profile",
              })}
              hint={t('contractDialog.form.billingProfileHint', {
                defaultValue: 'Charges from this contract are billed to this profile.',
              })}
            />
            )}

            {/* Contract Name */}
            <div>
              <Label htmlFor="contract-name">
                {t('contractDialog.form.contractNameLabel', { defaultValue: 'Contract Name *' })}
              </Label>
              <Input
                id="contract-name"
                type="text"
                value={contractName}
                onChange={(e) => {
                  setContractName(e.target.value);
                  clearErrorIfSubmitted();
                }}
                placeholder={t('contractDialog.form.contractNamePlaceholder', {
                  defaultValue: 'e.g., Standard MSP Services',
                })}
                required
                className={hasAttemptedSubmit && !contractName.trim() ? 'border-red-500' : ''}
              />
            </div>

            {/* Billing Frequency */}
            <div>
              <Label htmlFor="billing-frequency">
                {t('contractDialog.form.billingFrequencyLabel', { defaultValue: 'Billing Frequency *' })}
              </Label>
              <CustomSelect
                id="billing-frequency"
                options={billingFrequencyOptions}
                onValueChange={(value: string) => {
                  setBillingFrequency(value);
                  clearErrorIfSubmitted();
                }}
                value={billingFrequency}
                placeholder={t('contractDialog.form.billingFrequencyPlaceholder', {
                  defaultValue: 'Select billing frequency',
                })}
                className="w-full"
              />
            </div>

            {/* Currency */}
            <div>
              <Label htmlFor="currency" className="flex items-center gap-2">
                <Coins className="h-4 w-4" />
                {t('common.labels.currency', { defaultValue: 'Currency' })}
              </Label>
              {clientId ? (
                <>
                  <div className="flex items-center h-10 px-3 bg-muted border rounded-md text-sm">
                    {(() => {
                      const selectedClient = clients.find(c => c.client_id === clientId);
                      const currencyCode = selectedClient?.default_currency_code || 'USD';
                      const currencyOption = CURRENCY_OPTIONS.find(c => c.value === currencyCode);
                      return currencyOption?.label || currencyCode;
                    })()}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('contractDialog.form.currencyHint', {
                      defaultValue: 'Currency is based on the client\'s default currency setting.',
                    })}
                  </p>
                </>
              ) : (
                <div className="flex items-center h-10 px-3 bg-muted border border-border rounded-md text-sm text-muted-foreground">
                  {t('contractDialog.form.selectClientFirst', { defaultValue: 'Select a client first' })}
                </div>
              )}
            </div>

            {/* Start Date */}
            <div>
              <Label htmlFor="start_date">
                {t('contractDialog.form.startDateLabel', { defaultValue: 'Start Date *' })}
              </Label>
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
                <Label htmlFor="end_date">
                  {t('contractDialog.form.endDateLabel', { defaultValue: 'End Date (Optional)' })}
                </Label>
                <Tooltip content={t('contractDialog.form.endDateHint', {
                  defaultValue: 'Leave blank for ongoing contracts that don\'t have a fixed end date.',
                })}>
                  <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                </Tooltip>
              </div>
              <DatePicker
                value={endDate ?? undefined}
                onChange={(date) => setEndDate(date ?? null)}
                className="w-full"
              />
            </div>

            <div className="border rounded-md p-4 space-y-3 bg-[rgb(var(--color-border-50))]">
              <div>
                <h4 className="text-sm font-semibold">
                  {t('contractDialog.form.renewalSettingsTitle', { defaultValue: 'Renewal Settings' })}
                </h4>
                <p className="text-xs text-muted-foreground">
                  {t('contractDialog.form.renewalSettingsDescription', {
                    defaultValue: 'Configure renewal behavior for this client contract assignment.',
                  })}
                </p>
              </div>

              <div className="flex items-center justify-between rounded-md border border-[rgb(var(--color-border-200))] p-3">
                <div className="space-y-1">
                  <Label htmlFor="quick-add-use-tenant-renewal-defaults" className="text-xs font-medium">
                    {t('contractDialog.form.useTenantDefaultsLabel', {
                      defaultValue: 'Use Tenant Renewal Defaults',
                    })}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t('contractDialog.form.useTenantDefaultsDescription', {
                      defaultValue: 'Apply organization-level renewal mode and notice period settings.',
                    })}
                  </p>
                </div>
                <Switch
                  id="quick-add-use-tenant-renewal-defaults"
                  checked={useTenantRenewalDefaults}
                  onCheckedChange={setUseTenantRenewalDefaults}
                />
              </div>

              {!useTenantRenewalDefaults && (
                <div className="space-y-2">
                  <Label htmlFor="quick-add-renewal-mode">
                    {t('renewal.labels.mode', { defaultValue: 'Renewal Mode' })}
                  </Label>
                  <CustomSelect
                    id="quick-add-renewal-mode"
                    options={renewalModeOptions}
                    value={renewalMode}
                    onValueChange={(value: string) => setRenewalMode(value as 'none' | 'manual' | 'auto')}
                    placeholder={t('contractDialog.form.renewalModePlaceholder', {
                      defaultValue: 'Select renewal mode',
                    })}
                    className="w-full"
                  />
                </div>
              )}

              {!useTenantRenewalDefaults && renewalMode !== 'none' && (
                <div className="space-y-2">
                  <Label htmlFor="quick-add-notice-period-days">
                    {t('contractDialog.form.noticePeriodLabel', { defaultValue: 'Notice Period (Days)' })}
                  </Label>
                  <Input
                    id="quick-add-notice-period-days"
                    type="number"
                    min={0}
                    step={1}
                    value={noticePeriodDays}
                    onChange={(e) => setNoticePeriodDays(e.target.value)}
                    placeholder={t('contractDialog.form.noticePeriodPlaceholder', {
                      defaultValue: 'e.g., 30',
                    })}
                  />
                </div>
              )}

              {!useTenantRenewalDefaults && renewalMode === 'auto' && (
                <div className="space-y-2">
                  <Label htmlFor="quick-add-renewal-term-months">
                    {t('contractDialog.form.renewalTermLabel', { defaultValue: 'Renewal Term (Months)' })}
                  </Label>
                  <Input
                    id="quick-add-renewal-term-months"
                    type="number"
                    min={1}
                    step={1}
                    value={renewalTermMonths}
                    onChange={(e) => setRenewalTermMonths(e.target.value)}
                    placeholder={t('contractDialog.form.renewalTermPlaceholder', {
                      defaultValue: 'e.g., 12',
                    })}
                  />
                </div>
              )}
            </div>

            {/* Description */}
            <div>
              <Label htmlFor="contract_description">
                {t('contractDialog.form.descriptionLabel', { defaultValue: 'Description (Optional)' })}
              </Label>
              <TextArea
                id="contract-description"
                value={contractDescription}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setContractDescription(e.target.value)}
                placeholder={t('contractDialog.form.descriptionPlaceholder', {
                  defaultValue: 'Add any additional notes about this contract...',
                })}
                className="min-h-[80px]"
              />
            </div>

            {/* Contract Line Presets Selection */}
            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center gap-2">
                <Label>
                  {t('contractDialog.presets.heading', { defaultValue: 'Contract Line Presets (Optional)' })}
                </Label>
                <Tooltip content={t('contractDialog.presets.headingTooltip', {
                  defaultValue: 'Select contract line presets to copy into this contract. You can add more later.',
                })}>
                  <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                </Tooltip>
              </div>

              {isLoadingContractLinePresets ? (
                <div className="text-sm text-muted-foreground">
                  {t('contractDialog.presets.loading', { defaultValue: 'Loading contract line presets...' })}
                </div>
              ) : availableContractLinePresets.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  {t('contractDialog.presets.empty', {
                    defaultValue: 'No contract line presets available. You can add them later.',
                  })}
                </div>
              ) : (
                <ContractLinePresetPicker
                  selection={presetSelection}
                  currencyCode={resolvedContractCurrency}
                  typeFilterId="contract-line-preset-type-filter"
                  resetFiltersId="clear-preset-filters-button"
                  filtersClassName="flex flex-wrap items-center gap-2 mb-3"
                  listClassName="max-h-64 overflow-y-auto border rounded-md p-2 space-y-1"
                  labels={{
                    searchPlaceholder: t('contractDialog.presets.searchPlaceholder', {
                      defaultValue: 'Search contract line presets...',
                    }),
                    noneAvailable: t('contractDialog.presets.empty', {
                      defaultValue: 'No contract line presets available. You can add them later.',
                    }),
                    noMatches: t('contractDialog.presets.noMatches', {
                      defaultValue: 'No contract line presets match your search.',
                    }),
                  }}
                />
              )}

              {selectedContractLinePresetIds.size > 0 && (
                <div className="text-sm text-primary-600">
                  {selectedContractLinePresetIds.size === 1
                    ? t('contractDialog.presets.selectedSingle', {
                      count: selectedContractLinePresetIds.size,
                      defaultValue: '{{count}} contract line preset selected',
                    })
                    : t('contractDialog.presets.selectedPlural', {
                      count: selectedContractLinePresetIds.size,
                      defaultValue: '{{count}} contract line presets selected',
                    })}
                </div>
              )}
            </div>

            {/* Purchase Order Section */}
            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="po_required" className="text-sm font-medium">
                      {t('contractDialog.po.requirePurchaseOrder', {
                        defaultValue: 'Require Purchase Order',
                      })}
                    </Label>
                    <Tooltip content={t('contractDialog.po.requirePurchaseOrderTooltip', {
                      defaultValue: 'When enabled, invoices cannot be generated for this contract unless a PO number is provided.',
                    })}>
                      <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
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
                <Alert variant="info">
                  <Info className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    <span className="font-medium">
                      {t('contractDialog.po.noteLabel', { defaultValue: 'Note:' })}
                    </span>{' '}
                    {t('contractDialog.po.comingSoon', {
                      defaultValue: 'Invoice integration coming soon. Settings will be saved but PO enforcement won\'t be active until a future release.',
                    })}
                  </AlertDescription>
                </Alert>
              )}

              {/* PO Fields */}
              {poRequired && (
                <div className="space-y-3 pl-4 border-l-2 border-blue-200">
                  <div>
                    <Label htmlFor="po_number">
                      {t('contractDialog.po.numberLabel', { defaultValue: 'PO Number *' })}
                    </Label>
                    <Input
                      id="po_number"
                      type="text"
                      value={poNumber}
                      onChange={(e) => {
                        setPoNumber(e.target.value);
                        clearErrorIfSubmitted();
                      }}
                      placeholder={t('contractDialog.po.numberPlaceholder', {
                        defaultValue: 'e.g., PO-2024-12345',
                      })}
                      className="w-full"
                    />
                  </div>

                  <div>
                    <Label htmlFor="po_amount">
                      {t('contractDialog.po.amountLabel', { defaultValue: 'PO Amount (Optional)' })}
                    </Label>
                    <Input
                      leadingAdornment={symbol(resolvedContractCurrency)}
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
                      placeholder={t('contractDialog.po.amountPlaceholder', { defaultValue: '0.00' })}
                    />
                  </div>
                </div>
              )}
            </div>

          </form>
        </DialogContent>
      </Dialog>
      {renderQuickAddClient({
        open: isQuickAddClientOpen,
        onOpenChange: setIsQuickAddClientOpen,
        onClientAdded: (newClient) => {
          setClients((currentClients) => {
            const existingIndex = currentClients.findIndex(
              (client) => client.client_id === newClient.client_id,
            );
            if (existingIndex === -1) return [...currentClients, newClient];
            const nextClients = [...currentClients];
            nextClients[existingIndex] = newClient;
            return nextClients;
          });
          setClientId(newClient.client_id);
          clearErrorIfSubmitted();
        },
        skipSuccessDialog: true,
      })}
    </>
  );
}
