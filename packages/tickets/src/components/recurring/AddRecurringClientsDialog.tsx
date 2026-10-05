'use client';

import React, { useEffect, useState } from 'react';
import type { IClient } from '@alga-psa/types';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getAllClients } from '../../actions/clientLookupActions';
import { addClientsToRecurringTicketDefinition } from '../../actions/recurringTicketActions';
import { recurringErrorMessage } from './recurringUi';

export interface AddRecurringClientsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  definitionId: string;
  /** Clients already on the definition; they cannot be picked again. */
  existingClientIds: string[];
  /** Called after each client is added, so the parent can refresh its list. */
  onAdded: () => void;
}

/**
 * Adds clients to a recurring ticket one at a time and stays open for the next.
 *
 * LEVERAGE: pattern multi-client-picker — there is no multi-select client picker, so this wraps the
 * single-select ClientPicker in an add-and-stay-open loop. A shared multi-client picker would replace it.
 */
export function AddRecurringClientsDialog({
  isOpen, onClose, definitionId, existingClientIds, onAdded,
}: AddRecurringClientsDialogProps) {
  const { t } = useTranslation('features/tickets');
  const [clients, setClients] = useState<IClient[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [filterState, setFilterState] = useState<'active' | 'inactive' | 'all'>('active');
  const [typeFilter, setTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [addedNames, setAddedNames] = useState<string[]>([]);
  const [addedIds, setAddedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setAddedNames([]);
    setAddedIds([]);
    setAddError(null);
    let cancelled = false;
    void (async () => {
      try {
        const all = await getAllClients(true);
        if (!cancelled) setClients(all);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  const add = async (clientId: string | null) => {
    if (!clientId) return;
    setBusy(true);
    setAddError(null);
    try {
      const result = await addClientsToRecurringTicketDefinition(definitionId, [clientId]);
      const message = recurringErrorMessage(result);
      if (message !== null) {
        setAddError(message);
        return;
      }
      const client = clients.find((candidate) => candidate.client_id === clientId);
      setAddedIds((current) => [...current, clientId]);
      setAddedNames((current) => [...current, client?.client_name ?? clientId]);
      onAdded();
    } catch (error) {
      setAddError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <div className="flex justify-end">
      <Button id="recurring-add-clients-done" type="button" onClick={onClose}>
        {t('recurring.actions.done', 'Done')}
      </Button>
    </div>
  );

  return (
    <Dialog
      id="recurring-add-clients-dialog"
      isOpen={isOpen}
      onClose={onClose}
      className="max-w-md"
      allowOverflow
      title={t('recurring.clients.addTitle', 'Add clients')}
      footer={footer}
    >
      <DialogContent>
        <div className="space-y-4">
          <p className="text-sm text-[rgb(var(--color-text-600))]">
            {t('recurring.clients.addHelp', 'Pick a client to add it. The dialog stays open so you can add more.')}
          </p>
          {loadError && <Alert variant="destructive"><AlertDescription>{loadError}</AlertDescription></Alert>}
          {addError && <Alert variant="destructive"><AlertDescription>{addError}</AlertDescription></Alert>}
          <ClientPicker
            id="recurring-add-clients-picker"
            clients={clients}
            selectedClientId={null}
            onSelect={(clientId) => void add(clientId)}
            filterState={filterState}
            onFilterStateChange={setFilterState}
            clientTypeFilter={typeFilter}
            onClientTypeFilterChange={setTypeFilter}
            disabledClientIds={new Set([...existingClientIds, ...addedIds])}
            disabledTooltip={t('recurring.clients.alreadyAdded', 'Already added')}
            placeholder={t('recurring.clients.pickerPlaceholder', 'Select a client to add')}
            disabled={busy}
          />
          {addedNames.length > 0 && (
            <div id="recurring-add-clients-added" role="status" className="text-sm">
              <p className="font-medium">{t('recurring.clients.addedHeading', 'Added in this dialog')}</p>
              <ul className="list-disc pl-5 text-[rgb(var(--color-text-600))]">
                {addedNames.map((name, index) => <li key={`${name}-${index}`}>{name}</li>)}
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default AddRecurringClientsDialog;
