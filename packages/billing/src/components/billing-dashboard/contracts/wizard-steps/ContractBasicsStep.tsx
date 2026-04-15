'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Switch } from '@alga-psa/ui/components/Switch';
import { RadioGroup } from '@alga-psa/ui/components/RadioGroup';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { ContractWizardData } from '../ContractWizard';
import { getAllClientsForBilling } from '@alga-psa/billing/actions/billingClientsActions';
import { CURRENCY_OPTIONS, getCurrencySymbol } from '@alga-psa/core';
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
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { IClient } from '@alga-psa/types';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useQuickAddClient } from '@alga-psa/ui/context';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useBillingFrequencyOptions, useFormatBillingFrequency } from '@alga-psa/billing/hooks/useBillingEnumOptions';

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
  const { t } = useTranslation('msp/contracts');
  const { formatCurrency } = useFormatters();
  const billingFrequencyOptions = useBillingFrequencyOptions();
  const formatBillingFrequency = useFormatBillingFrequency();
  const { renderQuickAddClient } = useQuickAddClient();
  const [clients, setClients] = useState<IClient[]>([]);
  const [isLoadingClients, setIsLoadingClients] = useState(true);
  const [poAmountInput, setPoAmountInput] = useState<string>('');
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [startDate, setStartDate] = useState<Date | undefined>(parseLocalYMD(data.start_date));
  const [endDate, setEndDate] = useState<Date | undefined>(parseLocalYMD(data.end_date));
  const [isQuickAddClientOpen, setIsQuickAddClientOpen] = useState(false);

  const currencyMeta = useMemo(() => {
    const currencyCode = data.currency_code || 'USD';
    const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode });
    const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return { currencyCode, fractionDigits, minorUnitFactor: Math.pow(10, fractionDigits) };
  }, [data.currency_code]);
  const currencySymbol = getCurrencySymbol(data.currency_code);

  useEffect(() => {
    const loadClients = async () => {
      try {
        const fetchedClients = await getAllClientsForBilling();
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

  const templateOptions = templates.map((template) => ({
    value: template.contract_id,
    label: template.contract_name,
  }));
  const renewalModeOptions = [
    {
      value: 'none',
      label: t('wizardBasics.renewal.modeOptions.none', { defaultValue: 'No Renewal' }),
    },
    {
      value: 'manual',
      label: t('wizardBasics.renewal.modeOptions.manual', { defaultValue: 'Manual Renewal' }),
    },
    {
      value: 'auto',
      label: t('wizardBasics.renewal.modeOptions.auto', { defaultValue: 'Auto Renew' }),
    },
  ];
  const cadenceOwnerOptions = useMemo(
    () => [
      {
        value: 'client',
        label: t('wizardBasics.cadenceOwner.options.client.label', {
          defaultValue: 'Invoice on client billing schedule',
        }),
        description: t('wizardBasics.cadenceOwner.options.client.description', {
          defaultValue:
            'Use the client billing calendar so recurring lines stay aligned with the client’s normal invoice cadence.',
        }),
      },
      {
        value: 'contract',
        label: t('wizardBasics.cadenceOwner.options.contract.label', {
          defaultValue: 'Invoice on contract anniversary',
        }),
        description: t('wizardBasics.cadenceOwner.options.contract.description', {
          defaultValue:
            'Use contract-anniversary service periods for recurring lines that should follow the contract timeline.',
        }),
      },
    ],
    [t]
  );

  const selectedTemplate = selectedTemplateId
    ? templates.find((template) => template.contract_id === selectedTemplateId)
    : undefined;
  const effectiveRenewalMode = data.renewal_mode ?? 'manual';
  const isRenewalEnabled = effectiveRenewalMode !== 'none';
  const isAutoRenew = effectiveRenewalMode === 'auto';
  const useTenantRenewalDefaults = data.use_tenant_renewal_defaults ?? true;

  return (
    <div className="space-y-6" data-automation-id="contract-basics-step">
      <div className="mb-6 space-y-3">
        <h3 className="text-lg font-semibold">
          {t('wizardBasics.heading', { defaultValue: 'Contract Basics' })}
        </h3>
        <p className="text-sm text-[rgb(var(--color-text-500))]">
          {t('wizardBasics.description', {
            defaultValue: 'Choose a template (optional), select the client, and set foundational contract details. Service details load in the next steps.',
          })}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="contract-template" className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-purple-500" />
          {t('wizardBasics.template.startFromTemplate', { defaultValue: 'Start From Template' })}
        </Label>
        <CustomSelect
          id="contract-template"
          value={selectedTemplateId ?? undefined}
          options={templateOptions}
          onValueChange={(value) => onTemplateSelect(value || null)}
          placeholder={isLoadingTemplates
            ? t('wizardBasics.template.loadingTemplates', { defaultValue: 'Loading templates…' })
            : t('wizardBasics.template.selectTemplateOptional', { defaultValue: 'Select a template (optional)' })}
          disabled={isLoadingTemplates || isTemplateLoading}
          allowClear
        />
        <p className="text-xs text-[rgb(var(--color-text-400))]">
          {t('wizardBasics.template.prefillHint', {
            defaultValue: 'Prefill services, notes, and billing cadence from an existing template. You can still adjust everything before publishing.',
          })}
        </p>
        {isTemplateLoading && (
          <p className="text-xs text-blue-600">
            {t('wizardBasics.template.loadingTemplateDetails', { defaultValue: 'Loading template details…' })}
          </p>
        )}
        {templateError && (
          <p className="text-xs text-red-600">{templateError}</p>
        )}
        {selectedTemplate && (
          <div className="text-xs text-[rgb(var(--color-text-500))] border border-[rgb(var(--color-primary-100))] bg-[rgb(var(--color-primary-50))] rounded-md p-3 mt-2 space-y-1">
            <p>
              <span className="font-semibold text-[rgb(var(--color-primary-700))]">
                {t('wizardBasics.template.preview.templateLabel', { defaultValue: 'Template:' })}
              </span>{' '}
              {selectedTemplate.contract_name}
            </p>
            <p>
              <span className="font-semibold text-[rgb(var(--color-primary-700))]">
                {t('wizardBasics.template.preview.billingCadenceLabel', { defaultValue: 'Billing cadence:' })}
              </span>{' '}
              {selectedTemplate.billing_frequency
                ? selectedTemplate.billing_frequency.replace(/_/g, ' ')
                : t('wizardBasics.template.preview.notSpecified', { defaultValue: 'Not specified' })}
            </p>
            {selectedTemplate.contract_description && (
              <p className="text-[rgb(var(--color-text-600))]">{selectedTemplate.contract_description}</p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="client" className="flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          {t('wizardBasics.client.clientLabel', { defaultValue: 'Client' })} *
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
          placeholder={isLoadingClients
            ? t('wizardBasics.client.loadingClients', { defaultValue: 'Loading clients…' })
            : t('wizardBasics.client.selectClient', { defaultValue: 'Select a client' })}
          className="w-full"
          onAddNew={() => setIsQuickAddClientOpen(true)}
        />
        {renderQuickAddClient({
          open: isQuickAddClientOpen,
          onOpenChange: setIsQuickAddClientOpen,
          onClientAdded: (newClient) => {
            setClients(prev => [...prev, newClient]);
            updateData({ client_id: newClient.client_id });
          },
          skipSuccessDialog: true,
        })}
        {!data.client_id && (
          <p className="text-xs text-[rgb(var(--color-text-400))]">
            {t('wizardBasics.client.chooseClientHint', { defaultValue: 'Choose the client this contract is for.' })}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="contract_name" className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          {t('wizardBasics.contractName.label', { defaultValue: 'Contract Name' })} *
        </Label>
        <Input
          id="contract_name"
          type="text"
          value={data.contract_name}
          onChange={(e) => updateData({ contract_name: e.target.value })}
          placeholder={t('wizardBasics.contractName.placeholder', {
            defaultValue: 'e.g., Standard MSP Services, Premium Support Package',
          })}
          className="w-full"
        />
        <p className="text-xs text-[rgb(var(--color-text-400))]">
          {t('wizardBasics.contractName.hint', { defaultValue: 'Give this contract a descriptive name.' })}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="billing-frequency" className="flex items-center gap-2">
          <Repeat className="h-4 w-4" />
          {t('wizardBasics.billingFrequency.label', { defaultValue: 'Billing Frequency' })} *
        </Label>
        <CustomSelect
          id="billing-frequency"
          options={billingFrequencyOptions}
          onValueChange={(value: string) => updateData({ billing_frequency: value })}
          value={data.billing_frequency}
          placeholder={t('wizardBasics.billingFrequency.placeholder', { defaultValue: 'Select billing frequency' })}
          className="w-full"
        />
        <p className="text-xs text-[rgb(var(--color-text-400))]">
          {t('wizardBasics.billingFrequency.hint', { defaultValue: 'How often should this contract be billed?' })}
        </p>
      </div>

      <div className="space-y-3 border border-[rgb(var(--color-border-200))] rounded-md p-4 bg-[rgb(var(--color-surface-50))]">
        <div>
          <Label className="text-sm font-medium">
            {t('wizardBasics.cadenceOwner.label', { defaultValue: 'Recurring Cadence Default' })}
          </Label>
          <p className="text-xs text-[rgb(var(--color-text-400))] mt-1">
            {t('wizardBasics.cadenceOwner.description', {
              defaultValue: 'Sets the default cadence owner applied to recurring lines created in this wizard.',
            })}
          </p>
        </div>
        <RadioGroup
          id="contract-basics-cadence-owner"
          name="contract-basics-cadence-owner"
          options={cadenceOwnerOptions}
          value={data.cadence_owner ?? 'client'}
          onChange={(value) =>
            updateData({ cadence_owner: value as ContractWizardData['cadence_owner'] })
          }
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="currency" className="flex items-center gap-2">
          <Coins className="h-4 w-4" />
          {t('wizardBasics.currency.label', { defaultValue: 'Currency' })} *
        </Label>
        <CustomSelect
          id="currency"
          options={CURRENCY_OPTIONS.map((c) => ({ value: c.value, label: c.label }))}
          onValueChange={(value: string) => updateData({ currency_code: value })}
          value={data.currency_code}
          placeholder={t('wizardBasics.currency.placeholder', { defaultValue: 'Select currency' })}
          className="w-full"
        />
        <p className="text-xs text-[rgb(var(--color-text-400))]">
          {t('wizardBasics.currency.hint', {
            defaultValue: 'Currency for this contract. Defaults to the client\'s preferred currency.',
          })}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="start_date" className="flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          {t('wizardBasics.dates.startDateLabel', { defaultValue: 'Start Date' })} *
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
        <p className="text-xs text-[rgb(var(--color-text-400))]">
          {t('wizardBasics.dates.startDateHint', { defaultValue: 'When does this contract become active?' })}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="end_date" className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            {t('wizardBasics.dates.endDateLabel', { defaultValue: 'End Date (Optional)' })}
          </Label>
          <Tooltip
            content={t('wizardBasics.dates.endDateTooltip', {
              defaultValue:
                'Leave blank for ongoing contracts that don\'t have a fixed end date. You can always set an end date later when the contract is terminated or expires.',
            })}
          >
            <HelpCircle className="h-4 w-4 text-[rgb(var(--color-text-300))] cursor-help" />
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
          <p className="text-xs text-red-600">
            {t('wizardBasics.dates.endDateAfterStartValidation', { defaultValue: 'End date must be after start date' })}
          </p>
        )}
        {!(endDate && startDate && endDate < startDate) && (
          <p className="text-xs text-[rgb(var(--color-text-400))]">
            {t('wizardBasics.dates.endDateOngoingHint', { defaultValue: 'Leave blank for an ongoing contract.' })}
          </p>
        )}
      </div>

      {data.end_date && (
        <div
          className="border border-[rgb(var(--color-border-200))] rounded-md p-4 space-y-2 bg-[rgb(var(--color-surface-50))]"
          data-automation-id="renewal-settings-fixed-term-card"
        >
          <div className="flex items-center gap-2">
            <Repeat className="h-4 w-4 text-[rgb(var(--color-primary-600))]" />
            <h4 className="text-sm font-semibold">
              {t('wizardBasics.renewal.fixedTerm.title', { defaultValue: 'Renewal Settings' })}
            </h4>
          </div>
          <p className="text-xs text-[rgb(var(--color-text-500))]">
            {t('wizardBasics.renewal.fixedTerm.description', {
              defaultValue: 'This contract has a fixed end date. Configure renewal behavior and notice timing.',
            })}
          </p>
          <div className="flex items-center justify-between rounded-md border border-[rgb(var(--color-border-200))] p-3">
            <div className="space-y-1">
              <Label htmlFor="use-tenant-renewal-defaults-fixed" className="text-xs font-medium">
                {t('wizardBasics.renewal.useTenantDefaultsLabel', { defaultValue: 'Use Tenant Renewal Defaults' })}
              </Label>
              <p className="text-xs text-[rgb(var(--color-text-500))]">
                {t('wizardBasics.renewal.useTenantDefaultsDescription', {
                  defaultValue: 'Apply organization-level renewal settings unless explicitly overridden.',
                })}
              </p>
            </div>
            <Switch
              id="use-tenant-renewal-defaults-fixed"
              checked={useTenantRenewalDefaults}
              onCheckedChange={(checked) =>
                updateData({ use_tenant_renewal_defaults: checked })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="renewal-mode-fixed" className="text-xs font-medium">
              {t('wizardBasics.renewal.modeLabel', { defaultValue: 'Renewal Mode' })}
            </Label>
            <CustomSelect
              id="renewal-mode-fixed"
              options={renewalModeOptions}
              value={effectiveRenewalMode}
              onValueChange={(value: string) =>
                updateData({
                  renewal_mode: value as NonNullable<ContractWizardData['renewal_mode']>,
                })
              }
              placeholder={t('wizardBasics.renewal.modePlaceholder', { defaultValue: 'Select renewal mode' })}
              className="w-full"
            />
          </div>
          {isRenewalEnabled && (
            <div className="space-y-2">
              <Label htmlFor="notice-period-fixed" className="text-xs font-medium">
                {t('wizardBasics.renewal.noticePeriodLabel', { defaultValue: 'Notice Period (Days)' })}
              </Label>
              <Input
                id="notice-period-fixed"
                type="number"
                min={0}
                step={1}
                value={data.notice_period_days ?? ''}
                onChange={(e) => {
                  const nextValue = e.target.value.trim();
                  if (!nextValue) {
                    updateData({ notice_period_days: undefined });
                    return;
                  }
                  const parsed = Number.parseInt(nextValue, 10);
                  updateData({
                    notice_period_days: Number.isFinite(parsed) ? Math.max(0, parsed) : undefined,
                  });
                }}
                placeholder={t('wizardBasics.renewal.noticePeriodPlaceholder', { defaultValue: 'e.g., 30' })}
                className="w-full"
              />
            </div>
          )}
          {isAutoRenew && (
            <div className="space-y-2">
              <Label htmlFor="renewal-term-fixed" className="text-xs font-medium">
                {t('wizardBasics.renewal.termLabel', { defaultValue: 'Renewal Term (Months)' })}
              </Label>
              <Input
                id="renewal-term-fixed"
                type="number"
                min={1}
                step={1}
                value={data.renewal_term_months ?? ''}
                onChange={(e) => {
                  const nextValue = e.target.value.trim();
                  if (!nextValue) {
                    updateData({ renewal_term_months: undefined });
                    return;
                  }
                  const parsed = Number.parseInt(nextValue, 10);
                  updateData({
                    renewal_term_months:
                      Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
                  });
                }}
                placeholder={t('wizardBasics.renewal.termPlaceholder', { defaultValue: 'e.g., 12' })}
                className="w-full"
              />
            </div>
          )}
        </div>
      )}

      {!data.end_date && (
        <div
          className="border border-[rgb(var(--color-border-200))] rounded-md p-4 space-y-2 bg-[rgb(var(--color-surface-50))]"
          data-automation-id="renewal-settings-evergreen-card"
        >
          <div className="flex items-center gap-2">
            <Repeat className="h-4 w-4 text-[rgb(var(--color-primary-600))]" />
            <h4 className="text-sm font-semibold">
              {t('wizardBasics.renewal.evergreen.title', { defaultValue: 'Evergreen Review Settings' })}
            </h4>
          </div>
          <p className="text-xs text-[rgb(var(--color-text-500))]">
            {t('wizardBasics.renewal.evergreen.description', {
              defaultValue: 'This contract is ongoing. Configure annual review cadence and notice timing.',
            })}
          </p>
          <div className="flex items-center justify-between rounded-md border border-[rgb(var(--color-border-200))] p-3">
            <div className="space-y-1">
              <Label htmlFor="use-tenant-renewal-defaults-evergreen" className="text-xs font-medium">
                {t('wizardBasics.renewal.useTenantDefaultsLabel', { defaultValue: 'Use Tenant Renewal Defaults' })}
              </Label>
              <p className="text-xs text-[rgb(var(--color-text-500))]">
                {t('wizardBasics.renewal.useTenantDefaultsDescription', {
                  defaultValue: 'Apply organization-level renewal settings unless explicitly overridden.',
                })}
              </p>
            </div>
            <Switch
              id="use-tenant-renewal-defaults-evergreen"
              checked={useTenantRenewalDefaults}
              onCheckedChange={(checked) =>
                updateData({ use_tenant_renewal_defaults: checked })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="renewal-mode-evergreen" className="text-xs font-medium">
              {t('wizardBasics.renewal.modeLabel', { defaultValue: 'Renewal Mode' })}
            </Label>
            <CustomSelect
              id="renewal-mode-evergreen"
              options={renewalModeOptions}
              value={effectiveRenewalMode}
              onValueChange={(value: string) =>
                updateData({
                  renewal_mode: value as NonNullable<ContractWizardData['renewal_mode']>,
                })
              }
              placeholder={t('wizardBasics.renewal.modePlaceholder', { defaultValue: 'Select renewal mode' })}
              className="w-full"
            />
          </div>
          {isRenewalEnabled && (
            <div className="space-y-2">
              <Label htmlFor="notice-period-evergreen" className="text-xs font-medium">
                {t('wizardBasics.renewal.noticePeriodLabel', { defaultValue: 'Notice Period (Days)' })}
              </Label>
              <Input
                id="notice-period-evergreen"
                type="number"
                min={0}
                step={1}
                value={data.notice_period_days ?? ''}
                onChange={(e) => {
                  const nextValue = e.target.value.trim();
                  if (!nextValue) {
                    updateData({ notice_period_days: undefined });
                    return;
                  }
                  const parsed = Number.parseInt(nextValue, 10);
                  updateData({
                    notice_period_days: Number.isFinite(parsed) ? Math.max(0, parsed) : undefined,
                  });
                }}
                placeholder={t('wizardBasics.renewal.noticePeriodPlaceholder', { defaultValue: 'e.g., 30' })}
                className="w-full"
              />
            </div>
          )}
          {isAutoRenew && (
            <div className="space-y-2">
              <Label htmlFor="renewal-term-evergreen" className="text-xs font-medium">
                {t('wizardBasics.renewal.termLabel', { defaultValue: 'Renewal Term (Months)' })}
              </Label>
              <Input
                id="renewal-term-evergreen"
                type="number"
                min={1}
                step={1}
                value={data.renewal_term_months ?? ''}
                onChange={(e) => {
                  const nextValue = e.target.value.trim();
                  if (!nextValue) {
                    updateData({ renewal_term_months: undefined });
                    return;
                  }
                  const parsed = Number.parseInt(nextValue, 10);
                  updateData({
                    renewal_term_months:
                      Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
                  });
                }}
                placeholder={t('wizardBasics.renewal.termPlaceholder', { defaultValue: 'e.g., 12' })}
                className="w-full"
              />
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="description">
          {t('wizardBasics.additionalDescription.label', { defaultValue: 'Description (Optional)' })}
        </Label>
        <TextArea
          id="description"
          value={data.description || ''}
          onChange={(e) => updateData({ description: e.target.value })}
          placeholder={t('wizardBasics.additionalDescription.placeholder', {
            defaultValue: 'Add any additional notes about this contract...',
          })}
          className="min-h-[100px] w-full"
        />
        <p className="text-xs text-[rgb(var(--color-text-400))]">
          {t('wizardBasics.additionalDescription.hint', { defaultValue: 'Internal notes or contract details.' })}
        </p>
      </div>

      <div className="border-t pt-6 space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <FileCheck className="h-5 w-5 text-[rgb(var(--color-text-600))]" />
          <h4 className="text-base font-semibold">
            {t('wizardBasics.po.title', { defaultValue: 'Purchase Order (Optional)' })}
          </h4>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="space-y-1 flex-1">
              <div className="flex items-center gap-2">
                <Label htmlFor="po_required" className="text-sm font-medium">
                  {t('wizardBasics.po.requireForInvoicing', { defaultValue: 'Require Purchase Order for invoicing' })}
                </Label>
                <Tooltip content={t('wizardBasics.po.requireTooltip', {
                  defaultValue:
                    'When enabled, invoices cannot be generated for this contract unless a PO number is provided.',
                })}>
                  <HelpCircle className="h-4 w-4 text-[rgb(var(--color-text-300))] cursor-help" />
                </Tooltip>
              </div>
              <p className="text-xs text-[rgb(var(--color-text-400))]">
                {t('wizardBasics.po.requireHint', { defaultValue: 'Block invoice generation if PO is not provided.' })}
              </p>
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
              <span className="font-medium">
                {t('wizardBasics.po.noteLabel', { defaultValue: 'Note:' })}
              </span>{' '}
              {t('wizardBasics.po.noteText', {
                defaultValue: 'PO enforcement will apply when invoice automation is enabled. Configure now to stay ahead.',
              })}
            </AlertDescription>
          </Alert>
        </div>

        {data.po_required && (
          <div className="space-y-4 pl-4 border-l-2 border-blue-200">
            <div className="space-y-2">
              <Label htmlFor="po_number">
                {t('wizardBasics.po.numberLabel', { defaultValue: 'PO Number' })} *
              </Label>
              <Input
                id="po_number"
                type="text"
                value={data.po_number || ''}
                onChange={(e) => updateData({ po_number: e.target.value })}
                placeholder={t('wizardBasics.po.numberPlaceholder', { defaultValue: 'e.g., PO-2024-12345' })}
                className="w-full"
              />
              <p className="text-xs text-[rgb(var(--color-text-400))]">
                {t('wizardBasics.po.numberHint', { defaultValue: 'Client\'s purchase order reference number.' })}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="po_amount">{t('wizardBasics.po.amountLabel', { defaultValue: 'PO Amount' })}</Label>
              <div className="flex h-10 items-center rounded-md border border-[rgb(var(--color-border-400))] shadow-sm focus-within:border-transparent focus-within:ring-2 focus-within:ring-[rgb(var(--color-primary-500))]">
                <span className="shrink-0 pl-3 pr-1 text-[rgb(var(--color-text-400))]">
                  {currencySymbol}
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
                  className="h-full rounded-none border-0 py-0 pl-1 pr-3 shadow-none focus:border-transparent focus:ring-0"
                />
              </div>
              <p className="text-xs text-[rgb(var(--color-text-400))]">
                {t('wizardBasics.po.amountHint', { defaultValue: 'Total authorized amount on the purchase order.' })}
              </p>
            </div>
          </div>
        )}
      </div>

      {data.client_id && data.contract_name && data.start_date && (
        <Alert variant="info" className="mt-6">
          <AlertDescription>
            <h4 className="text-sm font-semibold mb-2">
              {t('wizardBasics.summary.title', { defaultValue: 'Contract Summary' })}
            </h4>
            <div className="text-sm space-y-1">
              <p>
                <strong>{t('wizardBasics.summary.labels.client', { defaultValue: 'Client:' })}</strong>{' '}
                {clients.find((c) => c.client_id === data.client_id)?.client_name
                  || t('wizardBasics.summary.values.notSelected', { defaultValue: 'Not selected' })}
              </p>
              <p>
                <strong>{t('wizardBasics.summary.labels.contract', { defaultValue: 'Contract:' })}</strong> {data.contract_name}
              </p>
              <p>
                <strong>{t('wizardBasics.summary.labels.billingFrequency', { defaultValue: 'Billing Frequency:' })}</strong>{' '}
                {formatBillingFrequency(data.billing_frequency)}
              </p>
              <p>
                <strong>{t('wizardBasics.summary.labels.currency', { defaultValue: 'Currency:' })}</strong>{' '}
                {CURRENCY_OPTIONS.find((opt) => opt.value === data.currency_code)?.label ||
                  data.currency_code}
              </p>
              <p>
                <strong>{t('wizardBasics.summary.labels.period', { defaultValue: 'Period:' })}</strong>{' '}
                {formatDateFns(parseLocalYMD(data.start_date)!, 'MM/dd/yyyy')}
                {data.end_date
                  ? ` - ${formatDateFns(parseLocalYMD(data.end_date)!, 'MM/dd/yyyy')}`
                  : ` (${t('wizardBasics.summary.values.ongoing', { defaultValue: 'Ongoing' })})`}
              </p>
              {data.renewal_mode && (
                <p>
                  <strong>{t('wizardBasics.summary.labels.renewalMode', { defaultValue: 'Renewal Mode:' })}</strong>{' '}
                  {data.renewal_mode === 'none'
                    ? t('wizardBasics.renewal.modeOptions.none', { defaultValue: 'No Renewal' })
                    : data.renewal_mode === 'manual'
                      ? t('wizardBasics.renewal.modeOptions.manual', { defaultValue: 'Manual Renewal' })
                      : t('wizardBasics.renewal.modeOptions.auto', { defaultValue: 'Auto Renew' })}
                </p>
              )}
              {data.renewal_mode && data.renewal_mode !== 'none' && data.notice_period_days !== undefined && (
                <p>
                  <strong>{t('wizardBasics.summary.labels.noticePeriod', { defaultValue: 'Notice Period:' })}</strong>{' '}
                  {t('wizardBasics.summary.values.noticePeriodDays', {
                    defaultValue: '{{count}} day',
                    count: data.notice_period_days,
                  })}
                </p>
              )}
              {data.renewal_mode === 'auto' && data.renewal_term_months !== undefined && (
                <p>
                  <strong>{t('wizardBasics.summary.labels.renewalTerm', { defaultValue: 'Renewal Term:' })}</strong>{' '}
                  {t('wizardBasics.summary.values.renewalTermMonths', {
                    defaultValue: '{{count}} month',
                    count: data.renewal_term_months,
                  })}
                </p>
              )}
              {data.po_required && (
                <>
                  <p>
                    <strong>{t('wizardBasics.summary.labels.poRequired', { defaultValue: 'PO Required:' })}</strong>{' '}
                    {t('common.labels.yes', { defaultValue: 'Yes' })}
                  </p>
                  {data.po_number && (
                    <p>
                      <strong>{t('wizardBasics.summary.labels.poNumber', { defaultValue: 'PO Number:' })}</strong> {data.po_number}
                    </p>
                  )}
                  {data.po_amount && (
                    <p>
                      <strong>{t('wizardBasics.summary.labels.poAmount', { defaultValue: 'PO Amount:' })}</strong>{' '}
                      {formatCurrency(data.po_amount / currencyMeta.minorUnitFactor, {
                        currency: currencyMeta.currencyCode,
                        minimumFractionDigits: currencyMeta.fractionDigits,
                        maximumFractionDigits: currencyMeta.fractionDigits,
                      })}
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
