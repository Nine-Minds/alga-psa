'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { AlertCircle, Plus, Pencil, Power } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  createContractDiscount,
  getContractDiscounts,
  getContractLineServiceOptions,
  setContractDiscountActive,
  updateContractDiscount,
  type ContractDiscountInput,
  type ContractDiscountRecord,
  type ContractDiscountScope,
  type ContractLineServiceOption,
} from '@alga-psa/billing/actions/discountActions';
import { getDetailedContractLines } from '@alga-psa/billing/actions/contractActions';

const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

interface ContractDiscountsProps {
  contractId: string;
  isReadOnly?: boolean;
}

interface DiscountFormState {
  discount_name: string;
  discount_type: 'percentage' | 'fixed';
  value: string;
  start_date: string;
  end_date: string;
  contract_line_id: string;
  scope: ContractDiscountScope;
  scope_service_id: string;
  priority: string;
  is_active: boolean;
}

const emptyForm = (): DiscountFormState => ({
  discount_name: '',
  discount_type: 'percentage',
  value: '',
  start_date: new Date().toISOString().slice(0, 10),
  end_date: '',
  contract_line_id: '',
  scope: 'invoice',
  scope_service_id: '',
  priority: '',
  is_active: true,
});

export function ContractDiscounts({ contractId, isReadOnly = false }: ContractDiscountsProps) {
  const { t } = useTranslation('msp/contracts');
  const [discounts, setDiscounts] = useState<ContractDiscountRecord[]>([]);
  const [lines, setLines] = useState<Array<{ contract_line_id: string; contract_line_name?: string | null }>>([]);
  const [serviceOptions, setServiceOptions] = useState<ContractLineServiceOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ContractDiscountRecord | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [discountResult, lineResult, serviceResult] = await Promise.all([
        getContractDiscounts(contractId),
        getDetailedContractLines(contractId),
        getContractLineServiceOptions(contractId),
      ]);
      if (isReturnedActionError(discountResult)) {
        setError(getErrorMessage(discountResult));
        return;
      }
      setDiscounts(discountResult);
      setLines(Array.isArray(lineResult)
        ? lineResult.map((line) => ({
          contract_line_id: line.contract_line_id,
          contract_line_name: line.contract_line_name ?? null,
        }))
        : []);
      setServiceOptions(isReturnedActionError(serviceResult) ? [] : serviceResult);
    } catch (err) {
      console.error('Failed to load contract discounts:', err);
      setError(t('contractDiscounts.errors.loadFailed', { defaultValue: 'Failed to load discounts.' }));
    } finally {
      setIsLoading(false);
    }
  }, [contractId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const lineOptions = useMemo(
    () => lines.map((line) => ({
      value: line.contract_line_id,
      label: line.contract_line_name || t('contractDiscounts.values.unnamedLine', { defaultValue: 'Unnamed line' }),
    })),
    [lines, t],
  );

  const handleToggleActive = async (discount: ContractDiscountRecord) => {
    setBusyId(discount.discount_id);
    setError(null);
    try {
      const result = await setContractDiscountActive(contractId, discount.discount_id, !discount.is_active);
      if (isReturnedActionError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const formatValue = (discount: ContractDiscountRecord) => discount.discount_type === 'percentage'
    ? `${discount.value}%`
    : discount.value.toFixed(2);

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">
            {t('contractDiscounts.title', { defaultValue: 'Discounts' })}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t('contractDiscounts.description', {
              defaultValue: 'Configured discounts are applied automatically on each eligible draft invoice for this client.',
            })}
          </p>
        </div>
        {!isReadOnly && (
          <Button
            id="add-contract-discount-button"
            type="button"
            onClick={() => { setEditing(null); setDialogOpen(true); }}
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('contractDiscounts.actions.add', { defaultValue: 'Add Discount' })}
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">
          {t('contractDiscounts.loading', { defaultValue: 'Loading discounts…' })}
        </p>
      ) : discounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('contractDiscounts.empty', { defaultValue: 'No discounts are configured for this contract yet.' })}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-[rgb(var(--color-border-200))]">
                <th className="py-2 pr-4">{t('contractDiscounts.columns.name', { defaultValue: 'Name' })}</th>
                <th className="py-2 pr-4">{t('contractDiscounts.columns.value', { defaultValue: 'Value' })}</th>
                <th className="py-2 pr-4">{t('contractDiscounts.columns.scope', { defaultValue: 'Scope' })}</th>
                <th className="py-2 pr-4">{t('contractDiscounts.columns.line', { defaultValue: 'Contract line' })}</th>
                <th className="py-2 pr-4">{t('contractDiscounts.columns.dates', { defaultValue: 'Dates' })}</th>
                <th className="py-2 pr-4">{t('contractDiscounts.columns.status', { defaultValue: 'Status' })}</th>
                {!isReadOnly && <th className="py-2" />}
              </tr>
            </thead>
            <tbody>
              {discounts.map((discount) => (
                <tr key={discount.discount_id} className="border-b border-[rgb(var(--color-border-100))]">
                  <td className="py-2 pr-4 font-medium">{discount.discount_name}</td>
                  <td className="py-2 pr-4">{formatValue(discount)}</td>
                  <td className="py-2 pr-4">
                    {t(`contractDiscounts.scopes.${discount.scope}`, {
                      defaultValue: discount.scope,
                    })}
                    {discount.scope === 'service' && discount.scope_service_name
                      ? ` · ${discount.scope_service_name}`
                      : ''}
                  </td>
                  <td className="py-2 pr-4">{discount.contract_line_name ?? '—'}</td>
                  <td className="py-2 pr-4">
                    {discount.start_date ?? '—'}
                    {discount.end_date ? ` → ${discount.end_date}` : ''}
                  </td>
                  <td className="py-2 pr-4">
                    {discount.is_active
                      ? <Badge variant="success">{t('contractDiscounts.status.active', { defaultValue: 'Active' })}</Badge>
                      : <Badge variant="default">{t('contractDiscounts.status.inactive', { defaultValue: 'Inactive' })}</Badge>}
                  </td>
                  {!isReadOnly && (
                    <td className="py-2 text-right whitespace-nowrap">
                      <Button
                        id={`edit-contract-discount-${discount.discount_id}`}
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => { setEditing(discount); setDialogOpen(true); }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        id={`toggle-contract-discount-${discount.discount_id}`}
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busyId === discount.discount_id}
                        onClick={() => handleToggleActive(discount)}
                      >
                        <Power className="h-4 w-4" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialogOpen && (
        <ContractDiscountDialog
          contractId={contractId}
          lines={lineOptions}
          serviceOptions={serviceOptions}
          editing={editing}
          onClose={() => setDialogOpen(false)}
          onSaved={async () => {
            setDialogOpen(false);
            await load();
          }}
        />
      )}
    </Card>
  );
}

interface ContractDiscountDialogProps {
  contractId: string;
  lines: Array<{ value: string; label: string }>;
  serviceOptions: ContractLineServiceOption[];
  editing: ContractDiscountRecord | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

function ContractDiscountDialog({
  contractId,
  lines,
  serviceOptions,
  editing,
  onClose,
  onSaved,
}: ContractDiscountDialogProps) {
  const { t } = useTranslation('msp/contracts');
  const [form, setForm] = useState<DiscountFormState>(() => editing
    ? {
      discount_name: editing.discount_name,
      discount_type: editing.discount_type,
      value: String(editing.value),
      start_date: editing.start_date ?? new Date().toISOString().slice(0, 10),
      end_date: editing.end_date ?? '',
      contract_line_id: editing.contract_line_id ?? lines[0]?.value ?? '',
      scope: editing.scope,
      scope_service_id: editing.scope_service_id ?? '',
      priority: editing.priority == null ? '' : String(editing.priority),
      is_active: editing.is_active,
    }
    : { ...emptyForm(), contract_line_id: lines[0]?.value ?? '' });
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const scopedServices = useMemo(
    () => serviceOptions
      .filter((option) => option.contract_line_id === form.contract_line_id)
      .map((option) => ({
        value: option.service_id,
        label: option.service_name || option.service_id,
      })),
    [serviceOptions, form.contract_line_id],
  );

  const update = <K extends keyof DiscountFormState>(key: K, value: DiscountFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const input: ContractDiscountInput = {
      discount_name: form.discount_name,
      discount_type: form.discount_type,
      value: Number.parseFloat(form.value),
      start_date: form.start_date,
      end_date: form.end_date || null,
      contract_line_id: form.contract_line_id,
      scope: form.scope,
      scope_service_id: form.scope === 'service' ? form.scope_service_id || null : null,
      priority: form.priority.trim() === '' ? null : Number.parseInt(form.priority, 10),
      is_active: form.is_active,
    };

    setIsSaving(true);
    try {
      const result = editing
        ? await updateContractDiscount(contractId, editing.discount_id, input)
        : await createContractDiscount(contractId, input);
      if (isReturnedActionError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      await onSaved();
    } catch (err) {
      console.error('Failed to save contract discount:', err);
      setError(err instanceof Error
        ? err.message
        : t('contractDiscounts.errors.saveFailed', { defaultValue: 'Failed to save the discount.' }));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={editing
        ? t('contractDiscounts.dialog.editTitle', { defaultValue: 'Edit discount' })
        : t('contractDiscounts.dialog.createTitle', { defaultValue: 'Add discount' })}
      className="max-w-lg"
      footer={(
        <div className="flex justify-end space-x-2">
          <Button id="cancel-contract-discount-button" type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
            {t('contractDiscounts.actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            id="save-contract-discount-button"
            type="button"
            disabled={isSaving}
            onClick={() => (document.getElementById('contract-discount-form') as HTMLFormElement | null)?.requestSubmit()}
          >
            {isSaving
              ? t('contractDiscounts.actions.saving', { defaultValue: 'Saving…' })
              : t('contractDiscounts.actions.save', { defaultValue: 'Save' })}
          </Button>
        </div>
      )}
    >
      <DialogContent>
        <form id="contract-discount-form" onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div>
            <Label htmlFor="contract-discount-name">
              {t('contractDiscounts.fields.name', { defaultValue: 'Name' })}
            </Label>
            <Input
              id="contract-discount-name"
              value={form.discount_name}
              onChange={(e) => update('discount_name', e.target.value)}
              placeholder={t('contractDiscounts.fields.namePlaceholder', { defaultValue: 'e.g. Loyalty 10%' })}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="contract-discount-type">
                {t('contractDiscounts.fields.type', { defaultValue: 'Type' })}
              </Label>
              <CustomSelect
                id="contract-discount-type"
                value={form.discount_type}
                onValueChange={(value) => update('discount_type', value as 'percentage' | 'fixed')}
                options={[
                  { value: 'percentage', label: t('contractDiscounts.types.percentage', { defaultValue: 'Percentage' }) },
                  { value: 'fixed', label: t('contractDiscounts.types.fixed', { defaultValue: 'Fixed amount' }) },
                ]}
              />
            </div>
            <div>
              <Label htmlFor="contract-discount-value">
                {form.discount_type === 'percentage'
                  ? t('contractDiscounts.fields.percentValue', { defaultValue: 'Percent (0–100)' })
                  : t('contractDiscounts.fields.fixedValue', { defaultValue: 'Amount' })}
              </Label>
              <Input
                id="contract-discount-value"
                type="text"
                inputMode="decimal"
                value={form.value}
                onChange={(e) => update('value', e.target.value)}
                placeholder={form.discount_type === 'percentage' ? '10' : '50.00'}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="contract-discount-start-date">
                {t('contractDiscounts.fields.startDate', { defaultValue: 'Start date' })}
              </Label>
              <Input
                id="contract-discount-start-date"
                type="date"
                value={form.start_date}
                onChange={(e) => update('start_date', e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="contract-discount-end-date">
                {t('contractDiscounts.fields.endDate', { defaultValue: 'End date' })}
              </Label>
              <Input
                id="contract-discount-end-date"
                type="date"
                value={form.end_date}
                onChange={(e) => update('end_date', e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="contract-discount-line">
              {t('contractDiscounts.fields.line', { defaultValue: 'Contract line' })}
            </Label>
            <CustomSelect
              id="contract-discount-line"
              value={form.contract_line_id}
              onValueChange={(value) => setForm((current) => ({
                ...current,
                contract_line_id: value,
                scope_service_id: '',
              }))}
              options={lines}
              placeholder={t('contractDiscounts.fields.linePlaceholder', { defaultValue: 'Select a contract line' })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="contract-discount-scope">
                {t('contractDiscounts.fields.scope', { defaultValue: 'Scope' })}
              </Label>
              <CustomSelect
                id="contract-discount-scope"
                value={form.scope}
                onValueChange={(value) => update('scope', value as ContractDiscountScope)}
                options={[
                  { value: 'invoice', label: t('contractDiscounts.scopes.invoice', { defaultValue: 'All eligible charges' }) },
                  { value: 'contract', label: t('contractDiscounts.scopes.contract', { defaultValue: 'This contract' }) },
                  { value: 'service', label: t('contractDiscounts.scopes.service', { defaultValue: 'A service' }) },
                ]}
              />
            </div>
            <div>
              <Label htmlFor="contract-discount-priority">
                {t('contractDiscounts.fields.priority', { defaultValue: 'Priority' })}
              </Label>
              <Input
                id="contract-discount-priority"
                type="number"
                value={form.priority}
                onChange={(e) => update('priority', e.target.value)}
                placeholder={t('contractDiscounts.fields.priorityPlaceholder', { defaultValue: 'Optional' })}
              />
            </div>
          </div>

          {form.scope === 'service' && (
            <div>
              <Label htmlFor="contract-discount-service">
                {t('contractDiscounts.fields.service', { defaultValue: 'Service' })}
              </Label>
              <CustomSelect
                id="contract-discount-service"
                value={form.scope_service_id}
                onValueChange={(value) => update('scope_service_id', value)}
                options={scopedServices}
                placeholder={t('contractDiscounts.fields.servicePlaceholder', { defaultValue: 'Select a service' })}
              />
            </div>
          )}

          <div className="flex items-center justify-between border-t pt-4">
            <Label htmlFor="contract-discount-active">
              {t('contractDiscounts.fields.active', { defaultValue: 'Active' })}
            </Label>
            <Switch
              id="contract-discount-active"
              checked={form.is_active}
              onCheckedChange={(checked) => update('is_active', checked)}
            />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default ContractDiscounts;
