'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MoreVertical, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import type { ColumnDefinition, TicketTemplateListItem } from '@alga-psa/types';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import DataTableSkeleton from '@alga-psa/ui/components/skeletons/DataTableSkeleton';
import { SwitchWithLabel } from '@alga-psa/ui/components/SwitchWithLabel';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { checkCurrentUserPermissions } from '@alga-psa/auth/actions';
import {
  deleteTicketTemplate,
  listTicketTemplates,
  setTicketTemplateActive,
} from '../../actions/ticketTemplateActions';
import { buildCreateTicketHref } from '../../lib/createTicketRoute';
import { recurringErrorMessage, unwrapRecurring } from '../recurring/recurringUi';
import { useTicketTemplatePermissions } from './useTicketTemplatePermissions';

/** Column widths of the loading skeleton, shaped like the table it stands in for. */
const SKELETON_CELLS = ['w-40', 'w-48', 'w-24', 'w-20', 'w-16'];

/** The ticket templates list: name, board, checklist size, active state and the row actions. */
export function TicketTemplatesPage({ isAlgaDeskMode = false }: { isAlgaDeskMode?: boolean } = {}) {
  const { t } = useTranslation('features/tickets');
  const router = useRouter();
  const permissions = useTicketTemplatePermissions();
  // "New ticket from template" creates a ticket, so it follows `ticket:create`, not the template grants.
  const [canCreateTicket, setCanCreateTicket] = useState(false);
  const [items, setItems] = useState<TicketTemplateListItem[]>([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TicketTemplateListItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(unwrapRecurring(await listTicketTemplates({ includeInactive })));
    } catch (loadError) {
      // Includes the permission message: a user without `ticket_template:read` sees it instead of a table.
      setItems([]);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);

  useEffect(() => { void load(); }, [load]);

  const openNew = useCallback(() => router.push('/msp/tickets/templates/new'), [router]);

  useEffect(() => {
    let cancelled = false;
    checkCurrentUserPermissions([{ resource: 'ticket', action: 'create' }])
      .then((results) => {
        if (!cancelled) setCanCreateTicket(results.some((result) => result.resource === 'ticket' && result.action === 'create' && result.granted));
      })
      .catch(() => { if (!cancelled) setCanCreateTicket(false); });
    return () => { cancelled = true; };
  }, []);

  const toggleActive = useCallback(async (item: TicketTemplateListItem) => {
    const message = recurringErrorMessage(await setTicketTemplateActive(item.template_id, !item.is_active));
    if (message !== null) { toast.error(message); return; }
    await load();
  }, [load]);

  const confirmDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    const message = recurringErrorMessage(await deleteTicketTemplate(target.template_id));
    if (message !== null) { toast.error(message); return; }
    toast.success(t('templates.list.deleted', 'Template deleted'));
    await load();
  };

  const columns = useMemo<ColumnDefinition<TicketTemplateListItem>[]>(() => {
    const cols: ColumnDefinition<TicketTemplateListItem>[] = [
      { title: t('templates.list.columns.name', 'Name'), dataIndex: 'name' },
      { title: t('templates.list.columns.title', 'Ticket title'), dataIndex: 'title' },
      {
        title: t('templates.list.columns.board', 'Board'),
        dataIndex: 'board_name',
        render: (value: string | null) => value || '—',
      },
      { title: t('templates.list.columns.checklist', 'Checklist items'), dataIndex: 'checklist_count' },
      {
        title: t('templates.list.columns.status', 'Status'),
        dataIndex: 'is_active',
        render: (value: boolean, record: TicketTemplateListItem) => (
          <div className="flex flex-wrap gap-1">
            <Badge variant={value ? 'success' : 'default-muted'}>
              {value ? t('templates.status.active', 'Active') : t('templates.status.inactive', 'Inactive')}
            </Badge>
            {/* Not offered in the new-ticket picker (R5); only recurring schedules use it. */}
            {!record.offer_for_manual_use && (
              <Badge variant="default-muted">{t('templates.status.scheduledOnly', 'Scheduled only')}</Badge>
            )}
          </div>
        ),
      },
      { title: t('templates.list.columns.schedules', 'Schedules'), dataIndex: 'schedule_count' },
    ];
    if (canCreateTicket || permissions.update || permissions.delete) {
      cols.push({
        title: <span className="sr-only">{t('actions.rowActions', 'Actions')}</span>,
        dataIndex: 'actions',
        width: '4%',
        sortable: false,
        render: (_value: unknown, record: TicketTemplateListItem) => (
          <div
            className="flex items-center justify-center"
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  id={`ticket-template-actions-menu-${record.template_id}`}
                  variant="ghost"
                  className="h-8 w-8 p-0"
                  onClick={(event) => event.stopPropagation()}
                >
                  <span className="sr-only">{t('actions.openMenu', 'Open menu')}</span>
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {/* addTicket refuses templates that are inactive or not offered for manual use, so the action is only offered on the rest. */}
                {canCreateTicket && record.is_active && record.offer_for_manual_use && (
                  <DropdownMenuItem
                    id="new-ticket-from-template-menu-item"
                    onClick={(event) => {
                      event.stopPropagation();
                      router.push(buildCreateTicketHref({ templateId: record.template_id, isAlgaDeskMode }));
                    }}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    {t('templates.actions.newTicket', 'New ticket from template')}
                  </DropdownMenuItem>
                )}
                {permissions.update && (
                  <DropdownMenuItem
                    id="edit-ticket-template-menu-item"
                    onClick={(event) => {
                      event.stopPropagation();
                      router.push(`/msp/tickets/templates/${record.template_id}`);
                    }}
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    {t('templates.actions.edit', 'Edit')}
                  </DropdownMenuItem>
                )}
                {permissions.update && (
                  <DropdownMenuItem
                    id="toggle-active-ticket-template-menu-item"
                    onClick={(event) => {
                      event.stopPropagation();
                      void toggleActive(record);
                    }}
                  >
                    <Power className="h-4 w-4 mr-2" />
                    {record.is_active
                      ? t('templates.actions.deactivate', 'Deactivate')
                      : t('templates.actions.activate', 'Activate')}
                  </DropdownMenuItem>
                )}
                {permissions.delete && (
                  <DropdownMenuItem
                    id="delete-ticket-template-menu-item"
                    className="text-destructive"
                    disabled={record.schedule_count > 0}
                    title={record.schedule_count > 0
                      ? t('templates.list.deleteBlocked', 'Used by {{count}} recurring schedule(s). Point them at another template or archive them first.', { count: record.schedule_count })
                      : undefined}
                    onClick={(event) => {
                      event.stopPropagation();
                      setPendingDelete(record);
                    }}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {t('templates.actions.delete', 'Delete')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      });
    }
    return cols;
  }, [t, canCreateTicket, isAlgaDeskMode, permissions.update, permissions.delete, router, toggleActive]);

  return (
    <div id="ticket-templates-page" className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('templates.list.title', 'Ticket templates')}</h1>
        <div className="flex items-center gap-4">
          <SwitchWithLabel
            id="ticket-templates-show-inactive"
            label={t('templates.list.showInactive', 'Show inactive')}
            checked={includeInactive}
            onCheckedChange={setIncludeInactive}
          />
          {permissions.create && (
            <Button id="ticket-templates-new" type="button" onClick={openNew}>
              {t('templates.list.new', 'New template')}
            </Button>
          )}
        </div>
      </div>

      {error && <Alert id="ticket-templates-error" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      {loading ? (
        <DataTableSkeleton
          id="ticket-templates-loading"
          label={t('templates.loading', 'Loading…')}
          columnWidths={SKELETON_CELLS}
        />
      ) : (
        <>
          <DataTable
            id="ticket-templates-table"
            data={items}
            columns={columns}
            pagination
            onRowClick={permissions.update || permissions.read
              ? (row) => router.push(`/msp/tickets/templates/${row.template_id}`)
              : undefined}
          />
          {!error && items.length === 0 && (
            <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
              <p id="ticket-templates-empty" className="max-w-md text-sm text-[rgb(var(--color-text-500))]">
                {t('templates.list.empty', 'No ticket templates yet. Open a ticket and choose "Create template from ticket", or create one from scratch.')}
              </p>
              {permissions.create && (
                <Button id="ticket-templates-empty-new" type="button" onClick={openNew}>
                  {t('templates.list.new', 'New template')}
                </Button>
              )}
            </div>
          )}
        </>
      )}

      <ConfirmationDialog
        id="ticket-templates-delete-dialog"
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
        title={t('templates.list.deleteTitle', 'Delete template')}
        message={t('templates.list.deleteMessage', 'Delete "{{name}}"? Tickets already created from it are not changed.', {
          name: pendingDelete?.name ?? '',
        })}
        confirmLabel={t('templates.actions.delete', 'Delete')}
        cancelLabel={t('templates.actions.cancel', 'Cancel')}
      />
    </div>
  );
}

export default TicketTemplatesPage;
