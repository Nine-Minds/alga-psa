'use client';

import React, { useMemo, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@alga-psa/ui/components/DropdownMenu';
import { Switch } from '@alga-psa/ui/components/Switch';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ColumnDefinition } from '@alga-psa/types';
import { toast } from 'react-hot-toast';
import {
  removeClientFromRecurringTicketDefinition,
  setRecurringTicketClientActive,
} from '../../actions/recurringTicketActions';
import type { RecurringDefinitionClientRecord } from '../../lib/recurring/types';
import { AddRecurringClientsDialog } from './AddRecurringClientsDialog';
import { RecurringClientOverridesDialog } from './RecurringClientOverridesDialog';
import { useRecurringTicketsCrossFeature } from './RecurringTicketsFeatureContext';
import { formatInstant, overriddenGroups, recurringErrorMessage } from './recurringUi';

export interface RecurringClientsSectionProps {
  definitionId: string;
  clients: RecurringDefinitionClientRecord[];
  nextDueAt: string | null;
  timeZone: string;
  /** Archived definitions are read-only. */
  readOnly: boolean;
  onChanged: () => void;
}

/** The clients of a recurring ticket: per-client overrides, active toggle, add and remove. */
export function RecurringClientsSection({
  definitionId, clients, nextDueAt, timeZone, readOnly, onChanged,
}: RecurringClientsSectionProps) {
  const { t, i18n } = useTranslation('features/tickets');
  // Without an asset picker (AlgaDesk has no assets) the Assets column would be a meaningless 0.
  const showAssets = useRecurringTicketsCrossFeature().renderAssetPicker !== undefined;
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<RecurringDefinitionClientRecord | null>(null);

  const groupLabel = (group: string) => t(`recurring.overrides.groupNames.${group}`, group);

  const toggleActive = async (client: RecurringDefinitionClientRecord, active: boolean) => {
    const message = recurringErrorMessage(await setRecurringTicketClientActive(client.definition_client_id, active));
    if (message !== null) toast.error(message);
    onChanged();
  };

  const confirmRemove = async () => {
    if (!removing) return;
    const message = recurringErrorMessage(await removeClientFromRecurringTicketDefinition(removing.definition_client_id));
    setRemoving(null);
    if (message !== null) toast.error(message);
    onChanged();
  };

  const columns = useMemo<ColumnDefinition<RecurringDefinitionClientRecord>[]>(() => [
    { title: t('recurring.clients.columns.client', 'Client'), dataIndex: 'client_name' },
    {
      title: t('recurring.clients.columns.overrides', 'Overrides'),
      dataIndex: 'overrides',
      sortable: false,
      render: (_value, client) => {
        const groups = overriddenGroups(client.overrides);
        return groups.length === 0
          ? <span className="text-[rgb(var(--color-text-500))]">{t('recurring.clients.inheritsAll', 'Inherits everything')}</span>
          : groups.map(groupLabel).join(', ');
      },
    },
    {
      title: t('recurring.clients.columns.contact', 'Contact'),
      dataIndex: 'contact_id',
      sortable: false,
      render: (value) => (value ? t('recurring.clients.set', 'Set') : '—'),
    },
    {
      title: t('recurring.clients.columns.location', 'Location'),
      dataIndex: 'location_id',
      sortable: false,
      render: (value) => (value ? t('recurring.clients.set', 'Set') : '—'),
    },
    ...(showAssets ? [{
      title: t('recurring.clients.columns.assets', 'Assets'),
      dataIndex: 'asset_ids',
      sortable: false,
      render: (value: string[]) => value.length,
    } satisfies ColumnDefinition<RecurringDefinitionClientRecord>] : []),
    {
      title: t('recurring.clients.columns.nextDue', 'Next due'),
      dataIndex: 'definition_client_id',
      sortable: false,
      render: (_value, client) => (client.is_active ? formatInstant(nextDueAt, i18n.language, timeZone) || '—' : '—'),
    },
    {
      title: t('recurring.clients.columns.active', 'Active'),
      dataIndex: 'is_active',
      sortable: false,
      render: (_value, client) => (
        <Switch
          id={`recurring-client-active-${client.definition_client_id}`}
          checked={client.is_active}
          disabled={readOnly}
          onCheckedChange={(checked) => void toggleActive(client, checked)}
        />
      ),
    },
    {
      // The id DataTable derives from dataIndex must be unique per column, or this column's
      // cell is replaced by the earlier one's and the menu never mounts.
      title: '',
      dataIndex: 'actions',
      sortable: false,
      width: '56px',
      render: (_value, client) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={`recurring-client-menu-${client.definition_client_id}`}
              type="button"
              variant="ghost"
              size="xs"
              disabled={readOnly}
              aria-label={t('recurring.clients.actions', 'Client actions')}
              onClick={(event) => event.stopPropagation()}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem id={`recurring-client-edit-${client.definition_client_id}`} onSelect={() => setEditingId(client.definition_client_id)}>
              {t('recurring.clients.editOverrides', 'Edit overrides')}
            </DropdownMenuItem>
            <DropdownMenuItem id={`recurring-client-remove-${client.definition_client_id}`} onSelect={() => setRemoving(client)}>
              {t('recurring.clients.remove', 'Remove')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, i18n.language, nextDueAt, timeZone, readOnly, showAssets]);

  return (
    <section id="recurring-clients-section" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('recurring.sections.clients', 'Clients')}</h2>
        {!readOnly && (
          <Button id="recurring-add-clients" type="button" onClick={() => setAdding(true)}>
            {t('recurring.clients.add', 'Add clients')}
          </Button>
        )}
      </div>
      {clients.length === 0 ? (
        <p className="text-sm text-[rgb(var(--color-text-500))]">
          {t('recurring.clients.empty', 'No clients yet. Tickets are only created for the clients you add here.')}
        </p>
      ) : (
        <DataTable id="recurring-clients-table" data={clients} columns={columns} pagination={false} />
      )}

      <AddRecurringClientsDialog
        isOpen={adding}
        onClose={() => setAdding(false)}
        definitionId={definitionId}
        existingClientIds={clients.map((client) => client.client_id)}
        onAdded={onChanged}
      />
      {editingId && (
        <RecurringClientOverridesDialog
          isOpen
          onClose={() => setEditingId(null)}
          definitionId={definitionId}
          definitionClientId={editingId}
          onSaved={onChanged}
        />
      )}
      <ConfirmationDialog
        id="recurring-client-remove-dialog"
        isOpen={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => void confirmRemove()}
        title={t('recurring.clients.removeTitle', 'Remove client')}
        message={t('recurring.clients.removeMessage', 'Stop creating tickets for {{client}}? Tickets already created and the history are kept.', {
          client: removing?.client_name ?? '',
        })}
        confirmLabel={t('recurring.clients.remove', 'Remove')}
        cancelLabel={t('recurring.actions.cancel', 'Cancel')}
      />
    </section>
  );
}

export default RecurringClientsSection;
