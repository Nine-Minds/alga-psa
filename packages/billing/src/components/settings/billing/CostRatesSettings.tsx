'use client';

import React from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import Spinner from '@alga-psa/ui/components/Spinner';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  checkCostRateWorkedTimeImpact,
  deleteCostRate,
  listCostRates,
  upsertCostRate,
  type CostRateUserRow,
  type ListCostRatesResult,
  type UpsertCostRateActionInput,
} from '@alga-psa/billing/actions';
import type { IUserCostRate } from '@alga-psa/types';
import toast from 'react-hot-toast';

type RateFormState = {
  rateId?: string;
  userId: string;
  costRate: string;
  effectiveFrom: string;
  effectiveTo: string;
};

type PendingOperation =
  | { type: 'save'; form: RateFormState }
  | { type: 'delete'; rate: IUserCostRate };

const DEFAULT_USER_ID = 'default';

function centsToCurrency(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) {
    return '';
  }

  return (Number(cents) / 100).toFixed(2);
}

function formatRate(
  cents: number | null | undefined,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (cents === null || cents === undefined) {
    return t('costRates.formats.noRate', { defaultValue: '—' });
  }

  return t('costRates.formats.hourlyRate', {
    defaultValue: '${{amount}}/hr',
    amount: centsToCurrency(cents),
  });
}

function formatDateRange(rate: IUserCostRate, t: ReturnType<typeof useTranslation>['t']): string {
  return rate.effective_to
    ? t('costRates.formats.dateRange', {
      defaultValue: '{{start}} - {{end}}',
      start: rate.effective_from,
      end: rate.effective_to,
    })
    : t('costRates.formats.openDateRange', {
      defaultValue: '{{start}} - open',
      start: rate.effective_from,
    });
}

function userLabel(user: Pick<CostRateUserRow, 'first_name' | 'last_name' | 'username'>): string {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return fullName || user.username;
}

function blankForm(userId = DEFAULT_USER_ID): RateFormState {
  return {
    userId,
    costRate: '',
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveTo: '',
  };
}

function formFromRate(rate: IUserCostRate): RateFormState {
  return {
    rateId: rate.rate_id,
    userId: rate.user_id ?? DEFAULT_USER_ID,
    costRate: centsToCurrency(rate.cost_rate),
    effectiveFrom: rate.effective_from,
    effectiveTo: rate.effective_to ?? '',
  };
}

export default function CostRatesSettings(): React.JSX.Element {
  const { t } = useTranslation('msp/billing-settings');
  const [data, setData] = React.useState<ListCostRatesResult | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [expandedUsers, setExpandedUsers] = React.useState<Set<string>>(new Set());
  const [isRateDialogOpen, setIsRateDialogOpen] = React.useState(false);
  const [isWarningDialogOpen, setIsWarningDialogOpen] = React.useState(false);
  const [pendingOperation, setPendingOperation] = React.useState<PendingOperation | null>(null);
  const [form, setForm] = React.useState<RateFormState>(blankForm());

  const loadRates = React.useCallback(async () => {
    try {
      setLoading(true);
      setData(await listCostRates());
    } catch (error) {
      handleError(error, t('costRates.errors.load', { defaultValue: 'Failed to load cost rates' }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    loadRates();
  }, [loadRates]);

  const defaultRate = React.useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return data?.default_rate_history.find((rate) => (
      rate.effective_from <= today && (!rate.effective_to || rate.effective_to >= today)
    )) ?? null;
  }, [data]);

  const allRates = React.useMemo(() => {
    if (!data) {
      return [];
    }

    return [
      ...data.default_rate_history,
      ...data.users.flatMap((user) => user.rate_history),
    ];
  }, [data]);

  const openCreateDialog = (userId = DEFAULT_USER_ID) => {
    setForm(blankForm(userId));
    setIsRateDialogOpen(true);
  };

  const openEditDialog = (rate: IUserCostRate) => {
    setForm(formFromRate(rate));
    setIsRateDialogOpen(true);
  };

  const updateForm = (field: keyof RateFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const toActionInput = (state: RateFormState): UpsertCostRateActionInput => {
    const parsedRate = Math.round(Number.parseFloat(state.costRate || '0') * 100);
    return {
      rate_id: state.rateId,
      user_id: state.userId === DEFAULT_USER_ID ? null : state.userId,
      cost_rate: Number.isFinite(parsedRate) ? parsedRate : 0,
      effective_from: state.effectiveFrom,
      effective_to: state.effectiveTo || null,
    };
  };

  const performSave = async (state: RateFormState) => {
    try {
      setSaving(true);
      await upsertCostRate(toActionInput(state));
      toast.success(t('costRates.toast.saved', { defaultValue: 'Cost rate saved.' }));
      setIsRateDialogOpen(false);
      setPendingOperation(null);
      await loadRates();
    } catch (error) {
      handleError(error, t('costRates.errors.save', { defaultValue: 'Failed to save cost rate' }));
    } finally {
      setSaving(false);
    }
  };

  const submitRate = async () => {
    if (form.rateId) {
      const existing = allRates.find((rate) => rate.rate_id === form.rateId);
      if (existing) {
        const impact = await checkCostRateWorkedTimeImpact({
          user_id: existing.user_id,
          effective_from: existing.effective_from,
          effective_to: existing.effective_to,
        });
        if (impact.covers_worked_time) {
          setPendingOperation({ type: 'save', form });
          setIsWarningDialogOpen(true);
          return;
        }
      }
    }

    await performSave(form);
  };

  const requestDelete = async (rate: IUserCostRate) => {
    try {
      const impact = await checkCostRateWorkedTimeImpact({
        user_id: rate.user_id,
        effective_from: rate.effective_from,
        effective_to: rate.effective_to,
      });
      setPendingOperation({ type: 'delete', rate });
      setIsWarningDialogOpen(impact.covers_worked_time);
      if (!impact.covers_worked_time) {
        await performDelete(rate);
      }
    } catch (error) {
      handleError(error, t('costRates.errors.delete', { defaultValue: 'Failed to delete cost rate' }));
    }
  };

  const performDelete = async (rate: IUserCostRate) => {
    try {
      setSaving(true);
      await deleteCostRate(rate.rate_id);
      toast.success(t('costRates.toast.deleted', { defaultValue: 'Cost rate deleted.' }));
      setPendingOperation(null);
      await loadRates();
    } catch (error) {
      handleError(error, t('costRates.errors.delete', { defaultValue: 'Failed to delete cost rate' }));
    } finally {
      setSaving(false);
    }
  };

  const confirmPendingOperation = async () => {
    const pending = pendingOperation;
    setIsWarningDialogOpen(false);
    if (!pending) {
      return;
    }

    if (pending.type === 'save') {
      await performSave(pending.form);
    } else {
      await performDelete(pending.rate);
    }
  };

  const toggleExpanded = (userId: string) => {
    setExpandedUsers((current) => {
      const next = new Set(current);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Spinner size="sm" />
        {t('costRates.loading', { defaultValue: 'Loading cost rates...' })}
      </div>
    );
  }

  const hasAnyRate = allRates.length > 0;

  return (
    <div className="space-y-5">
      <div className="rounded-md border border-border-200 bg-background-50 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-sm font-semibold">
              {t('costRates.default.title', { defaultValue: 'Tenant default cost rate' })}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {defaultRate
                ? t('costRates.default.current', {
                  defaultValue: 'Current default: {{rate}} from {{date}}',
                  rate: formatRate(defaultRate.cost_rate, t),
                  date: defaultRate.effective_from,
                })
                : t('costRates.default.missing', {
                  defaultValue: 'No tenant default is configured. Users without overrides will be uncosted.',
                })}
            </p>
          </div>
          <Button id="add-default-cost-rate" onClick={() => openCreateDialog(DEFAULT_USER_ID)}>
            <Plus className="mr-2 h-4 w-4" />
            {t('costRates.actions.setDefault', { defaultValue: 'Set Default' })}
          </Button>
        </div>
      </div>

      {!hasAnyRate && (
        <div className="rounded-md border border-dashed border-border-300 p-6 text-center">
          <p className="text-sm font-medium">
            {t('costRates.empty.title', { defaultValue: 'Cost rates are not configured' })}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('costRates.empty.description', {
              defaultValue: 'Set the tenant default first so reports can cost labor for users without overrides.',
            })}
          </p>
          <Button id="empty-set-default-cost-rate" className="mt-4" onClick={() => openCreateDialog(DEFAULT_USER_ID)}>
            <Plus className="mr-2 h-4 w-4" />
            {t('costRates.actions.setDefault', { defaultValue: 'Set Default' })}
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-border-200">
        <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(8rem,0.7fr)_auto] gap-3 bg-muted/40 px-4 py-2 text-xs font-medium uppercase text-muted-foreground">
          <span>{t('costRates.table.user', { defaultValue: 'User' })}</span>
          <span>{t('costRates.table.currentRate', { defaultValue: 'Current Rate' })}</span>
          <span className="text-right">{t('costRates.table.actions', { defaultValue: 'Actions' })}</span>
        </div>
        {data?.users.map((user) => {
          const expanded = expandedUsers.has(user.user_id);
          return (
            <div key={user.user_id} className="border-t border-border-200">
              <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(8rem,0.7fr)_auto] items-center gap-3 px-4 py-3">
                <button
                  id={`toggle-cost-rate-history-${user.user_id}`}
                  type="button"
                  className="flex min-w-0 items-center gap-2 text-left"
                  onClick={() => toggleExpanded(user.user_id)}
                >
                  {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{userLabel(user)}</span>
                    <span className="block truncate text-xs text-muted-foreground">{user.email || user.username}</span>
                  </span>
                </button>
                <div className="text-sm">
                  {user.current_rate
                    ? formatRate(user.current_rate.cost_rate, t)
                    : defaultRate
                      ? t('costRates.table.usesDefault', { defaultValue: 'Uses default' })
                      : t('costRates.table.uncosted', { defaultValue: 'Uncosted' })}
                </div>
                <div className="flex justify-end gap-2">
                  <Button id={`add-cost-rate-${user.user_id}`} size="sm" variant="outline" onClick={() => openCreateDialog(user.user_id)}>
                    <Plus className="h-4 w-4" />
                    <span className="sr-only">{t('costRates.actions.addUserRate', { defaultValue: 'Add user rate' })}</span>
                  </Button>
                </div>
              </div>
              {expanded && (
                <div className="bg-background-50 px-10 pb-4">
                  {user.rate_history.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t('costRates.history.empty', { defaultValue: 'No user-specific rates.' })}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {user.rate_history.map((rate) => (
                        <div key={rate.rate_id} className="flex items-center justify-between rounded-md border border-border-200 bg-background px-3 py-2">
                          <div className="text-sm">
                            <span className="font-medium">{formatRate(rate.cost_rate, t)}</span>
                            <span className="ml-2 text-muted-foreground">{formatDateRange(rate, t)}</span>
                          </div>
                          <div className="flex gap-2">
                            <Button id={`edit-cost-rate-${rate.rate_id}`} size="sm" variant="ghost" onClick={() => openEditDialog(rate)}>
                              <Pencil className="h-4 w-4" />
                              <span className="sr-only">{t('costRates.actions.edit', { defaultValue: 'Edit' })}</span>
                            </Button>
                            <Button id={`delete-cost-rate-${rate.rate_id}`} size="sm" variant="ghost" onClick={() => requestDelete(rate)}>
                              <Trash2 className="h-4 w-4" />
                              <span className="sr-only">{t('costRates.actions.delete', { defaultValue: 'Delete' })}</span>
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {data && data.default_rate_history.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t('costRates.default.history', { defaultValue: 'Default rate history' })}</h3>
          {data.default_rate_history.map((rate) => (
            <div key={rate.rate_id} className="flex items-center justify-between rounded-md border border-border-200 px-3 py-2">
              <div className="text-sm">
                <span className="font-medium">{formatRate(rate.cost_rate, t)}</span>
                <span className="ml-2 text-muted-foreground">{formatDateRange(rate, t)}</span>
              </div>
              <div className="flex gap-2">
                <Button id={`edit-default-cost-rate-${rate.rate_id}`} size="sm" variant="ghost" onClick={() => openEditDialog(rate)}>
                  <Pencil className="h-4 w-4" />
                  <span className="sr-only">{t('costRates.actions.edit', { defaultValue: 'Edit' })}</span>
                </Button>
                <Button id={`delete-default-cost-rate-${rate.rate_id}`} size="sm" variant="ghost" onClick={() => requestDelete(rate)}>
                  <Trash2 className="h-4 w-4" />
                  <span className="sr-only">{t('costRates.actions.delete', { defaultValue: 'Delete' })}</span>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog
        id="cost-rate-editor"
        isOpen={isRateDialogOpen}
        onClose={() => setIsRateDialogOpen(false)}
        title={t('costRates.dialog.title', { defaultValue: 'Cost Rate' })}
        draggable={false}
        footer={(
          <DialogFooter className="mt-0">
            <Button id="cancel-cost-rate" variant="outline" onClick={() => setIsRateDialogOpen(false)}>
              {t('costRates.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button id="save-cost-rate" onClick={submitRate} disabled={saving || !form.costRate || !form.effectiveFrom}>
              {saving
                ? t('costRates.actions.saving', { defaultValue: 'Saving...' })
                : t('costRates.actions.save', { defaultValue: 'Save' })}
            </Button>
          </DialogFooter>
        )}
      >
        <DialogContent className="space-y-4">
          <DialogDescription>
            {t('costRates.dialog.description', {
              defaultValue: 'Enter fully burdened hourly labor cost in the tenant default currency.',
            })}
          </DialogDescription>
          <div className="space-y-2">
            <Label htmlFor="cost-rate-user">{t('costRates.fields.user.label', { defaultValue: 'User' })}</Label>
            <select
              id="cost-rate-user"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.userId}
              disabled={Boolean(form.rateId)}
              onChange={(event) => updateForm('userId', event.target.value)}
            >
              <option value={DEFAULT_USER_ID}>{t('costRates.fields.user.default', { defaultValue: 'Tenant default' })}</option>
              {data?.users.map((user) => (
                <option key={user.user_id} value={user.user_id}>{userLabel(user)}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="cost-rate-amount">{t('costRates.fields.rate.label', { defaultValue: 'Hourly Cost' })}</Label>
              <Input
                id="cost-rate-amount"
                type="number"
                min="0"
                step="0.01"
                value={form.costRate}
                onChange={(event) => updateForm('costRate', event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cost-rate-effective-from">{t('costRates.fields.effectiveFrom.label', { defaultValue: 'Effective From' })}</Label>
              <Input
                id="cost-rate-effective-from"
                type="date"
                value={form.effectiveFrom}
                onChange={(event) => updateForm('effectiveFrom', event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cost-rate-effective-to">{t('costRates.fields.effectiveTo.label', { defaultValue: 'Effective To' })}</Label>
              <Input
                id="cost-rate-effective-to"
                type="date"
                value={form.effectiveTo}
                onChange={(event) => updateForm('effectiveTo', event.target.value)}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        id="cost-rate-worked-time-warning"
        isOpen={isWarningDialogOpen}
        onClose={() => setIsWarningDialogOpen(false)}
        title={t('costRates.warning.title', { defaultValue: 'Worked time exists in this range' })}
        draggable={false}
        footer={(
          <DialogFooter className="mt-0">
            <Button id="cancel-cost-rate-warning" variant="outline" onClick={() => setIsWarningDialogOpen(false)}>
              {t('costRates.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button id="confirm-cost-rate-warning" onClick={confirmPendingOperation} disabled={saving}>
              {t('costRates.actions.continue', { defaultValue: 'Continue' })}
            </Button>
          </DialogFooter>
        )}
      >
        <DialogContent>
          <DialogDescription>
            {t('costRates.warning.description', {
              defaultValue: 'Changing this rate will change historical profitability for time entries in its effective date range.',
            })}
          </DialogDescription>
          <div className="mt-4 flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t('costRates.warning.body', { defaultValue: 'Continue only when this is an intentional correction.' })}</span>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
