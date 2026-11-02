'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MoreVertical, Pencil, Power, Star, Trash2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import type { CannedResponseListItem, CannedResponseScope, ColumnDefinition } from '@alga-psa/types';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import { Input } from '@alga-psa/ui/components/Input';
import DataTableSkeleton from '@alga-psa/ui/components/skeletons/DataTableSkeleton';
import { SwitchWithLabel } from '@alga-psa/ui/components/SwitchWithLabel';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  deleteCannedResponse,
  listCannedResponseCategories,
  listCannedResponses,
  setCannedResponseActive,
  setCannedResponseFavorite,
} from '../../actions/cannedResponseActions';
import { recurringErrorMessage, unwrapRecurring } from '../recurring/recurringUi';
import { useCannedResponsePermissions } from './useCannedResponsePermissions';

const SKELETON_CELLS = ['w-40', 'w-24', 'w-24', 'w-56', 'w-16'];
const ALL = '__all__';
const SEARCH_DEBOUNCE_MS = 250;

/** Admin library of canned ticket responses: search, category filter, active toggle and row actions. */
// LEVERAGE: pattern admin-library-list-page — list + search + active toggle + row-action menu + delete confirm, as in TicketTemplatesPage; a shared library-list layer would remove most of this file
export function CannedResponsesPage() {
  const { t } = useTranslation('features/tickets');
  const router = useRouter();
  const permissions = useCannedResponsePermissions();
  const [items, setItems] = useState<CannedResponseListItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>(ALL);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CannedResponseListItem | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => setQuery(searchText.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchText]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, cats] = await Promise.all([
        listCannedResponses({
          includeInactive,
          query: query || undefined,
          category: category === ALL ? undefined : category,
        }),
        listCannedResponseCategories(),
      ]);
      setItems(unwrapRecurring(list));
      setCategories(unwrapRecurring(cats));
    } catch (loadError) {
      setItems([]);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [includeInactive, query, category]);

  useEffect(() => { void load(); }, [load]);

  const scopeLabel = useCallback((record: CannedResponseListItem) => {
    const labels: Record<CannedResponseScope, string> = {
      personal: t('cannedResponses.scope.personal', 'Personal'),
      team: t('cannedResponses.scope.team', 'Team'),
      board: t('cannedResponses.scope.board', 'Board'),
      client_portal: t('cannedResponses.scope.clientPortal', 'Client portal'),
    };
    const target = record.scope === 'team' ? record.team_name : record.scope === 'board' ? record.board_name : null;
    return target ? `${labels[record.scope]}: ${target}` : labels[record.scope];
  }, [t]);

  const toggleActive = useCallback(async (item: CannedResponseListItem) => {
    const message = recurringErrorMessage(await setCannedResponseActive(item.canned_response_id, !item.is_active));
    if (message !== null) { toast.error(message); return; }
    await load();
  }, [load]);

  const toggleFavorite = useCallback(async (item: CannedResponseListItem) => {
    const message = recurringErrorMessage(await setCannedResponseFavorite(item.canned_response_id, !item.is_favorite));
    if (message !== null) { toast.error(message); return; }
    await load();
  }, [load]);

  const confirmDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    const message = recurringErrorMessage(await deleteCannedResponse(target.canned_response_id));
    if (message !== null) { toast.error(message); return; }
    toast.success(t('cannedResponses.list.deleted', 'Canned response deleted'));
    await load();
  };

  const columns = useMemo<ColumnDefinition<CannedResponseListItem>[]>(() => {
    const cols: ColumnDefinition<CannedResponseListItem>[] = [
      {
        title: t('cannedResponses.list.columns.name', 'Name'),
        dataIndex: 'name',
        render: (value: string, record: CannedResponseListItem) => (
          <span className="inline-flex items-center gap-1">
            {record.is_favorite && <Star className="h-3.5 w-3.5 fill-current text-[rgb(var(--color-primary-500))]" aria-label={t('cannedResponses.list.favorite', 'Favorite')} />}
            {value}
          </span>
        ),
      },
      {
        title: t('cannedResponses.list.columns.category', 'Category'),
        dataIndex: 'category',
        render: (value: string | null) => value || '—',
      },
      {
        title: t('cannedResponses.list.columns.scope', 'Available to'),
        dataIndex: 'scope',
        render: (_value: unknown, record: CannedResponseListItem) => scopeLabel(record),
      },
      {
        title: t('cannedResponses.list.columns.preview', 'Preview'),
        dataIndex: 'preview',
        sortable: false,
        render: (value: string) => <span className="line-clamp-1 text-[rgb(var(--color-text-500))]">{value}</span>,
      },
      {
        title: t('cannedResponses.list.columns.status', 'Status'),
        dataIndex: 'is_active',
        render: (value: boolean) => (
          <Badge variant={value ? 'success' : 'default-muted'}>
            {value ? t('cannedResponses.status.active', 'Active') : t('cannedResponses.status.inactive', 'Inactive')}
          </Badge>
        ),
      },
      {
        title: <span className="sr-only">{t('actions.rowActions', 'Actions')}</span>,
        dataIndex: 'actions',
        width: '4%',
        sortable: false,
        render: (_value: unknown, record: CannedResponseListItem) => (
          <div
            className="flex items-center justify-center"
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  id={`canned-response-actions-menu-${record.canned_response_id}`}
                  variant="ghost"
                  className="h-8 w-8 p-0"
                  onClick={(event) => event.stopPropagation()}
                >
                  <span className="sr-only">{t('actions.openMenu', 'Open menu')}</span>
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  id={`favorite-canned-response-menu-item-${record.canned_response_id}`}
                  onClick={(event) => { event.stopPropagation(); void toggleFavorite(record); }}
                >
                  <Star className="h-4 w-4 mr-2" />
                  {record.is_favorite
                    ? t('cannedResponses.actions.unfavorite', 'Remove from favorites')
                    : t('cannedResponses.actions.favorite', 'Add to favorites')}
                </DropdownMenuItem>
                {permissions.update && (
                  <DropdownMenuItem
                    id={`edit-canned-response-menu-item-${record.canned_response_id}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      router.push(`/msp/tickets/canned-responses/${record.canned_response_id}`);
                    }}
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    {t('cannedResponses.actions.edit', 'Edit')}
                  </DropdownMenuItem>
                )}
                {permissions.update && (
                  <DropdownMenuItem
                    id={`toggle-active-canned-response-menu-item-${record.canned_response_id}`}
                    onClick={(event) => { event.stopPropagation(); void toggleActive(record); }}
                  >
                    <Power className="h-4 w-4 mr-2" />
                    {record.is_active
                      ? t('cannedResponses.actions.deactivate', 'Deactivate')
                      : t('cannedResponses.actions.activate', 'Activate')}
                  </DropdownMenuItem>
                )}
                {permissions.delete && (
                  <DropdownMenuItem
                    id={`delete-canned-response-menu-item-${record.canned_response_id}`}
                    className="text-destructive"
                    onClick={(event) => { event.stopPropagation(); setPendingDelete(record); }}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {t('cannedResponses.actions.delete', 'Delete')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ];
    return cols;
  }, [t, scopeLabel, permissions.update, permissions.delete, router, toggleActive, toggleFavorite]);

  const openNew = () => router.push('/msp/tickets/canned-responses/new');

  return (
    <div id="canned-responses-page" className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('cannedResponses.list.title', 'Canned responses')}</h1>
        <div className="flex items-center gap-4">
          <SwitchWithLabel
            id="canned-responses-show-inactive"
            label={t('cannedResponses.list.showInactive', 'Show inactive')}
            checked={includeInactive}
            onCheckedChange={setIncludeInactive}
          />
          {permissions.create && (
            <Button id="canned-responses-new" type="button" onClick={openNew}>
              {t('cannedResponses.list.new', 'New canned response')}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-sm">
          <Input
            id="canned-responses-search"
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder={t('cannedResponses.list.searchPlaceholder', 'Search name, category or text…')}
            aria-label={t('cannedResponses.list.searchLabel', 'Search canned responses')}
          />
        </div>
        <div className="w-56">
          <CustomSelect
            id="canned-responses-category-filter"
            value={category}
            onValueChange={setCategory}
            options={[
              { value: ALL, label: t('cannedResponses.list.allCategories', 'All categories') },
              ...categories.map((name) => ({ value: name, label: name })),
            ]}
          />
        </div>
      </div>

      {error && <Alert id="canned-responses-error" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      {loading ? (
        <DataTableSkeleton
          id="canned-responses-loading"
          label={t('cannedResponses.loading', 'Loading…')}
          columnWidths={SKELETON_CELLS}
        />
      ) : (
        <>
          <DataTable
            id="canned-responses-table"
            data={items}
            columns={columns}
            pagination
            onRowClick={permissions.update || permissions.read
              ? (row) => router.push(`/msp/tickets/canned-responses/${row.canned_response_id}`)
              : undefined}
          />
          {!error && items.length === 0 && (
            <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
              <p id="canned-responses-empty" className="max-w-md text-sm text-[rgb(var(--color-text-500))]">
                {query || category !== ALL
                  ? t('cannedResponses.list.noResults', 'No canned responses match your filters.')
                  : t('cannedResponses.list.empty', 'No canned responses yet. Create one to reuse it in ticket replies.')}
              </p>
              {permissions.create && !query && category === ALL && (
                <Button id="canned-responses-empty-new" type="button" onClick={openNew}>
                  {t('cannedResponses.list.new', 'New canned response')}
                </Button>
              )}
            </div>
          )}
        </>
      )}

      <ConfirmationDialog
        id="canned-responses-delete-dialog"
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
        title={t('cannedResponses.list.deleteTitle', 'Delete canned response')}
        message={t('cannedResponses.list.deleteMessage', 'Delete "{{name}}"? Replies that already used it are not changed.', {
          name: pendingDelete?.name ?? '',
        })}
        confirmLabel={t('cannedResponses.actions.delete', 'Delete')}
        cancelLabel={t('cannedResponses.actions.cancel', 'Cancel')}
      />
    </div>
  );
}

export default CannedResponsesPage;
