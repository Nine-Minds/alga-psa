"use client";

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { getContractById, updateContract } from '@alga-psa/billing/actions/contractActions';
import { getTemplateLineServicesWithConfigurations } from '@alga-psa/billing/actions/contractLineServiceActions';

const isReturnedActionError = (value: unknown) => isActionMessageError(value) || isActionPermissionError(value);

export default function TemplateDefaultDiscountsPanel({
  templateId,
  definitions,
  lines,
  onSaved,
}: {
  templateId: string;
  definitions: Array<Record<string, unknown>>;
  lines: Array<{ contract_line_id?: string; contract_line_name?: string }>;
  onSaved: () => void;
}) {
  const { t } = useTranslation('msp/contracts');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'percentage' | 'fixed'>('percentage');
  const [value, setValue] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState('');
  const [scope, setScope] = useState<'contract' | 'line' | 'service'>('contract');
  const [lineId, setLineId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [services, setServices] = useState<Array<{ service_id: string; service_name?: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const resetForm = () => {
    setEditingIndex(null);
    setName(''); setKind('percentage'); setValue('');
    setStartDate(new Date().toISOString().slice(0, 10));
    setEndDate(''); setScope('contract'); setLineId(''); setServiceId('');
    setError(null);
  };

  const edit = (index: number) => {
    const definition = definitions[index];
    setEditingIndex(index);
    setName(String(definition.discount_name ?? ''));
    setKind(definition.discount_type === 'fixed' ? 'fixed' : 'percentage');
    setValue(String(definition.value ?? ''));
    setStartDate(String(definition.start_date ?? ''));
    setEndDate(String(definition.end_date ?? ''));
    setScope(definition.scope === 'line' || definition.scope === 'service' ? definition.scope : 'contract');
    setLineId(String(definition.contract_line_id ?? ''));
    setServiceId(String(definition.scope_service_id ?? ''));
    setError(null);
  };

  useEffect(() => {
    let active = true;
    void Promise.all(lines.filter((line) => line.contract_line_id).map(async (line) => {
      const result = await getTemplateLineServicesWithConfigurations(line.contract_line_id!);
      if (Array.isArray(result)) return result.map((service: any) => ({
        service_id: service.service_id,
        service_name: service.service_name,
      }));
      return [];
    })).then((groups) => {
      if (active) setServices([...new Map(groups.flat().map((service) => [service.service_id, service])).values()]);
    });
    return () => { active = false; };
  }, [lines]);

  const save = async (nextDefinitions: Array<Record<string, unknown>>): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const current = await getContractById(templateId);
      if (!current) throw new Error('Template not found.');
      const metadata = current.template_metadata && typeof current.template_metadata === 'object'
        ? current.template_metadata as Record<string, unknown>
        : {};
      const result = await updateContract(templateId, {
        template_metadata: { ...metadata, default_discounts: nextDefinitions },
      });
      if (isReturnedActionError(result)) throw new Error(getErrorMessage(result));
      onSaved();
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const add = async () => {
    const numericValue = Number(value);
    if (!name.trim() || !Number.isFinite(numericValue) || numericValue <= 0 || !startDate) {
      setError(t('templateDetail.discounts.invalid', { defaultValue: 'Enter a name, positive value, and start date.' }));
      return;
    }
    const previous = editingIndex === null ? undefined : definitions[editingIndex];
    const definition = {
      ...previous,
      template_discount_key: previous?.template_discount_key ?? crypto.randomUUID(),
      discount_name: name.trim(), discount_type: kind, value: numericValue,
      start_date: startDate, end_date: endDate || null, scope, is_active: previous?.is_active ?? true,
      contract_line_id: scope === 'line' ? lineId : null,
      scope_service_id: scope === 'service' ? serviceId : null,
    };
    const saved = await save(editingIndex === null
      ? [...definitions, definition]
      : definitions.map((term, index) => index === editingIndex ? definition : term));
    if (saved) resetForm();
  };

  return (
    <Card className="mt-4">
      <CardHeader><CardTitle className="text-base font-semibold text-[rgb(var(--color-text-800))]">{t('templateDetail.discounts.title', { defaultValue: 'Default contract discounts' })}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('templateDetail.discounts.help', { defaultValue: 'Each client contract receives an independent editable copy. Contract-wide discounts apply across its eligible lines.' })}</p>
        {definitions.map((definition, index) => <div key={`${String(definition.discount_name)}-${index}`} className="flex items-center justify-between border-b pb-2 text-sm">
          <span>{String(definition.discount_name)} · {definition.discount_type === 'percentage' ? `${String(definition.value)}%` : String(definition.value)}</span>
          <div className="flex gap-2">
            <Button id={`edit-template-discount-${index}-button`} type="button" variant="ghost" disabled={saving} onClick={() => edit(index)}>{t('common.actions.edit', { defaultValue: 'Edit' })}</Button>
            <Button id={`remove-template-discount-${index}-button`} type="button" variant="ghost" disabled={saving || editingIndex !== null} onClick={() => void save(definitions.filter((_, itemIndex) => itemIndex !== index))}>{t('templateDetail.discounts.remove', { defaultValue: 'Remove' })}</Button>
          </div>
        </div>)}
        <div className="grid gap-3 md:grid-cols-2">
          <Input id="template-default-discount-name" label={t('templateDetail.discounts.name', { defaultValue: 'Discount name' })} value={name} onChange={(event) => setName(event.target.value)} />
          <CustomSelect id="template-default-discount-kind" value={kind} onValueChange={(selected) => setKind(selected as 'percentage' | 'fixed')} options={[{ value: 'percentage', label: t('templateDetail.discounts.percentage', { defaultValue: 'Percentage' }) }, { value: 'fixed', label: t('templateDetail.discounts.fixed', { defaultValue: 'Fixed amount' }) }]} />
          <Input id="template-default-discount-value" label={t('templateDetail.discounts.value', { defaultValue: 'Value' })} type="number" min="0.01" step="0.01" value={value} onChange={(event) => setValue(event.target.value)} />
          <Input id="template-default-discount-start-date" label={t('templateDetail.discounts.startDate', { defaultValue: 'Starts on' })} type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          <Input id="template-default-discount-end-date" label={t('templateDetail.discounts.endDate', { defaultValue: 'Ends on (optional)' })} type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          <CustomSelect id="template-default-discount-scope" value={scope} onValueChange={(selected) => setScope(selected as 'contract' | 'line' | 'service')} options={[{ value: 'contract', label: t('contractDiscounts.scopes.contract', { defaultValue: 'Contract-wide' }) }, { value: 'line', label: t('contractDiscounts.scopes.line', { defaultValue: 'Contract line' }) }, { value: 'service', label: t('contractDiscounts.scopes.service', { defaultValue: 'Service' }) }]} />
          {scope === 'line' && <CustomSelect id="template-default-discount-line" value={lineId} onValueChange={setLineId} options={lines.filter((line) => line.contract_line_id).map((line) => ({ value: line.contract_line_id!, label: line.contract_line_name ?? line.contract_line_id! }))} placeholder={t('templateDetail.discounts.chooseLine', { defaultValue: 'Choose a template line' })} />}
          {scope === 'service' && <CustomSelect id="template-default-discount-service" value={serviceId} onValueChange={setServiceId} options={services.map((service) => ({ value: service.service_id, label: service.service_name ?? service.service_id }))} placeholder={t('templateDetail.discounts.chooseService', { defaultValue: 'Choose a service' })} />}
        </div>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <div className="flex gap-2">
          <Button id="add-template-default-discount-button" type="button" disabled={saving} onClick={() => void add()}>{editingIndex === null ? t('templateDetail.discounts.add', { defaultValue: 'Add default discount' }) : t('contractDiscounts.actions.save', { defaultValue: 'Save changes' })}</Button>
          {editingIndex !== null && <Button id="cancel-template-default-discount-edit-button" type="button" variant="outline" disabled={saving} onClick={resetForm}>{t('contractDiscounts.actions.cancel', { defaultValue: 'Cancel' })}</Button>}
        </div>
      </CardContent>
    </Card>
  );
}
