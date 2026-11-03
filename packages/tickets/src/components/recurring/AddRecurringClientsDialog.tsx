'use client';

import React, { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { searchClientsForPicker } from '../../actions/clientLookupActions';
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
      // The picker is server-searched, so resolve the display name of the picked client by id.
      // LEVERAGE: pattern fetch-selected-client-by-id — single-client lookup for a picker's selected value
      const lookup = await searchClientsForPicker({ ids: [clientId], status: 'all' }).catch(() => null);
      const client = lookup?.clients.find((candidate) => candidate.client_id === clientId);
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
          {addError && <Alert variant="destructive"><AlertDescription>{addError}</AlertDescription></Alert>}
          <ClientPicker
            id="recurring-add-clients-picker"
            searchClients={searchClientsForPicker}
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
