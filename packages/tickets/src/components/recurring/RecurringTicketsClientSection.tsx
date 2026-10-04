'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { MoreVertical } from 'lucide-react';
import { describeRule } from '@alga-psa/shared/lib/recurrence';
import type { ColumnDefinition } from '@alga-psa/types';
import { toast } from 'react-hot-toast';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@alga-psa/ui/components/DropdownMenu';
import { Switch } from '@alga-psa/ui/components/Switch';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  addClientsToRecurringTicketDefinition,
  listRecurringTicketDefinitions,
  listRecurringTicketsForClient,
  removeClientFromRecurringTicketDefinition,
  setRecurringTicketClientActive,
} from '../../actions/recurringTicketActions';
import type { RecurringDefinitionListItem, RecurringTicketForClient } from '../../lib/recurring/types';
import { RecurringClientOverridesDialog } from './RecurringClientOverridesDialog';
import { formatInstant, overriddenGroups, recurringErrorMessage, toDescribeTranslate, unwrapRecurring } from './recurringUi';
import { useRecurringTicketPermissions } from './useRecurringTicketPermissions';

const STATUS_BADGE = { active: 'success', paused: 'warning', archived: 'default-muted' } as const;

export interface RecurringTicketsClientSectionProps {
  clientId: string;
}

/** The "Recurring tickets" tab of a client: the definitions that include it, with per-client overrides. */
export function RecurringTicketsClientSection({ clientId }: RecurringTicketsClientSectionProps) {
  const { t, i18n } = useTranslation('features/tickets');
  const permissions = useRecurringTicketPermissions();
  const [rows, setRows] = useState<RecurringTicketForClient[]>([]);
  const [available, setAvailable] = useState<RecurringDefinitionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickedDefinition, setPickedDefinition] = useState('');
  const [editing, setEditing] = useState<RecurringTicketForClient | null>(null);
  const [removing, setRemoving] = useState<RecurringTicketForClient | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [forClient, definitions] = await Promise.all([
        listRecurringTicketsForClient(clientId).then(unwrapRecurring),
        // Only a user who may read definitions can pick one; the same permission gates both reads.
        listRecurringTicketDefinitions('all').then(unwrapRecurring),
      ]);
      setRows(forClient);
      setAvailable(definitions.filter((definition) => definition.status !== 'archived'));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  const joinable = available.filter((definition) => !rows.some((row) => row.definition_id === definition.definition_id));

  const addToDefinition = async () => {
    if (!pickedDefinition) return;
    const message = recurringErrorMessage(await addClientsToRecurringTicketDefinition(pickedDefinition, [clientId]));
    if (message !== null) toast.error(message);
    setPickedDefinition('');
    await load();
  };

  const toggleActive = async (row: RecurringTicketForClient, active: boolean) => {
    try {
      const message = recurringErrorMessage(await setRecurringTicketClientActive(row.definition_client_id, active));
      if (message !== null) toast.error(message);
    } catch (toggleError) {
      toast.error(toggleError instanceof Error ? toggleError.message : String(toggleError));
    }
    await load();
  };

  const confirmRemove = async () => {
    if (!removing) return;
    const message = recurringErrorMessage(await removeClientFromRecurringTicketDefinition(removing.definition_client_id));
    setRemoving(null);
    if (message !== null) toast.error(message);
    await load();
  };

  const columns = useMemo<ColumnDefinition<RecurringTicketForClient>[]>(() => {
    const describeT = toDescribeTranslate((key, options) => t(key, options));
    return [
      {
        title: t('recurring.list.columns.name', 'Name'),
        dataIndex: 'name',
        render: (value, row) => (
          <Link
            id={`recurring-client-tab-open-${row.definition_id}`}
            href={`/msp/tickets/recurring/${row.definition_id}`}
            className="text-[rgb(var(--color-primary-600))] hover:underline"
          >
            {value}
          </Link>
        ),
      },
      {
        title: t('recurring.list.columns.schedule', 'Schedule'),
        dataIndex: 'recurrence',
        sortable: false,
        render: (_value, row) => describeRule(row.recurrence, describeT),
      },
      {
        title: t('recurring.clients.columns.overrides', 'Overrides'),
        dataIndex: 'overrides',
        sortable: false,
        render: (_value, row) => {
          const groups = overriddenGroups(row.overrides);
          return groups.length === 0
            ? t('recurring.clients.inheritsAll', 'Inherits everything')
            : groups.map((group) => t(`recurring.overrides.groupNames.${group}`, group)).join(', ');
        },
      },
      {
        title: t('recurring.list.columns.nextDue', 'Next due'),
        dataIndex: 'next_due_at',
        render: (value, row) => (row.is_client_active ? formatInstant(value, i18n.language, row.time_zone) || '—' : '—'),
      },
      {
        title: t('recurring.list.columns.status', 'Status'),
        dataIndex: 'status',
        render: (_value, row) => (
          row.is_client_active
            ? <Badge variant={STATUS_BADGE[row.status]}>{t(`recurring.status.${row.status}`, row.status)}</Badge>
            : <Badge variant="default-muted">{t('recurring.clientTab.clientPaused', 'Paused for this client')}</Badge>
        ),
      },
      {
        title: t('recurring.clients.columns.active', 'Active'),
        dataIndex: 'is_client_active',
        sortable: false,
        render: (_value, row) => (
          <Switch
            id={`recurring-client-tab-active-${row.definition_client_id}`}
            checked={row.is_client_active}
            disabled={row.status === 'archived' || !permissions.update}
            onCheckedChange={(checked) => void toggleActive(row, checked)}
          />
        ),
      },
      {
        title: '',
        dataIndex: 'definition_client_id',
        sortable: false,
        width: '56px',
        render: (_value, row) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                id={`recurring-client-tab-menu-${row.definition_client_id}`}
                type="button"
                variant="ghost"
                size="xs"
                disabled={row.status === 'archived' || !permissions.update}
                aria-label={t('recurring.clients.actions', 'Client actions')}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem id={`recurring-client-tab-edit-${row.definition_client_id}`} onSelect={() => setEditing(row)}>
                {t('recurring.clients.editOverrides', 'Edit overrides')}
              </DropdownMenuItem>
              <DropdownMenuItem id={`recurring-client-tab-remove-${row.definition_client_id}`} onSelect={() => setRemoving(row)}>
                {t('recurring.clients.remove', 'Remove')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, i18n.language, permissions.update]);

  if (loading) {
    return <p id="recurring-client-tab-loading" className="p-4 text-sm text-[rgb(var(--color-text-500))]">{t('recurring.loading', 'Loading…')}</p>;
  }

  return (
    <div id="recurring-client-tab" className="space-y-4 p-4">
      {error && <Alert id="recurring-client-tab-error" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      {!error && permissions.update && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-72">
            <CustomSelect
              id="recurring-client-tab-add-definition"
              value={pickedDefinition}
              onValueChange={setPickedDefinition}
              placeholder={t('recurring.clientTab.pickDefinition', 'Choose a recurring ticket')}
              options={joinable.map((definition) => ({ value: definition.definition_id, label: definition.name }))}
            />
          </div>
          <Button id="recurring-client-tab-add" type="button" disabled={!pickedDefinition} onClick={() => void addToDefinition()}>
            {t('recurring.clientTab.add', 'Add to recurring ticket')}
          </Button>
          {permissions.create && (
            <Link
              id="recurring-client-tab-new"
              href="/msp/tickets/recurring/new"
              className="text-sm text-[rgb(var(--color-primary-600))] hover:underline"
            >
              {t('recurring.list.new', 'New recurring ticket')}
            </Link>
          )}
        </div>
      )}

      {!error && rows.length === 0 ? (
        <p id="recurring-client-tab-empty" className="text-sm text-[rgb(var(--color-text-500))]">
          {t('recurring.clientTab.empty', 'This client is not part of any recurring ticket.')}
        </p>
      ) : !error && (
        <DataTable id="recurring-client-tab-table" data={rows} columns={columns} pagination={false} />
      )}

      {editing && (
        <RecurringClientOverridesDialog
          isOpen
          onClose={() => setEditing(null)}
          definitionId={editing.definition_id}
          definitionClientId={editing.definition_client_id}
          onSaved={() => void load()}
        />
      )}
      <ConfirmationDialog
        id="recurring-client-tab-remove-dialog"
        isOpen={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => void confirmRemove()}
        title={t('recurring.clientTab.removeTitle', 'Remove from recurring ticket')}
        message={t('recurring.clientTab.removeMessage', 'Stop creating tickets for this client from {{name}}? Tickets already created and the history are kept.', {
          name: removing?.name ?? '',
        })}
        confirmLabel={t('recurring.clients.remove', 'Remove')}
        cancelLabel={t('recurring.actions.cancel', 'Cancel')}
      />
    </div>
  );
}

export default RecurringTicketsClientSection;
