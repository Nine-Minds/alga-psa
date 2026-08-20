'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ClientLifecycleStatus, IClient, OpportunityType } from '@alga-psa/types';
import { SUGGESTED_NEXT_ACTIONS } from '../../lib/suggestedNextActions';
import { getClientDefaultCurrency } from '../../actions/opportunityDefaults';
import { ActionSuggestions } from '../ActionSuggestions';
import { OpportunityValueFields, amountsToCents, type OpportunityValueAmounts } from './OpportunityValueFields';

const TYPES: OpportunityType[] = ['new_logo', 'expansion', 'renewal', 'project'];

const TYPE_DEFAULTS: Record<OpportunityType, string> = {
  new_logo: 'New client',
  expansion: 'Expansion',
  renewal: 'Renewal',
  project: 'Project',
};

/** A first action three working days out: soon enough to matter, not tomorrow morning. */
function defaultDueDate(from = new Date()): Date {
  const due = new Date(from);
  let remaining = 3;
  while (remaining > 0) {
    due.setDate(due.getDate() + 1);
    const day = due.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return due;
}

/** A known client is expansion work; only a prospect is genuinely a new logo. */
export function defaultTypeForLifecycle(status?: ClientLifecycleStatus | null): OpportunityType {
  return status && status !== 'prospect' ? 'expansion' : 'new_logo';
}

export interface CreateOpportunityInput {
  client_id: string;
  title: string;
  opportunity_type: OpportunityType;
  next_action: string;
  next_action_due: string;
  expected_close_date?: string;
  /** Chosen in the dialog: the client default is only the starting point. */
  currency_code: string;
  mrr_cents?: number;
  nrr_cents?: number;
  hardware_cents?: number;
}

/**
 * Two required fields — client and title — so a deal mentioned at a QBR can be
 * logged from a parking lot. The first action and its due date are pre-filled
 * (the discipline invariant still holds) and the dollar estimate lives here
 * rather than on a second screen.
 */
export function CreateOpportunityDialog({
  isOpen,
  onClose,
  clients = [],
  defaultClientId,
  lockedClient,
  defaults,
  renderClientCreator,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  clients?: IClient[];
  defaultClientId?: string | null;
  /** When creating from a client's own screen the client is fixed — no picker. */
  lockedClient?: { client_id: string; client_name: string; lifecycle_status?: ClientLifecycleStatus | null };
  /** Prefill for launches from a context that already knows the deal shape (e.g. a whitespace cell). */
  defaults?: { title?: string; type?: OpportunityType };
  /** Host-provided client creation keeps this package independent of the clients UI package. */
  renderClientCreator?: (props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated: (client: IClient) => void;
  }) => React.ReactNode;
  onSubmit: (input: CreateOpportunityInput) => Promise<void> | void;
}) {
  const { t } = useTranslation('msp/opportunities');
  const [clientId, setClientId] = useState<string | null>(lockedClient?.client_id ?? defaultClientId ?? null);
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [typeFilter, setTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [title, setTitle] = useState(defaults?.title ?? '');
  const [type, setType] = useState<OpportunityType>(defaults?.type ?? 'new_logo');
  const [typeTouched, setTypeTouched] = useState(defaults?.type != null);
  /** null means "still the suggested default" so translations can settle in. */
  const [nextAction, setNextAction] = useState<string | null>(null);
  const [due, setDue] = useState<Date | undefined>(() => defaultDueDate());
  const [expectedClose, setExpectedClose] = useState<Date | undefined>(undefined);
  const [valuesOpen, setValuesOpen] = useState(false);
  const [amounts, setAmounts] = useState<OpportunityValueAmounts>({});
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [currencyTouched, setCurrencyTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clientCreatorOpen, setClientCreatorOpen] = useState(false);

  const suggested = SUGGESTED_NEXT_ACTIONS.identified[0];
  const defaultNextAction = t(suggested.key, suggested.fallback);
  const effectiveNextAction = nextAction ?? defaultNextAction;

  const selectedLifecycle = useMemo<ClientLifecycleStatus | null | undefined>(() => {
    if (lockedClient) return lockedClient.lifecycle_status;
    return clients.find((client) => client.client_id === clientId)?.lifecycle_status;
  }, [clientId, clients, lockedClient]);

  // The system already knows whether they are a client; don't make the user say it again.
  useEffect(() => {
    if (typeTouched || !clientId) return;
    setType(defaultTypeForLifecycle(selectedLifecycle));
  }, [clientId, selectedLifecycle, typeTouched]);

  // The client default seeds the picker; once the user picks, it is theirs.
  useEffect(() => {
    if (!clientId || currencyTouched) return;
    let active = true;
    getClientDefaultCurrency(clientId)
      .then((code) => {
        if (active && !currencyTouched) setCurrencyCode(code);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [clientId, currencyTouched]);

  const missing: string[] = [];
  if (!clientId) missing.push(t('opportunities.createDialog.client', 'Client'));
  if (title.trim().length === 0) missing.push(t('opportunities.createDialog.dealTitle', 'Title'));
  if (effectiveNextAction.trim().length === 0) missing.push(t('opportunities.createDialog.nextAction', 'First action'));
  if (!due) missing.push(t('opportunities.createDialog.due', 'Due'));
  const valid = missing.length === 0;

  const submit = async () => {
    if (!valid || !clientId || !due) return;
    setSaving(true);
    try {
      await onSubmit({
        client_id: clientId,
        title: title.trim(),
        opportunity_type: type,
        next_action: effectiveNextAction.trim(),
        next_action_due: due.toISOString(),
        expected_close_date: expectedClose ? expectedClose.toISOString().slice(0, 10) : undefined,
        currency_code: currencyCode,
        ...amountsToCents(amounts, currencyCode),
      });
      setTitle('');
      setNextAction(null);
      setDue(defaultDueDate());
      setExpectedClose(undefined);
      setValuesOpen(false);
      setAmounts({});
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <div className="flex w-full items-center justify-between gap-3">
      <p
        id="opportunity-create-missing"
        className={`text-xs ${valid ? 'text-[rgb(var(--color-text-400))]' : 'text-[rgb(var(--color-text-600))]'}`}
        role={valid ? undefined : 'status'}
      >
        {valid
          ? t('opportunities.createDialog.readyHint', 'Ready to create.')
          : t('opportunities.createDialog.missing', 'Fill {{fields}} to enable Create opportunity', {
              fields: missing.join(', '),
            })}
      </p>
      <div className="flex gap-2">
        <Button id="opportunity-create-cancel" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button id="opportunity-create-submit" size="sm" onClick={submit} disabled={!valid || saving}>
          {t('opportunities.createDialog.submit', 'Create opportunity')}
        </Button>
      </div>
    </div>
  );

  return (
    <Dialog
      id="opportunity-create-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={t('opportunities.createDialog.title', 'New opportunity')}
      footer={footer}
    >
      <div className="space-y-4 pt-1">
        <p className="text-xs text-[rgb(var(--color-text-400))]">
          {t('opportunities.createDialog.requiredLegend', 'Fields marked * are required.')}
        </p>
        {lockedClient ? (
          <div className="text-sm text-[rgb(var(--color-text-700))]">
            <span className="text-xs font-medium uppercase tracking-wide text-[rgb(var(--color-text-400))]">
              {t('opportunities.createDialog.client', 'Client')}
            </span>
            <div className="font-medium">{lockedClient.client_name}</div>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="opportunity-create-client" required>
              {t('opportunities.createDialog.client', 'Client')}
            </Label>
            <ClientPicker
              id="opportunity-create-client"
              clients={clients}
              selectedClientId={clientId}
              onSelect={setClientId}
              filterState={filterState}
              onFilterStateChange={setFilterState}
              clientTypeFilter={typeFilter}
              onClientTypeFilterChange={setTypeFilter}
              onAddNew={renderClientCreator ? () => setClientCreatorOpen(true) : undefined}
            />
            {renderClientCreator?.({
              open: clientCreatorOpen,
              onOpenChange: setClientCreatorOpen,
              onCreated: (client) => {
                setClientId(client.client_id);
                setClientCreatorOpen(false);
              },
            })}
          </div>
        )}
        <Input
          id="opportunity-create-title"
          label={t('opportunities.createDialog.dealTitle', 'Title')}
          placeholder={t('opportunities.createDialog.titlePlaceholder', 'e.g. Managed services agreement')}
          value={title}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
          required
        />
        <ActionSuggestions
          id="opportunity-create-suggestion"
          stage="identified"
          onSelect={setNextAction}
        />
        <CustomSelect
          id="opportunity-create-type"
          label={t('opportunities.createDialog.dealType', 'Deal type')}
          options={TYPES.map((v) => ({ value: v, label: t(`opportunities.type.${v}`, TYPE_DEFAULTS[v]) }))}
          value={type}
          onValueChange={(v: string) => {
            setTypeTouched(true);
            setType(v as OpportunityType);
          }}
        />
        <Input
          id="opportunity-create-next-action"
          label={t('opportunities.createDialog.nextAction', 'First action')}
          placeholder={t('opportunities.createDialog.nextActionPlaceholder', 'e.g. Send the assessment proposal')}
          value={effectiveNextAction}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNextAction(e.target.value)}
          required
        />
        <div className="grid grid-cols-2 gap-3">
          {/* DatePicker's own label is aria-only; the field still needs a visible one. */}
          <div className="space-y-1">
            <Label htmlFor="opportunity-create-next-due" required>
              {t('opportunities.createDialog.due', 'Due')}
            </Label>
            <DatePicker
              id="opportunity-create-next-due"
              label={t('opportunities.createDialog.due', 'Due')}
              value={due}
              onChange={(d?: Date) => setDue(d)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="opportunity-create-expected-close">
              {t('opportunities.createDialog.expectedClose', 'Expected close')}
            </Label>
            <DatePicker
              id="opportunity-create-expected-close"
              label={t('opportunities.createDialog.expectedClose', 'Expected close')}
              value={expectedClose}
              onChange={(d?: Date) => setExpectedClose(d)}
              clearable
            />
          </div>
        </div>
        <div className="rounded-md border border-[rgb(var(--color-border-200))] p-3">
          <Button
            id="opportunity-create-values-toggle"
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setValuesOpen((open) => !open)}
          >
            {valuesOpen ? (
              <ChevronDown className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronRight className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            )}
            {t('opportunities.createDialog.addValue', 'Add estimated value (optional)')}
            <span className="ml-1.5 text-[rgb(var(--color-text-400))]">{currencyCode}</span>
          </Button>
          {valuesOpen ? (
            <div className="mt-3">
              <OpportunityValueFields
                idPrefix="opportunity-create"
                currencyCode={currencyCode}
                onCurrencyChange={(code) => {
                  setCurrencyTouched(true);
                  setCurrencyCode(code);
                }}
                amounts={amounts}
                onAmountsChange={setAmounts}
                columns={3}
              />
            </div>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
