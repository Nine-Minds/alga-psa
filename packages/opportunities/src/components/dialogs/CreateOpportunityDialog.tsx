'use client';

import React, { useState } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IClient, OpportunityType } from '@alga-psa/types';

const TYPES: OpportunityType[] = ['new_logo', 'expansion', 'renewal', 'project'];

const TYPE_DEFAULTS: Record<OpportunityType, string> = {
  new_logo: 'New client',
  expansion: 'Expansion',
  renewal: 'Renewal',
  project: 'Project',
};

export interface CreateOpportunityInput {
  client_id: string;
  title: string;
  opportunity_type: OpportunityType;
  next_action: string;
  next_action_due: string;
  expected_close_date?: string;
}

/**
 * Deliberately small: client, title, type, and the first next action.
 * Values arrive from quotes; everything else is editable on the deal.
 * The next action is required from birth — no deal exists without one.
 */
export function CreateOpportunityDialog({
  isOpen,
  onClose,
  clients = [],
  defaultClientId,
  lockedClient,
  defaults,
  renderProspectCreator,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  clients?: IClient[];
  defaultClientId?: string | null;
  /** When creating from a client's own screen the client is fixed — no picker. */
  lockedClient?: { client_id: string; client_name: string };
  /** Prefill for launches from a context that already knows the deal shape (e.g. a whitespace cell). */
  defaults?: { title?: string; type?: OpportunityType };
  /** Host-provided client creation keeps this package independent of the clients UI package. */
  renderProspectCreator?: (onCreated: (client: IClient) => void) => React.ReactNode;
  onSubmit: (input: CreateOpportunityInput) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const [clientId, setClientId] = useState<string | null>(lockedClient?.client_id ?? defaultClientId ?? null);
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [typeFilter, setTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [title, setTitle] = useState(defaults?.title ?? '');
  const [type, setType] = useState<OpportunityType>(defaults?.type ?? 'new_logo');
  const [nextAction, setNextAction] = useState('');
  const [due, setDue] = useState<Date | undefined>(undefined);
  const [expectedClose, setExpectedClose] = useState<Date | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const valid = !!clientId && title.trim().length > 0 && nextAction.trim().length > 0 && !!due;

  const submit = async () => {
    if (!valid || !clientId || !due) return;
    setSaving(true);
    try {
      await onSubmit({
        client_id: clientId,
        title: title.trim(),
        opportunity_type: type,
        next_action: nextAction.trim(),
        next_action_due: due.toISOString(),
        expected_close_date: expectedClose ? expectedClose.toISOString().slice(0, 10) : undefined,
      });
      setTitle('');
      setNextAction('');
      setDue(undefined);
      setExpectedClose(undefined);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      id="opportunity-create-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={t('opportunities.createDialog.title', 'New opportunity')}
    >
      <div className="space-y-4 pt-1">
        {lockedClient ? (
          <div className="text-sm text-[rgb(var(--color-text-700))]">
            <span className="text-xs font-medium uppercase tracking-wide text-[rgb(var(--color-text-400))]">
              {t('opportunities.createDialog.client', 'Client')}
            </span>
            <div className="font-medium">{lockedClient.client_name}</div>
          </div>
        ) : (
          <div className="space-y-2">
            <ClientPicker
              id="opportunity-create-client"
              clients={clients}
              selectedClientId={clientId}
              onSelect={setClientId}
              filterState={filterState}
              onFilterStateChange={setFilterState}
              clientTypeFilter={typeFilter}
              onClientTypeFilterChange={setTypeFilter}
            />
            {renderProspectCreator?.((client) => setClientId(client.client_id))}
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
        <CustomSelect
          id="opportunity-create-type"
          options={TYPES.map((v) => ({ value: v, label: t(`opportunities.type.${v}`, TYPE_DEFAULTS[v]) }))}
          value={type}
          onValueChange={(v: string) => setType(v as OpportunityType)}
        />
        <Input
          id="opportunity-create-next-action"
          label={t('opportunities.createDialog.nextAction', 'First action')}
          placeholder={t('opportunities.createDialog.nextActionPlaceholder', 'e.g. Send the assessment proposal')}
          value={nextAction}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNextAction(e.target.value)}
          required
        />
        <div className="grid grid-cols-2 gap-3">
          <DatePicker
            id="opportunity-create-next-due"
            label={t('opportunities.createDialog.due', 'Due')}
            value={due}
            onChange={(d?: Date) => setDue(d)}
            required
          />
          <DatePicker
            id="opportunity-create-expected-close"
            label={t('opportunities.createDialog.expectedClose', 'Expected close')}
            value={expectedClose}
            onChange={(d?: Date) => setExpectedClose(d)}
            clearable
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button id="opportunity-create-cancel" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button id="opportunity-create-submit" size="sm" onClick={submit} disabled={!valid || saving}>
            {t('opportunities.createDialog.submit', 'Create opportunity')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
