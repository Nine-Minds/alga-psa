'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  ListChecks,
  Loader2,
  MoreVertical,
  Plus,
  Trash2,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { ContentCard } from '@alga-psa/ui/components';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatDateTime, getUserTimeZone, utcToLocal } from '@alga-psa/core';
import {
  addChecklistItem,
  applyChecklistTemplate,
  deleteChecklistItem,
  getChecklistTemplates,
  getTicketChecklistItems,
  reorderChecklistItems,
  setChecklistItemCompleted,
  updateChecklistItem,
} from '../../actions/checklists';
import type { IChecklistTemplate, ITicketChecklistItem } from '../../actions/checklists';

const COMPLETED_AT_FORMAT = 'MMM d, yyyy h:mm a';

/**
 * Summary used for the progress chip rendered near the ticket status control.
 * Required counts drive the close-rules gating; total/done drive the chip text.
 */
export function summarizeChecklist(items: ITicketChecklistItem[]): {
  requiredTotal: number;
  requiredDone: number;
  total: number;
  done: number;
} {
  let requiredTotal = 0;
  let requiredDone = 0;
  let done = 0;
  for (const item of items) {
    if (item.completed) done += 1;
    if (item.is_required) {
      requiredTotal += 1;
      if (item.completed) requiredDone += 1;
    }
  }
  return { requiredTotal, requiredDone, total: items.length, done };
}

interface TicketChecklistSectionProps {
  id?: string;
  ticketId: string;
  initialItems?: ITicketChecklistItem[];
  onItemsChanged?: (items: ITicketChecklistItem[]) => void;
  disabled?: boolean;
}

const TicketChecklistSection: React.FC<TicketChecklistSectionProps> = ({
  id = 'ticket-checklist-section',
  ticketId,
  initialItems,
  onItemsChanged,
  disabled = false,
}) => {
  const { t } = useTranslation('features/tickets');
  const { data: session } = useSession();

  const [items, setItems] = useState<ITicketChecklistItem[]>(initialItems ?? []);
  const [isLoading, setIsLoading] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [templates, setTemplates] = useState<IChecklistTemplate[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [applyingTemplateId, setApplyingTemplateId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isReordering, setIsReordering] = useState(false);

  // Keep a ref so async handlers always mutate from the latest list.
  const itemsRef = useRef<ITicketChecklistItem[]>(items);

  const applyItems = useCallback(
    (next: ITicketChecklistItem[]) => {
      itemsRef.current = next;
      setItems(next);
      onItemsChanged?.(next);
    },
    [onItemsChanged]
  );

  // Sync items from props when they change (by content signature, not reference)
  const prevInitialSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialItems) return;
    const signature = initialItems
      .map((item) => `${item.checklist_item_id}:${item.item_name}:${item.completed}:${item.is_required}:${item.order_number}`)
      .join(',');
    if (signature !== prevInitialSignatureRef.current) {
      prevInitialSignatureRef.current = signature;
      itemsRef.current = initialItems;
      setItems(initialItems);
    }
  }, [initialItems]);

  // Only fetch on mount if initialItems was not provided.
  useEffect(() => {
    if (initialItems !== undefined || !ticketId) return;
    let cancelled = false;
    setIsLoading(true);
    getTicketChecklistItems(ticketId)
      .then((fetched) => {
        if (!cancelled) applyItems(fetched);
      })
      .catch((error) => {
        console.error('Error fetching checklist items:', error);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  const reloadItems = useCallback(async () => {
    const fetched = await getTicketChecklistItems(ticketId);
    applyItems(fetched);
    return fetched;
  }, [ticketId, applyItems]);

  const timeZone = useMemo(() => getUserTimeZone(), []);
  const formatCompletedAt = useCallback(
    (completedAt: string | Date): string => {
      // Server actions return completed_at as a Date (Next preserves Dates
      // across the action boundary), while optimistic updates use an ISO
      // string. Normalize to a string before formatting, and never return a
      // non-string — rendering a Date as a React child crashes the page.
      const iso = completedAt instanceof Date ? completedAt.toISOString() : completedAt;
      try {
        return formatDateTime(utcToLocal(iso, timeZone), timeZone, COMPLETED_AT_FORMAT);
      } catch {
        return typeof iso === 'string' ? iso : '';
      }
    },
    [timeZone]
  );

  const summary = useMemo(() => summarizeChecklist(items), [items]);

  // Server rows from add/update/setCompleted don't carry the joined
  // completed_by_name; preserve or synthesize it when merging.
  const mergeServerItem = useCallback(
    (existing: ITicketChecklistItem, updated: ITicketChecklistItem, completedByNameHint?: string | null): ITicketChecklistItem => ({
      ...existing,
      ...updated,
      completed_by_name: updated.completed
        ? updated.completed_by_name ?? completedByNameHint ?? existing.completed_by_name ?? null
        : null,
    }),
    []
  );

  const handleToggleCompleted = useCallback(
    async (itemId: string, completed: boolean) => {
      const previousItem = itemsRef.current.find((item) => item.checklist_item_id === itemId);
      if (!previousItem || disabled) return;

      const sessionUserName = session?.user?.name ?? null;
      const nowIso = new Date().toISOString();

      // Optimistic flip; the server result replaces it (or we revert on error).
      applyItems(
        itemsRef.current.map((item) =>
          item.checklist_item_id === itemId
            ? {
                ...item,
                completed,
                completed_at: completed ? nowIso : null,
                completed_by_name: completed ? sessionUserName : null,
              }
            : item
        )
      );

      try {
        const updated = await setChecklistItemCompleted(itemId, completed);
        applyItems(
          itemsRef.current.map((item) =>
            item.checklist_item_id === itemId ? mergeServerItem(item, updated, sessionUserName) : item
          )
        );
      } catch (error) {
        applyItems(
          itemsRef.current.map((item) => (item.checklist_item_id === itemId ? previousItem : item))
        );
        handleError(error, t('checklist.toggleFailed', 'Failed to update checklist item'));
      }
    },
    [applyItems, disabled, mergeServerItem, session, t]
  );

  const handleAddItem = useCallback(async () => {
    const name = newItemName.trim();
    if (!name || isAddingItem || disabled) return;
    setIsAddingItem(true);
    try {
      const created = await addChecklistItem(ticketId, { item_name: name });
      applyItems([...itemsRef.current, { ...created, completed_by_name: null }]);
      setNewItemName('');
    } catch (error) {
      handleError(error, t('checklist.addFailed', 'Failed to add checklist item'));
    } finally {
      setIsAddingItem(false);
    }
  }, [applyItems, disabled, isAddingItem, newItemName, t, ticketId]);

  const startEditing = useCallback((item: ITicketChecklistItem) => {
    setEditingItemId(item.checklist_item_id);
    setEditingName(item.item_name);
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingItemId(null);
    setEditingName('');
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingItemId) return;
    const name = editingName.trim();
    const current = itemsRef.current.find((item) => item.checklist_item_id === editingItemId);
    cancelEditing();
    if (!current || !name || name === current.item_name) return;
    try {
      const updated = await updateChecklistItem(editingItemId, { item_name: name });
      applyItems(
        itemsRef.current.map((item) =>
          item.checklist_item_id === current.checklist_item_id ? mergeServerItem(item, updated) : item
        )
      );
    } catch (error) {
      handleError(error, t('checklist.renameFailed', 'Failed to rename checklist item'));
    }
  }, [applyItems, cancelEditing, editingItemId, editingName, mergeServerItem, t]);

  const handleToggleRequired = useCallback(
    async (item: ITicketChecklistItem) => {
      try {
        const updated = await updateChecklistItem(item.checklist_item_id, { is_required: !item.is_required });
        applyItems(
          itemsRef.current.map((existing) =>
            existing.checklist_item_id === item.checklist_item_id ? mergeServerItem(existing, updated) : existing
          )
        );
      } catch (error) {
        handleError(error, t('checklist.updateFailed', 'Failed to update checklist item'));
      }
    },
    [applyItems, mergeServerItem, t]
  );

  const handleDeleteItem = useCallback(
    async (item: ITicketChecklistItem) => {
      try {
        await deleteChecklistItem(item.checklist_item_id);
        applyItems(itemsRef.current.filter((existing) => existing.checklist_item_id !== item.checklist_item_id));
      } catch (error) {
        handleError(error, t('checklist.deleteFailed', 'Failed to delete checklist item'));
      }
    },
    [applyItems, t]
  );

  const handleMoveItem = useCallback(
    async (index: number, direction: -1 | 1) => {
      const current = itemsRef.current;
      const targetIndex = index + direction;
      if (isReordering || targetIndex < 0 || targetIndex >= current.length) return;

      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      const renumbered = next.map((item, idx) => ({ ...item, order_number: idx }));

      applyItems(renumbered);
      setIsReordering(true);
      try {
        await reorderChecklistItems(ticketId, renumbered.map((item) => item.checklist_item_id));
      } catch (error) {
        applyItems(current);
        handleError(error, t('checklist.reorderFailed', 'Failed to reorder checklist items'));
      } finally {
        setIsReordering(false);
      }
    },
    [applyItems, isReordering, t, ticketId]
  );

  const loadTemplates = useCallback(async () => {
    if (templatesLoaded || templatesLoading) return;
    setTemplatesLoading(true);
    try {
      const fetched = await getChecklistTemplates();
      setTemplates(fetched);
      setTemplatesLoaded(true);
    } catch (error) {
      handleError(error, t('checklist.loadTemplatesFailed', 'Failed to load checklist templates'));
    } finally {
      setTemplatesLoading(false);
    }
  }, [t, templatesLoaded, templatesLoading]);

  const handleApplyTemplate = useCallback(
    async (template: IChecklistTemplate) => {
      if (applyingTemplateId || disabled) return;
      setApplyingTemplateId(template.template_id);
      try {
        const result = await applyChecklistTemplate(ticketId, template.template_id);
        if (!result.applied) {
          toast(t('checklist.templateAlreadyApplied', 'This template was already applied to this ticket.'));
        } else {
          await reloadItems();
          toast.success(t('checklist.templateApplied', 'Checklist template applied.'));
        }
      } catch (error) {
        handleError(error, t('checklist.applyTemplateFailed', 'Failed to apply checklist template'));
      } finally {
        setApplyingTemplateId(null);
      }
    },
    [applyingTemplateId, disabled, reloadItems, t, ticketId]
  );

  return (
    <ContentCard
      id={id}
      collapsible
      defaultExpanded={items.length > 0}
      title={t('checklist.title', 'Checklist')}
      headerIcon={<ListChecks className="w-5 h-5" />}
      count={items.length}
    >
      <div className="space-y-3">
        {/* Progress summary + apply-template picker */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-[rgb(var(--color-text-500))]">
            {items.length > 0
              ? t('checklist.progress', '{{done}} of {{total}} complete', {
                  done: summary.done,
                  total: summary.total,
                })
              : null}
          </span>
          <DropdownMenu
            onOpenChange={(open) => {
              if (open) void loadTemplates();
            }}
          >
            <DropdownMenuTrigger asChild disabled={disabled}>
              <Button
                id={`${id}-apply-template-btn`}
                type="button"
                variant="outline"
                size="xs"
                disabled={disabled || applyingTemplateId !== null}
                className="flex-shrink-0 ml-auto"
              >
                {applyingTemplateId ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                ) : (
                  <ClipboardList className="w-3.5 h-3.5 mr-1" />
                )}
                {t('checklist.applyTemplate', 'Apply template')}
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-w-xs">
              {templatesLoading ? (
                <DropdownMenuItem id={`${id}-templates-loading`} disabled>
                  {t('checklist.templatesLoading', 'Loading templates...')}
                </DropdownMenuItem>
              ) : templates.length === 0 ? (
                <DropdownMenuItem id={`${id}-templates-empty`} disabled>
                  {t('checklist.noTemplates', 'No templates available.')}
                </DropdownMenuItem>
              ) : (
                templates.map((template) => (
                  <DropdownMenuItem
                    key={template.template_id}
                    id={`${id}-apply-template-${template.template_id}`}
                    disabled={applyingTemplateId !== null}
                    onSelect={() => void handleApplyTemplate(template)}
                  >
                    <span className="truncate">{template.name}</span>
                    {template.items && template.items.length > 0 ? (
                      <span className="ml-2 text-xs text-[rgb(var(--color-text-400))]">
                        {template.items.length}
                      </span>
                    ) : null}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {summary.total > 0 ? (
          <div
            id={`${id}-progress-bar`}
            className="h-1.5 rounded-full bg-[rgb(var(--color-border-100))] overflow-hidden"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={summary.total}
            aria-valuenow={summary.done}
          >
            <div
              className="h-full rounded-full bg-green-500 dark:bg-green-400 transition-all"
              style={{ width: `${Math.round((summary.done / Math.max(1, summary.total)) * 100)}%` }}
            />
          </div>
        ) : null}

        {/* Checklist items */}
        {isLoading ? (
          <p className="flex items-center gap-2 text-sm text-[rgb(var(--color-text-500))]">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t('checklist.loading', 'Loading checklist...')}
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-[rgb(var(--color-text-500))]">
            {t('checklist.empty', 'No checklist items yet.')}
          </p>
        ) : (
          <div className="space-y-1">
            {items.map((item, index) => {
              const itemKey = item.checklist_item_id;
              const isEditing = editingItemId === itemKey;
              return (
                <div
                  key={itemKey}
                  className="group flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-[rgb(var(--color-border-50))] transition-colors"
                >
                  <Checkbox
                    id={`${id}-item-${itemKey}-checkbox`}
                    checked={item.completed}
                    disabled={disabled}
                    onChange={(event) => void handleToggleCompleted(itemKey, event.target.checked)}
                    size="sm"
                    containerClassName="mt-1"
                    skipRegistration
                  />
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <Input
                        id={`${id}-item-${itemKey}-name-input`}
                        value={editingName}
                        autoFocus
                        disabled={disabled}
                        onChange={(event) => setEditingName(event.target.value)}
                        onBlur={() => void handleSaveEdit()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void handleSaveEdit();
                          } else if (event.key === 'Escape') {
                            event.preventDefault();
                            cancelEditing();
                          }
                        }}
                        className="h-7 text-sm"
                        containerClassName="mb-0"
                      />
                    ) : (
                      <button
                        type="button"
                        id={`${id}-item-${itemKey}-name`}
                        disabled={disabled}
                        onClick={() => startEditing(item)}
                        title={t('checklist.clickToRename', 'Click to rename')}
                        className="flex items-center gap-1.5 flex-wrap text-left w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded-sm"
                      >
                        <span
                          className={`text-sm ${
                            item.completed
                              ? 'line-through text-[rgb(var(--color-text-500))]'
                              : 'text-[rgb(var(--color-text-900))]'
                          }`}
                        >
                          {item.item_name}
                        </span>
                        {item.is_required ? (
                          <Badge variant="warning" size="sm">
                            {t('checklist.requiredBadge', 'Required')}
                          </Badge>
                        ) : null}
                      </button>
                    )}
                    {item.description ? (
                      <p className="text-xs text-[rgb(var(--color-text-400))] truncate">{item.description}</p>
                    ) : null}
                    {/* Accountability: permanently shows who checked the item, and when. */}
                    {item.completed && item.completed_at ? (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-[rgb(var(--color-text-500))]">
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                        {item.completed_by_name ? (
                          <span className="font-medium text-[rgb(var(--color-text-700))]">
                            {item.completed_by_name}
                          </span>
                        ) : null}
                        <span>{formatCompletedAt(item.completed_at)}</span>
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <Button
                      id={`${id}-item-${itemKey}-move-up-btn`}
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={disabled || isReordering || index === 0}
                      onClick={() => void handleMoveItem(index, -1)}
                      aria-label={t('checklist.moveUp', 'Move up')}
                      title={t('checklist.moveUp', 'Move up')}
                      className="text-[rgb(var(--color-text-400))]"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      id={`${id}-item-${itemKey}-move-down-btn`}
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={disabled || isReordering || index === items.length - 1}
                      onClick={() => void handleMoveItem(index, 1)}
                      aria-label={t('checklist.moveDown', 'Move down')}
                      title={t('checklist.moveDown', 'Move down')}
                      className="text-[rgb(var(--color-text-400))]"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild disabled={disabled}>
                        <Button
                          id={`${id}-item-${itemKey}-menu-btn`}
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={disabled}
                          aria-label={t('checklist.itemMenu', 'Checklist item menu')}
                          title={t('checklist.itemMenu', 'Checklist item menu')}
                          className="text-[rgb(var(--color-text-400))]"
                        >
                          <MoreVertical className="w-3.5 h-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          id={`${id}-item-${itemKey}-toggle-required`}
                          onSelect={() => void handleToggleRequired(item)}
                        >
                          {item.is_required
                            ? t('checklist.markOptional', 'Mark as optional')
                            : t('checklist.markRequired', 'Mark as required')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          id={`${id}-item-${itemKey}-delete`}
                          className="text-red-600 focus:text-red-600"
                          onSelect={() => void handleDeleteItem(item)}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-2" />
                          {t('checklist.deleteItem', 'Delete item')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Add item row */}
        <div className="flex items-center gap-2">
          <Input
            id={`${id}-add-item-input`}
            value={newItemName}
            onChange={(event) => setNewItemName(event.target.value)}
            placeholder={t('checklist.addItemPlaceholder', 'Add a checklist item')}
            disabled={disabled || isAddingItem}
            containerClassName="mb-0 flex-1"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void handleAddItem();
              }
            }}
          />
          <Button
            id={`${id}-add-item-btn`}
            type="button"
            size="sm"
            variant="default"
            onClick={() => void handleAddItem()}
            disabled={disabled || isAddingItem || !newItemName.trim()}
            className="flex-shrink-0"
          >
            <Plus className="w-4 h-4 mr-1" />
            {t('checklist.addItem', 'Add')}
          </Button>
        </div>
      </div>
    </ContentCard>
  );
};

export default TicketChecklistSection;
