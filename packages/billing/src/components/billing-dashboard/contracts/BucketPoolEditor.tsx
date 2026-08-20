'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, AlertTriangle, Layers } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { SwitchWithLabel } from '@alga-psa/ui/components/SwitchWithLabel';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import {
  listBucketPoolsForLine,
  createBucketPool,
  updateBucketPool,
  addBucketPoolMember,
  removeBucketPoolMember,
  deleteBucketPool,
  setBucketPoolAfterHoursRule,
  type BucketPoolSnapshot,
  type BucketPoolActionError,
} from '@alga-psa/billing/actions/bucketPoolActions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

function isBucketPoolError(result: unknown): result is BucketPoolActionError {
  return Boolean(
    result &&
    typeof result === 'object' &&
    'message' in result &&
    typeof (result as { message?: unknown }).message === 'string',
  );
}

export interface BucketPoolEditorProps {
  contractLineId: string;
  /** Services already on this line (picker options). */
  lineServices: Array<{ service_id: string; service_name: string }>;
  /** All services in the tenant catalog, so members outside the line can be added. */
  allServices: Array<{ service_id: string; service_name: string }>;
  /** Business-hours schedules for the after-hours rule (tenant default first). */
  schedules: Array<{ schedule_id: string; schedule_name: string; is_default: boolean }>;
  onChanged?: () => void;
}

/**
 * Flag-on line-level bucket pools editor (weighted-burn model).
 *
 * A bucket is a line-owned pool: name, total hours, overage rate, rollover,
 * scope (member-scoped vs catch-all), member services with a per-service burn
 * multiplier, and an optional after-hours rule (requires an explicit schedule).
 */
export function BucketPoolEditor({
  contractLineId,
  lineServices,
  allServices,
  schedules,
  onChanged,
}: BucketPoolEditorProps) {
  const { t } = useTranslation('msp/contracts');
  const [pools, setPools] = useState<BucketPoolSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const reload = async () => {
    const result = await listBucketPoolsForLine(contractLineId);
    if (Array.isArray(result)) {
      setPools(result);
      setError(null);
    } else {
      setError((result as { message?: string } | null)?.message ?? 'Unable to load bucket pools');
    }
    setLoading(false);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractLineId]);

  const pooledServiceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const pool of pools) {
      for (const member of pool.members) {
        ids.add(member.service_id);
      }
    }
    return ids;
  }, [pools]);

  const hasCatchAll = pools.some((pool) => pool.covers_all_services);
  const defaultSchedule = schedules.find((schedule) => schedule.is_default) ?? schedules[0];

  const handleError = (result: BucketPoolActionError): void => {
    setError((result as { message?: string }).message ?? 'An error occurred');
  };

  const handleCreatePool = async (draft: {
    name: string;
    totalHours: number;
    overageRateDollars: number;
    allowRollover: boolean;
    coversAll: boolean;
    members: Array<{ service_id: string; burn_multiplier: number }>;
    afterHoursMultiplier: number | null;
    scheduleId: string | null;
  }) => {
    setError(null);
    const result = await createBucketPool(
      contractLineId,
      {
        bucket_name: draft.name || null,
        total_minutes: Math.round(draft.totalHours * 60),
        overage_rate: Math.round(draft.overageRateDollars * 100),
        allow_rollover: draft.allowRollover,
        covers_all_services: draft.coversAll,
        after_hours_multiplier: draft.afterHoursMultiplier,
        business_hours_schedule_id: draft.afterHoursMultiplier ? draft.scheduleId : null,
      },
      draft.coversAll ? [] : draft.members,
    );
    if (isBucketPoolError(result)) {
      handleError(result);
      return;
    }
    onChanged?.();
    await reload();
  };

  const handleUpdatePool = async (pool: BucketPoolSnapshot, patch: {
    bucket_name?: string | null;
    total_minutes?: number;
    overage_rate?: number;
    allow_rollover?: boolean;
    after_hours_multiplier?: number | null;
    business_hours_schedule_id?: string | null;
  }) => {
    setError(null);
    const result = await updateBucketPool(pool.bucket_id, {
      bucket_name: patch.bucket_name ?? pool.bucket_name,
      total_minutes: patch.total_minutes ?? pool.total_minutes,
      overage_rate: patch.overage_rate ?? pool.overage_rate,
      allow_rollover: patch.allow_rollover ?? pool.allow_rollover,
      covers_all_services: pool.covers_all_services,
      after_hours_multiplier: patch.after_hours_multiplier !== undefined ? patch.after_hours_multiplier : pool.after_hours_multiplier,
      business_hours_schedule_id: patch.business_hours_schedule_id !== undefined ? patch.business_hours_schedule_id : pool.business_hours_schedule_id,
    });
    if (isBucketPoolError(result)) {
      handleError(result);
      return;
    }
    onChanged?.();
    await reload();
  };

  const handleAddMember = async (pool: BucketPoolSnapshot, serviceId: string, multiplier: number) => {
    setError(null);
    const result = await addBucketPoolMember(pool.bucket_id, { service_id: serviceId, burn_multiplier: multiplier });
    if (isBucketPoolError(result)) {
      handleError(result);
      return;
    }
    onChanged?.();
    await reload();
  };

  const handleRemoveMember = async (pool: BucketPoolSnapshot, serviceId: string) => {
    setError(null);
    const result = await removeBucketPoolMember(pool.bucket_id, serviceId);
    if (isBucketPoolError(result)) {
      handleError(result);
      return;
    }
    onChanged?.();
    await reload();
  };

  const handleDeletePool = async (pool: BucketPoolSnapshot) => {
    setError(null);
    const result = await deleteBucketPool(pool.bucket_id);
    if (isBucketPoolError(result)) {
      handleError(result);
      return;
    }
    onChanged?.();
    await reload();
  };

  const handleSetRule = async (pool: BucketPoolSnapshot, multiplier: number | null, scheduleId: string | null) => {
    setError(null);
    const result = await setBucketPoolAfterHoursRule(pool.bucket_id, multiplier, scheduleId);
    if (isBucketPoolError(result)) {
      handleError(result);
      return;
    }
    onChanged?.();
    await reload();
  };

  const unpooledLineServices = lineServices.filter((service) => !pooledServiceIds.has(service.service_id));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2 font-semibold">
          <Layers className="h-4 w-4" />
          {t('bucketPools.heading', { defaultValue: 'Bucket Pools' })}
        </Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowCreate(!showCreate)}
          id="add-bucket-pool-button"
        >
          <Plus className="h-4 w-4 mr-2" />
          {t('bucketPools.actions.addPool', { defaultValue: 'Add Pool' })}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <p className="text-sm text-[rgb(var(--color-text-400))]">
          {t('bucketPools.loading', { defaultValue: 'Loading bucket pools…' })}
        </p>
      ) : (
        <>
          {pools.map((pool) => (
            <PoolCard
              key={pool.bucket_id}
              pool={pool}
              unpooledServices={pool.covers_all_services
                ? allServices.filter((service) => !pooledServiceIds.has(service.service_id))
                : unpooledLineServices}
              defaultSchedule={defaultSchedule}
              schedules={schedules}
              onUpdate={(patch) => handleUpdatePool(pool, patch)}
              onAddMember={(serviceId, multiplier) => handleAddMember(pool, serviceId, multiplier)}
              onRemoveMember={(serviceId) => handleRemoveMember(pool, serviceId)}
              onDelete={() => handleDeletePool(pool)}
              onSetRule={(multiplier, scheduleId) => handleSetRule(pool, multiplier, scheduleId)}
            />
          ))}

          {showCreate && (
            <CreatePoolForm
              unpooledServices={unpooledLineServices}
              hasCatchAll={hasCatchAll}
              defaultSchedule={defaultSchedule}
              schedules={schedules}
              onCancel={() => setShowCreate(false)}
              onCreate={handleCreatePool}
            />
          )}

          {pools.length === 0 && !showCreate && (
            <p className="text-sm text-[rgb(var(--color-text-400))]">
              {t('bucketPools.empty', {
                defaultValue: 'No bucket pools on this line. Add a pool to include prepaid hours.',
              })}
            </p>
          )}
        </>
      )}
    </div>
  );
}

interface PoolCardProps {
  pool: BucketPoolSnapshot;
  unpooledServices: Array<{ service_id: string; service_name: string }>;
  defaultSchedule?: { schedule_id: string; schedule_name: string; is_default: boolean };
  schedules: Array<{ schedule_id: string; schedule_name: string; is_default: boolean }>;
  onUpdate: (patch: {
    bucket_name?: string | null;
    total_minutes?: number;
    overage_rate?: number;
    allow_rollover?: boolean;
  }) => void;
  onAddMember: (serviceId: string, multiplier: number) => void;
  onRemoveMember: (serviceId: string) => void;
  onDelete: () => void;
  onSetRule: (multiplier: number | null, scheduleId: string | null) => void;
}

function PoolCard({
  pool,
  unpooledServices,
  defaultSchedule,
  schedules,
  onUpdate,
  onAddMember,
  onRemoveMember,
  onDelete,
  onSetRule,
}: PoolCardProps) {
  const { t } = useTranslation('msp/contracts');
  const [hoursInput, setHoursInput] = useState<string>((pool.total_minutes / 60).toString());
  const [rateInput, setRateInput] = useState<string>((pool.overage_rate / 100).toFixed(2));
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

  const applyHours = () => {
    const hours = parseFloat(hoursInput);
    if (Number.isFinite(hours)) {
      onUpdate({ total_minutes: Math.max(0, Math.round(hours * 60)) });
    }
  };

  const applyRate = () => {
    const dollars = parseFloat(rateInput);
    if (Number.isFinite(dollars)) {
      onUpdate({ overage_rate: Math.max(0, Math.round(dollars * 100)) });
    }
  };

  const applyRule = () => {
    if (!ruleEnabled) {
      onSetRule(null, null);
      return;
    }
    const multiplier = parseFloat(ruleMultiplierInput);
    if (Number.isFinite(multiplier) && multiplier > 0 && effectiveScheduleId) {
      onSetRule(multiplier, effectiveScheduleId);
    }
  };

  return (
    <div className="p-4 border border-[rgb(var(--color-border-200))] rounded-md bg-[rgb(var(--color-border-50))] space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1 flex-1">
          <Label className="text-sm font-semibold">
            {pool.bucket_name || (pool.covers_all_services
              ? t('bucketPools.labels.catchAll', { defaultValue: 'All services on this line' })
              : pool.members[0]?.service_name ?? t('bucketPools.labels.pool', { defaultValue: 'Bucket pool' }))}
            {pool.dormant && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-700">
                <AlertTriangle className="h-3 w-3" />
                {t('bucketPools.badges.dormant', {
                  defaultValue: 'no services attached — nothing burns from this pool',
                })}
              </span>
            )}
          </Label>
          <p className="text-xs text-[rgb(var(--color-text-400))]">
            {pool.covers_all_services
              ? t('bucketPools.labels.scopeCatchAll', { defaultValue: 'Covers all services on the line (members are multiplier overrides)' })
              : t('bucketPools.labels.scopeMembers', { defaultValue: 'Member services only' })}
          </p>
        </div>
        <Button id="delete-bucket-pool-button" type="button" variant="ghost" size="sm" onClick={onDelete} className="text-[rgb(var(--color-destructive))]">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">{t('bucketPools.labels.totalHours', { defaultValue: 'Total hours' })}</Label>
          <Input type="number" min="0" value={hoursInput} onChange={(e) => setHoursInput(e.target.value)} onBlur={applyHours} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('bucketPools.labels.overageRate', { defaultValue: 'Overage rate ($/hr)' })}</Label>
          <Input type="number" min="0" step="0.01" value={rateInput} onChange={(e) => setRateInput(e.target.value)} onBlur={applyRate} />
        </div>
        <div className="space-y-1 flex items-end">
          <SwitchWithLabel
            label={t('bucketPools.labels.rollover', { defaultValue: 'Allow rollover' })}
            checked={pool.allow_rollover}
            onCheckedChange={(checked) => onUpdate({ allow_rollover: Boolean(checked) })}
          />
        </div>
      </div>

      {/* After-hours rule */}
      <div className="space-y-2 pt-2 border-t border-dashed border-[rgb(var(--color-border-200))]">
        <SwitchWithLabel
          label={t('bucketPools.labels.afterHours', { defaultValue: 'After-hours burn multiplier' })}
          checked={ruleEnabled}
          onCheckedChange={(checked) => {
            setRuleEnabled(Boolean(checked));
            if (!checked) {
              onSetRule(null, null);
            }
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
            <Button id="apply-after-hours-rule-button" type="button" variant="outline" size="sm" className="md:col-span-2 justify-self-start" onClick={applyRule}>
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
        {pool.members.length > 0 ? (
          <ul className="space-y-1">
            {pool.members.map((member) => (
              <li key={member.service_id} className="flex items-center justify-between text-sm">
                <span>{member.service_name}</span>
                <span className="flex items-center gap-2">
                  <span className="text-[rgb(var(--color-text-400))]">
                    {t('bucketPools.labels.multiplier', { defaultValue: '×' })} {member.burn_multiplier}
                  </span>
                  <button
                    type="button"
                    className="text-[rgb(var(--color-destructive))] hover:underline"
                    onClick={() => onRemoveMember(member.service_id)}
                  >
                    {t('bucketPools.actions.remove', { defaultValue: 'Remove' })}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          !pool.covers_all_services && (
            <p className="text-xs text-[rgb(var(--color-text-400))]">
              {t('bucketPools.labels.noMembers', { defaultValue: 'No member services attached.' })}
            </p>
          )
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
              id="add-pool-member-button"
              type="button"
              variant="outline"
              size="sm"
              disabled={!selectedServiceId}
              onClick={() => {
                const multiplier = parseFloat(newMultiplier);
                onAddMember(selectedServiceId, Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1);
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

interface CreatePoolFormProps {
  unpooledServices: Array<{ service_id: string; service_name: string }>;
  hasCatchAll: boolean;
  defaultSchedule?: { schedule_id: string; schedule_name: string; is_default: boolean };
  schedules: Array<{ schedule_id: string; schedule_name: string; is_default: boolean }>;
  onCancel: () => void;
  onCreate: (draft: {
    name: string;
    totalHours: number;
    overageRateDollars: number;
    allowRollover: boolean;
    coversAll: boolean;
    members: Array<{ service_id: string; burn_multiplier: number }>;
    afterHoursMultiplier: number | null;
    scheduleId: string | null;
  }) => Promise<void>;
}

function CreatePoolForm({
  unpooledServices,
  hasCatchAll,
  defaultSchedule,
  schedules,
  onCancel,
  onCreate,
}: CreatePoolFormProps) {
  const { t } = useTranslation('msp/contracts');
  const [name, setName] = useState('');
  const [totalHours, setTotalHours] = useState('40');
  const [overageRate, setOverageRate] = useState('0');
  const [allowRollover, setAllowRollover] = useState(false);
  const [coversAll, setCoversAll] = useState(false);
  const [members, setMembers] = useState<Array<{ service_id: string; burn_multiplier: number }>>([]);
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [multiplier, setMultiplier] = useState('1');
  const [afterHoursMultiplier, setAfterHoursMultiplier] = useState('');
  const [scheduleId, setScheduleId] = useState(defaultSchedule?.schedule_id ?? '');

  const availableServices = coversAll ? [] : unpooledServices;

  const submit = () => {
    const hours = parseFloat(totalHours);
    const rate = parseFloat(overageRate);
    const afterHours = parseFloat(afterHoursMultiplier);
    void onCreate({
      name,
      totalHours: Number.isFinite(hours) ? hours : 0,
      overageRateDollars: Number.isFinite(rate) ? rate : 0,
      allowRollover,
      coversAll,
      members,
      afterHoursMultiplier: Number.isFinite(afterHours) && afterHours > 0 ? afterHours : null,
      scheduleId: scheduleId || (defaultSchedule?.schedule_id ?? null),
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
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('bucketPools.labels.poolNamePlaceholder', { defaultValue: 'e.g. Standard hours' })} />
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
      {coversAll && hasCatchAll && (
        <p className="text-xs text-amber-700">
          {t('bucketPools.errors.catchAllExists', {
            defaultValue: 'This line already has a catch-all pool.',
          })}
        </p>
      )}

      {!coversAll && (
        <div className="space-y-2">
          <Label className="text-xs font-semibold">
            {t('bucketPools.labels.members', { defaultValue: 'Member services' })}
          </Label>
          {members.map((member, index) => (
            <div key={member.service_id} className="flex items-center justify-between text-sm">
              <span>{availableServices.find((service) => service.service_id === member.service_id)?.service_name ?? member.service_id}</span>
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
              id="create-pool-member-button"
              type="button"
              variant="outline"
              size="sm"
              disabled={!selectedServiceId}
              onClick={() => {
                const parsed = parseFloat(multiplier);
                setMembers([...members, { service_id: selectedServiceId, burn_multiplier: Number.isFinite(parsed) && parsed > 0 ? parsed : 1 }]);
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
        <Button id="create-bucket-pool-submit" type="button" size="sm" disabled={(!coversAll && members.length === 0)} onClick={submit}>
          {t('bucketPools.actions.create', { defaultValue: 'Create pool' })}
        </Button>
        <Button id="cancel-bucket-pool-create" type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('bucketPools.actions.cancel', { defaultValue: 'Cancel' })}
        </Button>
      </div>
    </div>
  );
}
