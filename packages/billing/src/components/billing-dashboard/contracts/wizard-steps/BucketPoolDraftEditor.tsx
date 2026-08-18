'use client';

import React, { useState } from 'react';
import { Plus, Trash2, Layers } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { SwitchWithLabel } from '@alga-psa/ui/components/SwitchWithLabel';
import type { BucketPoolDraft } from '../ContractWizard';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export interface BucketPoolDraftEditorProps {
  /** Existing drafts for this line key (from wizardData.bucket_pools). */
  pools: BucketPoolDraft[];
  /** The services configured on this line (member picker options). */
  lineServices: Array<{ service_id: string; service_name: string }>;
  /** Business-hours schedules for the after-hours rule (tenant default first). */
  schedules: Array<{ schedule_id: string; schedule_name: string; is_default: boolean }>;
  lineKey: 'hourly' | 'usage';
  onChange: (pools: BucketPoolDraft[]) => void;
}

/**
 * Flag-on wizard pool draft editor (weighted-burn model).
 *
 * Collects line-level bucket pool drafts locally — name, total hours, overage
 * rate, rollover, scope (member-scoped vs catch-all), member services with a
 * per-service burn multiplier, and an optional after-hours rule (requires an
 * explicit schedule). Nothing is persisted here: drafts travel in
 * wizardData.bucket_pools and are materialized by the wizard submission action
 * after the line is created.
 */
export function BucketPoolDraftEditor({
  pools,
  lineServices,
  schedules,
  lineKey,
  onChange,
}: BucketPoolDraftEditorProps) {
  const { t } = useTranslation('msp/contracts');
  const [showCreate, setShowCreate] = useState(false);

  const updatePools = (next: BucketPoolDraft[]) => onChange(next);

  const addPool = (draft: Omit<BucketPoolDraft, 'line_key'>) => {
    updatePools([...pools, { ...draft, line_key: lineKey }]);
    setShowCreate(false);
  };

  const removePool = (index: number) => {
    updatePools(pools.filter((_, i) => i !== index));
  };

  const updatePool = (index: number, patch: Partial<BucketPoolDraft>) => {
    updatePools(pools.map((pool, i) => (i === index ? { ...pool, ...patch } : pool)));
  };

  const pooledServiceIds = new Set(
    pools.flatMap((pool) => pool.members.map((member) => member.service_id)),
  );
  const unpooledLineServices = lineServices.filter(
    (service) => !pooledServiceIds.has(service.service_id),
  );
  const hasCatchAll = pools.some((pool) => pool.covers_all_services);
  const defaultSchedule = schedules.find((schedule) => schedule.is_default) ?? schedules[0];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2 font-semibold">
          <Layers className="h-4 w-4" />
          {t('wizardBucketPools.heading', {
            defaultValue: 'Bucket pools for this line',
          })}
        </Label>
        <Button
          id="wizard-add-bucket-pool-button"
          type="button"
          variant="outline"
          size="sm"
          disabled={hasCatchAll && pools.length > 0 && unpooledLineServices.length === 0}
          onClick={() => setShowCreate(!showCreate)}
        >
          <Plus className="h-4 w-4 mr-2" />
          {t('bucketPools.actions.addPool', { defaultValue: 'Add Pool' })}
        </Button>
      </div>

      {pools.map((pool, index) => (
        <DraftPoolCard
          key={index}
          pool={pool}
          unpooledServices={pool.covers_all_services ? lineServices : unpooledLineServices}
          hasCatchAll={hasCatchAll}
          defaultSchedule={defaultSchedule}
          schedules={schedules}
          onUpdate={(patch) => updatePool(index, patch)}
          onRemove={() => removePool(index)}
        />
      ))}

      {showCreate && (
        <CreateDraftPoolForm
          unpooledServices={unpooledLineServices}
          hasCatchAll={hasCatchAll}
          defaultSchedule={defaultSchedule}
          schedules={schedules}
          onCancel={() => setShowCreate(false)}
          onCreate={addPool}
        />
      )}

      {pools.length === 0 && !showCreate && (
        <p className="text-sm text-[rgb(var(--color-text-400))]">
          {t('wizardBucketPools.empty', {
            defaultValue: 'No bucket pools on this line yet. Add a pool to include prepaid hours.',
          })}
        </p>
      )}
    </div>
  );
}

interface DraftPoolCardProps {
  pool: BucketPoolDraft;
  unpooledServices: Array<{ service_id: string; service_name: string }>;
  hasCatchAll: boolean;
  defaultSchedule?: { schedule_id: string; schedule_name: string; is_default: boolean };
  schedules: Array<{ schedule_id: string; schedule_name: string; is_default: boolean }>;
  onUpdate: (patch: Partial<BucketPoolDraft>) => void;
  onRemove: () => void;
}

function DraftPoolCard({
  pool,
  unpooledServices,
  hasCatchAll,
  defaultSchedule,
  schedules,
  onUpdate,
  onRemove,
}: DraftPoolCardProps) {
  const { t } = useTranslation('msp/contracts');
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [newMultiplier, setNewMultiplier] = useState('1');
  const [ruleMultiplierInput, setRuleMultiplierInput] = useState<string>(
    pool.after_hours_multiplier != null ? String(pool.after_hours_multiplier) : '',
  );
  const [ruleScheduleId, setRuleScheduleId] = useState<string>(
    pool.business_hours_schedule_id ?? defaultSchedule?.schedule_id ?? '',
  );
  const [ruleEnabled, setRuleEnabled] = useState(pool.after_hours_multiplier != null);

  const effectiveScheduleId = ruleScheduleId || defaultSchedule?.schedule_id || '';

  return (
    <div className="p-4 border border-[rgb(var(--color-border-200))] rounded-md bg-[rgb(var(--color-border-50))] space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1 flex-1">
          <Input
            aria-label={t('bucketPools.labels.poolName', { defaultValue: 'Pool name (optional)' })}
            placeholder={t('bucketPools.labels.poolNamePlaceholder', { defaultValue: 'e.g. Standard hours' })}
            value={pool.bucket_name ?? ''}
            onChange={(e) => onUpdate({ bucket_name: e.target.value || null })}
          />
          <p className="text-xs text-[rgb(var(--color-text-400))]">
            {pool.covers_all_services
              ? t('bucketPools.labels.scopeCatchAll', { defaultValue: 'Covers all services on the line (members are multiplier overrides)' })
              : t('bucketPools.labels.scopeMembers', { defaultValue: 'Member services only' })}
          </p>
        </div>
        <Button id="remove-wizard-bucket-pool-button" type="button" variant="ghost" size="sm" onClick={onRemove} className="text-[rgb(var(--color-destructive))]">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">{t('bucketPools.labels.totalHours', { defaultValue: 'Total hours' })}</Label>
          <Input
            type="number"
            min="0"
            value={pool.total_minutes / 60}
            onChange={(e) => {
              const hours = parseFloat(e.target.value);
              if (Number.isFinite(hours)) onUpdate({ total_minutes: Math.max(0, Math.round(hours * 60)) });
            }}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('bucketPools.labels.overageRate', { defaultValue: 'Overage rate ($/hr)' })}</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={pool.overage_rate / 100}
            onChange={(e) => {
              const dollars = parseFloat(e.target.value);
              if (Number.isFinite(dollars)) onUpdate({ overage_rate: Math.max(0, Math.round(dollars * 100)) });
            }}
          />
        </div>
        <div className="space-y-1 flex items-end">
          <SwitchWithLabel
            label={t('bucketPools.labels.rollover', { defaultValue: 'Allow rollover' })}
            checked={pool.allow_rollover}
            onCheckedChange={(checked) => onUpdate({ allow_rollover: Boolean(checked) })}
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <SwitchWithLabel
          label={t('bucketPools.labels.coversAll', { defaultValue: 'Covers all services on this line' })}
          checked={pool.covers_all_services}
          disabled={hasCatchAll && !pool.covers_all_services}
          onCheckedChange={(checked) => onUpdate({ covers_all_services: Boolean(checked) })}
        />
      </div>

      {/* After-hours rule */}
      <div className="space-y-2 pt-2 border-t border-dashed border-[rgb(var(--color-border-200))]">
        <SwitchWithLabel
          label={t('bucketPools.labels.afterHours', { defaultValue: 'After-hours burn multiplier' })}
          checked={ruleEnabled}
          onCheckedChange={(checked) => {
            setRuleEnabled(Boolean(checked));
            if (!checked) onUpdate({ after_hours_multiplier: null, business_hours_schedule_id: null });
          }}
        />
        {ruleEnabled && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">{t('bucketPools.labels.afterHoursMultiplier', { defaultValue: 'Multiplier (e.g. 1.5)' })}</Label>
              <Input
                type="number"
                min="0.001"
                step="0.001"
                value={ruleMultiplierInput}
                onChange={(e) => setRuleMultiplierInput(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('bucketPools.labels.schedule', { defaultValue: 'Business hours schedule' })}</Label>
              <select
                className="w-full h-10 rounded-md border border-[rgb(var(--color-border-200))] bg-background px-3 text-sm"
                value={effectiveScheduleId}
                onChange={(e) => setRuleScheduleId(e.target.value)}
              >
                {schedules.map((schedule) => (
                  <option key={schedule.schedule_id} value={schedule.schedule_id}>
                    {schedule.schedule_name}{schedule.is_default ? ` (${t('bucketPools.labels.default', { defaultValue: 'default' })})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <Button
              id="apply-wizard-after-hours-rule-button"
              type="button"
              variant="outline"
              size="sm"
              className="md:col-span-2 justify-self-start"
              onClick={() => {
                const multiplier = parseFloat(ruleMultiplierInput);
                if (Number.isFinite(multiplier) && multiplier > 0 && effectiveScheduleId) {
                  onUpdate({ after_hours_multiplier: multiplier, business_hours_schedule_id: effectiveScheduleId });
                }
              }}
            >
              {t('bucketPools.actions.applyRule', { defaultValue: 'Apply after-hours rule' })}
            </Button>
          </div>
        )}
      </div>

      {/* Members */}
      <div className="space-y-2">
        <Label className="text-xs font-semibold">
          {t('bucketPools.labels.members', { defaultValue: 'Member services' })}
        </Label>
        {pool.members.length > 0 && (
          <ul className="space-y-1">
            {pool.members.map((member) => (
              <li key={member.service_id} className="flex items-center justify-between text-sm">
                <span>{member.service_name || member.service_id}</span>
                <span className="flex items-center gap-2">
                  <span className="text-[rgb(var(--color-text-400))]">
                    {t('bucketPools.labels.multiplier', { defaultValue: '×' })} {member.burn_multiplier}
                  </span>
                  <button
                    type="button"
                    className="text-[rgb(var(--color-destructive))] hover:underline"
                    onClick={() => onUpdate({ members: pool.members.filter((m) => m.service_id !== member.service_id) })}
                  >
                    {t('bucketPools.actions.remove', { defaultValue: 'Remove' })}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {!pool.covers_all_services && unpooledServices.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              className="h-9 flex-1 rounded-md border border-[rgb(var(--color-border-200))] bg-background px-2 text-sm"
              value={selectedServiceId}
              onChange={(e) => setSelectedServiceId(e.target.value)}
            >
              <option value="">
                {t('bucketPools.labels.selectService', { defaultValue: 'Select a service…' })}
              </option>
              {unpooledServices.map((service) => (
                <option key={service.service_id} value={service.service_id}>
                  {service.service_name}
                </option>
              ))}
            </select>
            <Input
              type="number"
              min="0.001"
              step="0.001"
              className="w-20"
              value={newMultiplier}
              onChange={(e) => setNewMultiplier(e.target.value)}
              aria-label={t('bucketPools.labels.multiplier', { defaultValue: 'Multiplier' })}
            />
            <Button
              id="add-wizard-pool-member-button"
              type="button"
              variant="outline"
              size="sm"
              disabled={!selectedServiceId}
              onClick={() => {
                const multiplier = parseFloat(newMultiplier);
                const service = unpooledServices.find((s) => s.service_id === selectedServiceId);
                onUpdate({
                  members: [
                    ...pool.members,
                    {
                      service_id: selectedServiceId,
                      service_name: service?.service_name,
                      burn_multiplier: Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1,
                    },
                  ],
                });
                setSelectedServiceId('');
                setNewMultiplier('1');
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

interface CreateDraftPoolFormProps {
  unpooledServices: Array<{ service_id: string; service_name: string }>;
  hasCatchAll: boolean;
  defaultSchedule?: { schedule_id: string; schedule_name: string; is_default: boolean };
  schedules: Array<{ schedule_id: string; schedule_name: string; is_default: boolean }>;
  onCancel: () => void;
  onCreate: (draft: Omit<BucketPoolDraft, 'line_key'>) => void;
}

function CreateDraftPoolForm({
  unpooledServices,
  hasCatchAll,
  defaultSchedule,
  schedules,
  onCancel,
  onCreate,
}: CreateDraftPoolFormProps) {
  const { t } = useTranslation('msp/contracts');
  const [name, setName] = useState('');
  const [totalHours, setTotalHours] = useState('40');
  const [overageRate, setOverageRate] = useState('0');
  const [allowRollover, setAllowRollover] = useState(false);
  const [coversAll, setCoversAll] = useState(false);
  const [members, setMembers] = useState<Array<{ service_id: string; service_name?: string; burn_multiplier: number }>>([]);
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [multiplier, setMultiplier] = useState('1');
  const [afterHoursMultiplier, setAfterHoursMultiplier] = useState('');
  const [scheduleId, setScheduleId] = useState(defaultSchedule?.schedule_id ?? '');

  const availableServices = coversAll ? [] : unpooledServices;

  const submit = () => {
    const hours = parseFloat(totalHours);
    const rate = parseFloat(overageRate);
    const afterHours = parseFloat(afterHoursMultiplier);
    onCreate({
      bucket_name: name || null,
      total_minutes: Number.isFinite(hours) ? Math.max(0, Math.round(hours * 60)) : 0,
      overage_rate: Number.isFinite(rate) ? Math.max(0, Math.round(rate * 100)) : 0,
      allow_rollover: allowRollover,
      covers_all_services: coversAll,
      members,
      after_hours_multiplier: Number.isFinite(afterHours) && afterHours > 0 ? afterHours : null,
      business_hours_schedule_id: Number.isFinite(afterHours) && afterHours > 0
        ? scheduleId || (defaultSchedule?.schedule_id ?? null)
        : null,
    });
  };

  return (
    <div className="p-4 border border-dashed border-[rgb(var(--color-border-300))] rounded-md space-y-3">
      <Label className="text-sm font-semibold">
        {t('bucketPools.actions.addPool', { defaultValue: 'New bucket pool' })}
      </Label>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">{t('bucketPools.labels.poolName', { defaultValue: 'Pool name (optional)' })}</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('bucketPools.labels.totalHours', { defaultValue: 'Total hours' })}</Label>
          <Input type="number" min="0" value={totalHours} onChange={(e) => setTotalHours(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('bucketPools.labels.overageRate', { defaultValue: 'Overage rate ($/hr)' })}</Label>
          <Input type="number" min="0" step="0.01" value={overageRate} onChange={(e) => setOverageRate(e.target.value)} />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <SwitchWithLabel
          label={t('bucketPools.labels.rollover', { defaultValue: 'Allow rollover' })}
          checked={allowRollover}
          onCheckedChange={(checked) => setAllowRollover(Boolean(checked))}
        />
        <SwitchWithLabel
          label={t('bucketPools.labels.coversAll', { defaultValue: 'Covers all services on this line' })}
          checked={coversAll}
          disabled={hasCatchAll}
          onCheckedChange={(checked) => setCoversAll(Boolean(checked))}
        />
      </div>

      {!coversAll && (
        <div className="space-y-2">
          <Label className="text-xs font-semibold">
            {t('bucketPools.labels.members', { defaultValue: 'Member services' })}
          </Label>
          {members.map((member, index) => (
            <div key={member.service_id} className="flex items-center justify-between text-sm">
              <span>{member.service_name || member.service_id}</span>
              <span className="flex items-center gap-2">
                <span>{t('bucketPools.labels.multiplier', { defaultValue: '×' })} {member.burn_multiplier}</span>
                <button type="button" className="text-[rgb(var(--color-destructive))] hover:underline" onClick={() => setMembers(members.filter((_, i) => i !== index))}>
                  {t('bucketPools.actions.remove', { defaultValue: 'Remove' })}
                </button>
              </span>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <select
              className="h-9 flex-1 rounded-md border border-[rgb(var(--color-border-200))] bg-background px-2 text-sm"
              value={selectedServiceId}
              onChange={(e) => setSelectedServiceId(e.target.value)}
            >
              <option value="">{t('bucketPools.labels.selectService', { defaultValue: 'Select a service…' })}</option>
              {availableServices.map((service) => (
                <option key={service.service_id} value={service.service_id}>
                  {service.service_name}
                </option>
              ))}
            </select>
            <Input
              type="number"
              min="0.001"
              step="0.001"
              className="w-20"
              value={multiplier}
              onChange={(e) => setMultiplier(e.target.value)}
            />
            <Button
              id="add-create-wizard-pool-member-button"
              type="button"
              variant="outline"
              size="sm"
              disabled={!selectedServiceId}
              onClick={() => {
                const parsed = parseFloat(multiplier);
                const service = availableServices.find((s) => s.service_id === selectedServiceId);
                setMembers([
                  ...members,
                  { service_id: selectedServiceId, service_name: service?.service_name, burn_multiplier: Number.isFinite(parsed) && parsed > 0 ? parsed : 1 },
                ]);
                setSelectedServiceId('');
                setMultiplier('1');
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <SwitchWithLabel
          label={t('bucketPools.labels.afterHours', { defaultValue: 'After-hours burn multiplier' })}
          checked={afterHoursMultiplier !== ''}
          onCheckedChange={(checked) => setAfterHoursMultiplier(checked ? (defaultSchedule ? '1.5' : '') : '')}
        />
        {afterHoursMultiplier !== '' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">{t('bucketPools.labels.afterHoursMultiplier', { defaultValue: 'Multiplier (e.g. 1.5)' })}</Label>
              <Input type="number" min="0.001" step="0.001" value={afterHoursMultiplier} onChange={(e) => setAfterHoursMultiplier(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('bucketPools.labels.schedule', { defaultValue: 'Business hours schedule' })}</Label>
              <select
                className="w-full h-10 rounded-md border border-[rgb(var(--color-border-200))] bg-background px-3 text-sm"
                value={scheduleId}
                onChange={(e) => setScheduleId(e.target.value)}
              >
                {schedules.map((schedule) => (
                  <option key={schedule.schedule_id} value={schedule.schedule_id}>
                    {schedule.schedule_name}{schedule.is_default ? ` (${t('bucketPools.labels.default', { defaultValue: 'default' })})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button id="create-wizard-bucket-pool-submit" type="button" size="sm" disabled={(!coversAll && members.length === 0)} onClick={submit}>
          {t('bucketPools.actions.create', { defaultValue: 'Create pool' })}
        </Button>
        <Button id="cancel-wizard-bucket-pool-create" type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('bucketPools.actions.cancel', { defaultValue: 'Cancel' })}
        </Button>
      </div>
    </div>
  );
}
