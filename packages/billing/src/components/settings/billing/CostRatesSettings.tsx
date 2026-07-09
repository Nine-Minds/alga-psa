'use client';

import React from 'react';
import { AlertTriangle, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { Dialog, DialogContent, DialogDescription, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Label } from '@alga-psa/ui/components/Label';
import Spinner from '@alga-psa/ui/components/Spinner';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation, useFormatters } from '@alga-psa/ui/lib/i18n/client';
import {
  checkCostRateWorkedTimeImpact,
  deleteCostRate,
  listCostRates,
  upsertCostRate,
  type CostRateUserRow,
  type ListCostRatesResult,
  type UpsertCostRateActionInput,
} from '../../../actions/costRateActions';
import type { ColumnDefinition, IUserCostRate } from '@alga-psa/types';
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

type CostRateRow = IUserCostRate & { scope_label?: string; status: RateStatus };

const DEFAULT_USER_ID = 'default';

function centsToCurrency(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) {
    return '';
  }

  return (Number(cents) / 100).toFixed(2);
}

type RateStatus = 'current' | 'scheduled' | 'ended';

function rateStatus(rate: IUserCostRate, today: string): RateStatus {
  if (rate.effective_from > today) {
    return 'scheduled';
  }
  if (rate.effective_to && rate.effective_to < today) {
    return 'ended';
  }
  return 'current';
}

function dateFromString(value: string): Date | undefined {
  return value ? new Date(`${value}T00:00:00`) : undefined;
}

function dateToString(date: Date | null | undefined): string {
  if (!date) {
    return '';
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
  const { formatCurrency } = useFormatters();
  const [data, setData] = React.useState<ListCostRatesResult | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [isRateDialogOpen, setIsRateDialogOpen] = React.useState(false);
  const [isWarningDialogOpen, setIsWarningDialogOpen] = React.useState(false);
  const [pendingOperation, setPendingOperation] = React.useState<PendingOperation | null>(null);
  const [form, setForm] = React.useState<RateFormState>(blankForm());
  const [defaultPage, setDefaultPage] = React.useState(1);
  const [defaultPageSize, setDefaultPageSize] = React.useState(10);
  const [usersPage, setUsersPage] = React.useState(1);
  const [usersPageSize, setUsersPageSize] = React.useState(10);

  // Rates render in the tenant default currency — the same currency the
  // profitability report costs them in.
  const currencyCode = data?.currency_code ?? 'USD';
  const formatRate = (cents: number | null | undefined): string => (
    cents === null || cents === undefined
      ? t('costRates.formats.noRate', { defaultValue: '—' })
      : t('costRates.formats.hourlyRate', {
        defaultValue: '{{amount}}/hr',
        amount: formatCurrency(Number(cents) / 100, currencyCode),
      })
  );

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

  const defaultRows = React.useMemo<CostRateRow[]>(() => {
    if (!data) {
      return [];
    }

    const today = dateToString(new Date());
    return data.default_rate_history
      .map((rate) => ({ ...rate, status: rateStatus(rate, today) }))
      .sort((left, right) => right.effective_from.localeCompare(left.effective_from));
  }, [data]);

  const userRows = React.useMemo<CostRateRow[]>(() => {
    if (!data) {
      return [];
    }

    const today = dateToString(new Date());
    return data.users
      .flatMap((user) => user.rate_history.map((rate) => ({ ...rate, scope_label: userLabel(user), status: rateStatus(rate, today) })))
      .sort((left, right) => (
        (left.scope_label ?? '').localeCompare(right.scope_label ?? '')
          || right.effective_from.localeCompare(left.effective_from)
      ));
  }, [data]);

  const openCreateDialog = () => {
    setForm(blankForm());
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
      const existing = [...defaultRows, ...userRows].find((rate) => rate.rate_id === form.rateId);
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

  const statusBadge = (status: RateStatus) => {
    if (status === 'current') {
      return <Badge variant="success">{t('costRates.status.current', { defaultValue: 'Current' })}</Badge>;
    }
    if (status === 'scheduled') {
      return <Badge variant="secondary">{t('costRates.status.scheduled', { defaultValue: 'Scheduled' })}</Badge>;
    }
    return <Badge variant="default-muted">{t('costRates.status.ended', { defaultValue: 'Ended' })}</Badge>;
  };

  const baseColumns: ColumnDefinition<CostRateRow>[] = [
    {
      title: t('costRates.fields.rate.label', { defaultValue: 'Hourly Cost' }),
      dataIndex: 'cost_rate',
      render: (value: number) => formatRate(value),
    },
    {
      title: t('costRates.table.status', { defaultValue: 'Status' }),
      dataIndex: 'status',
      render: (value: RateStatus) => statusBadge(value),
    },
    {
      title: t('costRates.fields.effectiveFrom.label', { defaultValue: 'Effective From' }),
      dataIndex: 'effective_from',
    },
    {
      title: t('costRates.fields.effectiveTo.label', { defaultValue: 'Effective To' }),
      dataIndex: 'effective_to',
      render: (value: string | null) => value ?? '—',
    },
    {
      title: t('costRates.table.actions', { defaultValue: 'Actions' }),
      dataIndex: 'rate_id',
      sortable: false,
      render: (_value: string, row: CostRateRow) => (
        <div className="flex justify-end gap-1">
          <Button id={`edit-cost-rate-${row.rate_id}`} size="sm" variant="ghost" onClick={() => openEditDialog(row)}>
            <Pencil className="h-4 w-4" />
            <span className="sr-only">{t('costRates.actions.edit', { defaultValue: 'Edit' })}</span>
          </Button>
          <Button id={`delete-cost-rate-${row.rate_id}`} size="sm" variant="ghost" onClick={() => requestDelete(row)}>
            <Trash2 className="h-4 w-4" />
            <span className="sr-only">{t('costRates.actions.delete', { defaultValue: 'Delete' })}</span>
          </Button>
        </div>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Spinner size="sm" />
        {t('costRates.loading', { defaultValue: 'Loading cost rates...' })}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-muted-foreground">
          {defaultRate
            ? t('costRates.default.current', {
              defaultValue: 'Current default: {{rate}} from {{date}}',
              rate: formatRate(defaultRate.cost_rate),
              date: defaultRate.effective_from,
            })
            : t('costRates.default.missing', {
              defaultValue: 'No tenant default is configured. Users without overrides will be uncosted.',
            })}
        </p>
        <Button id="add-cost-rate" size="sm" onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          {t('costRates.actions.addRate', { defaultValue: 'Add Rate' })}
        </Button>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">
          {t('costRates.default.title', { defaultValue: 'Tenant default cost rate' })}
        </h3>
        {defaultRows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border-300 p-4 text-sm text-muted-foreground">
            {t('costRates.default.empty', { defaultValue: 'No default rates yet.' })}
          </p>
        ) : (
          <DataTable
            id="cost-rates-default-table"
            data={defaultRows}
            columns={baseColumns}
            pagination
            currentPage={defaultPage}
            onPageChange={setDefaultPage}
            pageSize={defaultPageSize}
            onItemsPerPageChange={(size: number) => {
              setDefaultPageSize(size);
              setDefaultPage(1);
            }}
          />
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">
          {t('costRates.sections.userRates', { defaultValue: 'User rates' })}
        </h3>
        {userRows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border-300 p-4 text-sm text-muted-foreground">
            {t('costRates.history.empty', { defaultValue: 'No user-specific rates.' })}
          </p>
        ) : (
          <DataTable
            id="cost-rates-users-table"
            data={userRows}
            columns={[
              { title: t('costRates.table.user', { defaultValue: 'User' }), dataIndex: 'scope_label' },
              ...baseColumns,
            ]}
            pagination
            currentPage={usersPage}
            onPageChange={setUsersPage}
            pageSize={usersPageSize}
            onItemsPerPageChange={(size: number) => {
              setUsersPageSize(size);
              setUsersPage(1);
            }}
          />
        )}
      </div>

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
            <CustomSelect
              id="cost-rate-user"
              options={[
                { value: DEFAULT_USER_ID, label: t('costRates.fields.user.default', { defaultValue: 'Tenant default' }) },
                ...(data?.users.map((user) => ({ value: user.user_id, label: userLabel(user) })) ?? []),
              ]}
              value={form.userId}
              disabled={Boolean(form.rateId)}
              onValueChange={(value) => updateForm('userId', value)}
            />
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
              <DatePicker
                id="cost-rate-effective-from"
                label={t('costRates.fields.effectiveFrom.label', { defaultValue: 'Effective From' })}
                value={dateFromString(form.effectiveFrom)}
                onChange={(date) => updateForm('effectiveFrom', dateToString(date))}
                className="w-full"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cost-rate-effective-to">{t('costRates.fields.effectiveTo.label', { defaultValue: 'Effective To' })}</Label>
              <DatePicker
                id="cost-rate-effective-to"
                label={t('costRates.fields.effectiveTo.label', { defaultValue: 'Effective To' })}
                clearable
                value={dateFromString(form.effectiveTo)}
                onChange={(date) => updateForm('effectiveTo', dateToString(date))}
                className="w-full"
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
