'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { currencyFractionDigits, toMinorUnits } from '@alga-psa/core';
import type { IProjectPhase, IProjectPhaseRateOverride } from '@alga-psa/types';
import {
  upsertPhaseRateOverride,
  deletePhaseRateOverride,
} from '@alga-psa/billing/actions/projectBillingConfigActions';
import { getServices } from '../../actions/serviceCatalogActions';
import { formatCents } from './billingViewHelpers';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

type OverrideView = IProjectPhaseRateOverride & {
  phase_name: string;
  service_name: string | null;
  override_service_name: string | null;
};

interface PhaseRateOverridesEditorProps {
  overrides: OverrideView[];
  phases: IProjectPhase[];
  currency: string | null;
  canManage: boolean;
  onChanged: () => void;
}

const ALL_SERVICES = '__all__';
const NO_REMAP = '__none__';

/**
 * F123 — per-phase T&M rate overrides: optionally scope to one service, set a
 * replacement rate, and/or re-map to a different catalog service. At least one of
 * rate or re-map is required (enforced server-side).
 */
export default function PhaseRateOverridesEditor({
  overrides,
  phases,
  currency,
  canManage,
  onChanged,
}: PhaseRateOverridesEditorProps) {
  const { t, i18n } = useTranslation(['features/projects', 'common']);
  const [services, setServices] = useState<{ value: string; label: string }[]>([]);
  const [adding, setAdding] = useState(false);
  const [phaseId, setPhaseId] = useState('');
  const [serviceId, setServiceId] = useState(ALL_SERVICES);
  const [rateText, setRateText] = useState('');
  const [remapServiceId, setRemapServiceId] = useState(NO_REMAP);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getServices(1, 999)
      .then((res) => {
        if (cancelled) return;
        setServices(res.services.map((s) => ({ value: s.service_id, label: s.service_name })));
      })
      .catch(() => { if (!cancelled) setServices([]); });
    return () => { cancelled = true; };
  }, []);

  const phaseOptions = useMemo(
    () => phases.map((phase) => ({ value: phase.phase_id, label: phase.phase_name })),
    [phases],
  );

  const resetForm = () => {
    setPhaseId('');
    setServiceId(ALL_SERVICES);
    setRateText('');
    setRemapServiceId(NO_REMAP);
    setAdding(false);
  };

  const handleAdd = async () => {
    if (!phaseId) {
      toast.error(t('billing.overrides.errorPhase', 'Select a phase'));
      return;
    }
    let rate: number | null = null;
    if (rateText.trim() !== '') {
      const major = Number(rateText);
      if (!Number.isFinite(major) || major < 0) {
        toast.error(t('billing.overrides.errorRate', 'Enter a valid rate'));
        return;
      }
      rate = toMinorUnits(major, i18n.language, currency ?? 'USD');
    }
    const remap = remapServiceId === NO_REMAP ? null : remapServiceId;
    if (rate == null && remap == null) {
      toast.error(t('billing.overrides.errorRequirement', 'Set a rate or a replacement service'));
      return;
    }

    setSaving(true);
    try {
      const result = await upsertPhaseRateOverride({
        phase_id: phaseId,
        service_id: serviceId === ALL_SERVICES ? null : serviceId,
        rate,
        override_service_id: remap,
      });
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('billing.overrides.saved', 'Rate override saved'));
      resetForm();
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const result = await deletePhaseRateOverride(id);
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('billing.overrides.deleted', 'Rate override removed'));
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Card id="project-billing-overrides" className="p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-[rgb(var(--color-text-900))]">{t('billing.overrides.title', 'Phase rate overrides')}</h3>
          <p className="mt-0.5 text-xs text-[rgb(var(--color-text-500))]">
            {t('billing.overrides.hint', 'Override billing rates or re-map services for specific phases.')}
          </p>
        </div>
        {canManage && !adding && (
          <Button id="billing-override-add" variant="outline" size="xs" onClick={() => setAdding(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('billing.overrides.add', 'Add override')}
          </Button>
        )}
      </div>

      <div className="mt-3 divide-y divide-[rgb(var(--color-border-100))]">
        {overrides.length === 0 && !adding && (
          <p className="py-3 text-sm text-[rgb(var(--color-text-500))]">{t('billing.overrides.empty', 'No rate overrides.')}</p>
        )}
        {overrides.map((override) => (
          <div key={override.rate_override_id} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
            <div className="min-w-0">
              <div className="font-medium text-[rgb(var(--color-text-900))]">{override.phase_name}</div>
              <div className="text-[11.5px] text-[rgb(var(--color-text-500))]">
                {override.service_name ?? t('billing.overrides.allServices', 'All services')}
                {override.rate != null && ` · ${formatCents(override.rate, currency)}/h`}
                {override.override_service_name && ` · → ${override.override_service_name}`}
              </div>
            </div>
            {canManage && (
              <button
                id={`billing-override-delete-${override.rate_override_id}`}
                type="button"
                onClick={() => handleDelete(override.rate_override_id)}
                className="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
                title={t('common:actions.delete', 'Delete')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {adding && canManage && (
        <div className="mt-3 rounded-md border border-[rgb(var(--color-border-200))] p-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="billing-override-phase">{t('billing.overrides.phase', 'Phase')}</Label>
              <CustomSelect
                id="billing-override-phase"
                value={phaseId}
                onValueChange={setPhaseId}
                options={phaseOptions}
                placeholder={t('billing.overrides.phasePlaceholder', 'Select a phase')}
              />
            </div>
            <div>
              <Label htmlFor="billing-override-service">{t('billing.overrides.service', 'Service filter')}</Label>
              <CustomSelect
                id="billing-override-service"
                value={serviceId}
                onValueChange={setServiceId}
                options={[{ value: ALL_SERVICES, label: t('billing.overrides.allServices', 'All services') }, ...services]}
              />
            </div>
            <div>
              <Label htmlFor="billing-override-rate">
                {t('billing.overrides.rate', 'Rate ({{currency}}/h)', { currency: currency ?? 'USD' })}
              </Label>
              <Input
                id="billing-override-rate"
                type="number"
                min="0"
                step="0.01"
                value={rateText}
                onChange={(e) => setRateText(e.target.value)}
                placeholder={t('billing.overrides.ratePlaceholder', 'Leave blank to keep')}
              />
            </div>
            <div>
              <Label htmlFor="billing-override-remap">{t('billing.overrides.remap', 'Re-map to service')}</Label>
              <CustomSelect
                id="billing-override-remap"
                value={remapServiceId}
                onValueChange={setRemapServiceId}
                options={[{ value: NO_REMAP, label: t('billing.overrides.noRemap', 'No re-map') }, ...services]}
              />
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button id="billing-override-cancel" variant="outline" size="sm" onClick={resetForm} disabled={saving}>
              {t('common:actions.cancel', 'Cancel')}
            </Button>
            <Button id="billing-override-save" size="sm" onClick={handleAdd} disabled={saving}>
              {saving ? t('billing.overrides.saving', 'Saving...') : t('common:actions.save', 'Save')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
