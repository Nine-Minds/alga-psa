'use client'

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Plus, MoreVertical } from "lucide-react";
import { IBoard, IPriority, ITicketCategory, ColumnDefinition } from '@alga-psa/types';
import {
  getAllBoards,
} from '@alga-psa/tickets/actions/board-actions/boardActions';
import {
  getTicketCategories,
} from '@alga-psa/tickets/actions/ticketCategoryActions';
import {
  getChecklistTemplates,
  createChecklistTemplate,
  updateChecklistTemplate,
  deleteChecklistTemplate,
  duplicateChecklistTemplateToClient,
  addChecklistTemplateItem,
  updateChecklistTemplateItem,
  deleteChecklistTemplateItem,
  reorderChecklistTemplateItems,
  getChecklistTemplateApplyRules,
  createChecklistTemplateApplyRule,
  updateChecklistTemplateApplyRule,
  deleteChecklistTemplateApplyRule,
  getChecklistRuleServiceRequestDefinitions,
  getChecklistRuleClientNames,
  type ChecklistRuleServiceRequestDefinitionOption,
  IChecklistTemplate,
  IChecklistTemplateItem,
  IChecklistTemplateApplyRule,
} from '@alga-psa/tickets/actions/checklists/checklistTemplateActions';
import { getAllPriorities } from '@alga-psa/reference-data/actions/priorityActions';
import { toast } from 'react-hot-toast';
import {
  getErrorMessage,
  handleError,
  isActionMessageError,
  isActionPermissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Switch } from '@alga-psa/ui/components/Switch';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@alga-psa/ui/components/DropdownMenu';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { searchClientsForPicker } from '@alga-psa/clients/actions/clientPickerActions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import ChecklistRuleMatchers from './ChecklistRuleMatchers';
import { findAllTagsByType } from '@alga-psa/tags/actions/tagActions';
import type { ITag } from '@alga-psa/types';
import type { PredicateGroup, PredicateNode } from '@alga-psa/predicates';

const isReturnedActionError = (value: unknown): value is ActionMessageError | ActionPermissionError =>
  isActionMessageError(value) || isActionPermissionError(value);

const ChecklistTemplatesSettings: React.FC = () => {
  const { t } = useTranslation('msp/settings');
  const [templates, setTemplates] = useState<IChecklistTemplate[]>([]);
  const [boards, setBoards] = useState<IBoard[]>([]);
  const [categories, setCategories] = useState<ITicketCategory[]>([]);
  const [priorities, setPriorities] = useState<IPriority[]>([]);
  const deepLinkHandled = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  // LEVERAGE: friction datatable-client-paging — re-derives page/size state + reset handler DataTable already owns internally
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  // State for Add/Edit Dialog
  const [showAddEditDialog, setShowAddEditDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<IChecklistTemplate | null>(null);
  const [formData, setFormData] = useState<{ name: string; description: string; is_active: boolean; client_id: string | null }>({ name: '', description: '', is_active: true, client_id: null });
  // Settings list filter: null = every template; otherwise only templates scoped to that client
  const [clientFilterId, setClientFilterId] = useState<string | null>(null);
  const [duplicateDialog, setDuplicateDialog] = useState<{ template: IChecklistTemplate | null; clientId: string | null }>({ template: null, clientId: null });
  const [items, setItems] = useState<IChecklistTemplateItem[]>([]);
  const [newItemName, setNewItemName] = useState('');
  const [applyRules, setApplyRules] = useState<IChecklistTemplateApplyRule[]>([]);
  const [tagOptions, setTagOptions] = useState<Record<'client' | 'contact', ITag[]>>({ client: [], contact: [] });
  const [tagLoadError, setTagLoadError] = useState(false);
  const [clientNames, setClientNames] = useState<Record<string, string>>({});
  const [serviceRequestDefinitions, setServiceRequestDefinitions] = useState<ChecklistRuleServiceRequestDefinitionOption[]>([]);

  // State for Delete Dialog
  const [deleteDialog, setDeleteDialog] = useState<{
    isOpen: boolean;
    templateId: string;
    templateName: string;
  }>({ isOpen: false, templateId: '', templateName: '' });

  useEffect(() => {
    fetchTemplates();
    fetchBoards();
    fetchCategories();
    fetchPriorities();
    fetchServiceRequestDefinitions();
    void loadTagOptions();
  }, []);

  const loadTagOptions = async () => {
    setTagLoadError(false);
    try {
      const [client, contact] = await Promise.all([findAllTagsByType('client'), findAllTagsByType('contact')]);
      if (!Array.isArray(client) || !Array.isArray(contact)) throw new Error('Tag options unavailable');
      setTagOptions({ client, contact });
    } catch { setTagLoadError(true); }
  };

  const fetchServiceRequestDefinitions = async () => {
    try {
      const definitions = await getChecklistRuleServiceRequestDefinitions();
      setServiceRequestDefinitions(isReturnedActionError(definitions) ? [] : definitions);
    } catch (error) {
      console.error('Error fetching service request definitions:', error);
    }
  };

  const loadClientNames = async (clientIds: string[]) => {
    const missing = clientIds.filter((id) => !(id in clientNames));
    if (!missing.length) return;
    try {
      const rows = await getChecklistRuleClientNames(missing);
      if (isReturnedActionError(rows)) return;
      setClientNames((prev) => ({
        ...prev,
        ...Object.fromEntries(rows.map((row) => [row.client_id, row.client_name])),
      }));
    } catch (error) {
      console.error('Error fetching client names:', error);
    }
  };

  const fetchTemplates = async () => {
    try {
      const allTemplates = await getChecklistTemplates({ includeInactive: true });
      setTemplates(allTemplates);
      // Deep link from the client record's Checklists tab: ?template=<id> opens that editor once.
      const linkedId = new URLSearchParams(window.location.search).get('template');
      if (linkedId && !deepLinkHandled.current) {
        deepLinkHandled.current = true;
        const linked = allTemplates.find((tpl) => tpl.template_id === linkedId);
        if (linked) void startEditing(linked);
      }
    } catch (error) {
      console.error('Error fetching checklist templates:', error);
      setError(t('ticketing.checklistTemplates.messages.error.fetchFailed'));
    }
  };

  const fetchBoards = async () => {
    try {
      const allBoards = await getAllBoards(true);
      setBoards(allBoards);
    } catch (error) {
      console.error('Error fetching boards:', error);
    }
  };

  const fetchCategories = async () => {
    try {
      const allCategories = await getTicketCategories();
      if (isReturnedActionError(allCategories)) {
        toast.error(getErrorMessage(allCategories));
        setCategories([]);
        return;
      }
      setCategories(allCategories);
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  const fetchPriorities = async () => {
    try {
      const allPriorities = await getAllPriorities('ticket');
      setPriorities(allPriorities || []);
    } catch (error) {
      console.error('Error fetching priorities:', error);
      setPriorities([]);
    }
  };

  const closeDialog = () => {
    setShowAddEditDialog(false);
    setEditingTemplate(null);
    setFormData({ name: '', description: '', is_active: true, client_id: null });
    setItems([]);
    setNewItemName('');
    setApplyRules([]);
    setDialogError(null);
  };

  const startAdding = () => {
    setEditingTemplate(null);
    setFormData({ name: '', description: '', is_active: true, client_id: null });
    setItems([]);
    setNewItemName('');
    setApplyRules([]);
    setDialogError(null);
    setShowAddEditDialog(true);
  };

  const startEditing = async (template: IChecklistTemplate) => {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      description: template.description || '',
      is_active: template.is_active,
      client_id: template.client_id ?? null,
    });
    setItems(template.items || []);
    setNewItemName('');
    setApplyRules([]);
    setDialogError(null);
    setShowAddEditDialog(true);

    try {
      const rules = await getChecklistTemplateApplyRules(template.template_id);
      setApplyRules(rules);
      void loadClientNames(Array.from(new Set(rules.flatMap((rule) => {
        const ids: string[] = [];
        const visit = (node: PredicateNode): void => {
          if ('clauses' in node) node.clauses.forEach(visit);
          else if (node.path === 'client.id') (Array.isArray(node.value) ? node.value : [node.value]).forEach((value) => { if (typeof value === 'string') ids.push(value); });
        };
        visit(rule.where); return ids;
      }))));
    } catch (error) {
      console.error('Error fetching apply rules:', error);
      setDialogError(t('ticketing.checklistTemplates.messages.error.fetchRulesFailed'));
    }
  };

  const handleSaveTemplate = async () => {
    try {
      setDialogError(null);

      if (!formData.name.trim()) {
        setDialogError(t('ticketing.checklistTemplates.messages.error.nameRequired'));
        return;
      }

      if (editingTemplate) {
        const result = await updateChecklistTemplate(editingTemplate.template_id, {
          name: formData.name,
          description: formData.description || null,
          is_active: formData.is_active,
          client_id: formData.client_id,
        });
        if (isReturnedActionError(result)) {
          setDialogError(getErrorMessage(result));
          return;
        }
        toast.success(t('ticketing.checklistTemplates.messages.success.updated'));
        closeDialog();
      } else {
        const created = await createChecklistTemplate({
          name: formData.name,
          description: formData.description || null,
          is_active: formData.is_active,
          client_id: formData.client_id,
        });
        if (isReturnedActionError(created)) {
          setDialogError(getErrorMessage(created));
          return;
        }
        toast.success(t('ticketing.checklistTemplates.messages.success.created'));
        // Keep the dialog open in edit mode so items and rules can be added
        setEditingTemplate(created);
        setItems([]);
        setApplyRules([]);
      }
      await fetchTemplates();
    } catch (error) {
      console.error('Error saving checklist template:', error);
      setDialogError(error instanceof Error ? error.message : t('ticketing.checklistTemplates.messages.error.saveFailed'));
    }
  };

  const handleDeleteTemplate = async () => {
    try {
      const result = await deleteChecklistTemplate(deleteDialog.templateId);
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        setDeleteDialog({ isOpen: false, templateId: '', templateName: '' });
        return;
      }
      toast.success(t('ticketing.checklistTemplates.messages.success.deleted'));
      setDeleteDialog({ isOpen: false, templateId: '', templateName: '' });
      await fetchTemplates();
    } catch (error) {
      handleError(error, t('ticketing.checklistTemplates.messages.error.deleteFailed'));
      setDeleteDialog({ isOpen: false, templateId: '', templateName: '' });
    }
  };

  const handleDuplicateToClient = async () => {
    if (!duplicateDialog.template || !duplicateDialog.clientId) return;
    try {
      const result = await duplicateChecklistTemplateToClient(duplicateDialog.template.template_id, duplicateDialog.clientId);
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('ticketing.checklistTemplates.messages.success.duplicated'));
      setDuplicateDialog({ template: null, clientId: null });
      await fetchTemplates();
    } catch (error) {
      handleError(error, t('ticketing.checklistTemplates.messages.error.duplicateFailed'));
    }
  };

  // --- Item management (persisted immediately on the template being edited) ---

  const handleAddItem = async () => {
    if (!editingTemplate || !newItemName.trim()) return;
    try {
      const created = await addChecklistTemplateItem(editingTemplate.template_id, {
        item_name: newItemName,
      });
      if (isReturnedActionError(created)) {
        toast.error(getErrorMessage(created));
        return;
      }
      setItems((prev) => [...prev, created]);
      setNewItemName('');
      await fetchTemplates();
    } catch (error) {
      handleError(error, t('ticketing.checklistTemplates.messages.error.itemSaveFailed'));
    }
  };

  const updateLocalItem = (templateItemId: string, updates: Partial<IChecklistTemplateItem>) => {
    setItems((prev) => prev.map((item) =>
      item.template_item_id === templateItemId ? { ...item, ...updates } : item
    ));
  };

  const persistItemName = async (item: IChecklistTemplateItem) => {
    if (!item.item_name.trim()) return;
    try {
      const result = await updateChecklistTemplateItem(item.template_item_id, { item_name: item.item_name });
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      await fetchTemplates();
    } catch (error) {
      handleError(error, t('ticketing.checklistTemplates.messages.error.itemSaveFailed'));
    }
  };

  const handleToggleItemRequired = async (item: IChecklistTemplateItem, isRequired: boolean) => {
    updateLocalItem(item.template_item_id, { is_required: isRequired });
    try {
      const result = await updateChecklistTemplateItem(item.template_item_id, { is_required: isRequired });
      if (isReturnedActionError(result)) {
        updateLocalItem(item.template_item_id, { is_required: !isRequired });
        toast.error(getErrorMessage(result));
        return;
      }
      await fetchTemplates();
    } catch (error) {
      updateLocalItem(item.template_item_id, { is_required: !isRequired });
      handleError(error, t('ticketing.checklistTemplates.messages.error.itemSaveFailed'));
    }
  };

  const handleDeleteItem = async (templateItemId: string) => {
    try {
      const result = await deleteChecklistTemplateItem(templateItemId);
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      setItems((prev) => prev.filter((item) => item.template_item_id !== templateItemId));
      await fetchTemplates();
    } catch (error) {
      handleError(error, t('ticketing.checklistTemplates.messages.error.itemSaveFailed'));
    }
  };

  // LEVERAGE: pattern checklist-item-list-editor — add/reorder/remove list of checklist items is also written by TicketTemplateEditor; both should share one editor component
  const moveItem = async (templateItemId: string, direction: 'up' | 'down') => {
    if (!editingTemplate) return;

    const currentIndex = items.findIndex((item) => item.template_item_id === templateItemId);
    if (currentIndex === -1) return;

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= items.length) return;

    const nextItems = [...items];
    const [movedItem] = nextItems.splice(currentIndex, 1);
    nextItems.splice(targetIndex, 0, movedItem);
    setItems(nextItems);

    try {
      const result = await reorderChecklistTemplateItems(
        editingTemplate.template_id,
        nextItems.map((item) => item.template_item_id)
      );
      if (isReturnedActionError(result)) {
        setItems(items);
        toast.error(getErrorMessage(result));
        return;
      }
      await fetchTemplates();
    } catch (error) {
      setItems(items);
      handleError(error, t('ticketing.checklistTemplates.messages.error.itemSaveFailed'));
    }
  };

  // --- Auto-apply rule management ---

  // The persisted owner of the template being edited (the dialog closes on save, so a pending
  // change of owner in the form never applies to the rules shown here).
  const ownerClientName: string | null = editingTemplate?.client_id
    ? templates.find((tpl) => tpl.template_id === editingTemplate.template_id)?.client_name
      ?? editingTemplate.client_name
      ?? t('ticketing.checklistTemplates.scope.unknownClient')
    : null;

  const handleAddRule = async () => {
    if (!editingTemplate) return;
    try {
      const created = await createChecklistTemplateApplyRule(editingTemplate.template_id, { where: { join: 'and', clauses: [] }, is_enabled: false });
      if (isReturnedActionError(created)) {
        toast.error(getErrorMessage(created));
        return;
      }
      setApplyRules((prev) => [...prev, created]);
    } catch (error) {
      handleError(error, t('ticketing.checklistTemplates.messages.error.ruleSaveFailed'));
    }
  };

  const ruleToInput = (rule: IChecklistTemplateApplyRule) => ({
    where: rule.where, where_version: rule.where_version, is_enabled: rule.is_enabled,
  });

  /** Optimistically apply a rule edit, persist it, and roll back on failure. */
  const persistRule = async (rule: IChecklistTemplateApplyRule, nextRule: IChecklistTemplateApplyRule) => {
    setApplyRules((prev) => prev.map((r) =>
      r.apply_rule_id === rule.apply_rule_id ? nextRule : r
    ));

    try {
      const result = await updateChecklistTemplateApplyRule(rule.apply_rule_id, ruleToInput(nextRule));
      if (isReturnedActionError(result)) {
        setApplyRules((prev) => prev.map((r) =>
          r.apply_rule_id === rule.apply_rule_id ? rule : r
        ));
        toast.error(getErrorMessage(result));
        return;
      }
      // Keep what the server normalised (trimmed / de-duplicated keywords).
      setApplyRules((prev) => prev.map((r) =>
        r.apply_rule_id === rule.apply_rule_id ? { ...nextRule, ...result } : r
      ));
    } catch (error) {
      setApplyRules((prev) => prev.map((r) =>
        r.apply_rule_id === rule.apply_rule_id ? rule : r
      ));
      handleError(error, t('ticketing.checklistTemplates.messages.error.ruleSaveFailed'));
    }
  };

  const handleDeleteRule = async (applyRuleId: string) => {
    try {
      const result = await deleteChecklistTemplateApplyRule(applyRuleId);
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      setApplyRules((prev) => prev.filter((rule) => rule.apply_rule_id !== applyRuleId));
    } catch (error) {
      handleError(error, t('ticketing.checklistTemplates.messages.error.ruleSaveFailed'));
    }
  };

  const anyOption: SelectOption = { value: '', label: t('ticketing.checklistTemplates.fields.rules.any') };

  const boardOptions: SelectOption[] = [
    anyOption,
    ...boards
      .slice()
      .sort((a, b) => (a.display_order || 0) - (b.display_order || 0) || (a.board_name || '').localeCompare(b.board_name || ''))
      .map((board): SelectOption => ({
        value: board.board_id || '',
        label: board.board_name || '-',
      }))
      .filter((option) => option.value),
  ];

  const boardNameById = new Map(boards.map((board) => [board.board_id, board.board_name || '-']));
  const boardRank = new Map(boardOptions.map((option, rank) => [option.value, rank]));

  // Category ids are board-scoped, so a rule's category must come from the rule's board.
  // With no board selected, every board's categories are offered, grouped and labelled by board.
  const categoryOptionsFor = (boardId: string | null): SelectOption[] => {
    const topLevel = categories.filter((category) => !category.parent_category);
    if (boardId) {
      return [
        anyOption,
        ...topLevel
          .filter((category) => category.board_id === boardId)
          .map((category): SelectOption => ({
            value: category.category_id,
            label: category.category_name,
          })),
      ];
    }
    return [
      anyOption,
      ...topLevel
        .slice()
        .sort((a, b) =>
          (boardRank.get(a.board_id || '') ?? Number.MAX_SAFE_INTEGER) -
          (boardRank.get(b.board_id || '') ?? Number.MAX_SAFE_INTEGER)
        )
        .map((category): SelectOption => {
          const boardName = category.board_id ? boardNameById.get(category.board_id) : undefined;
          return {
            value: category.category_id,
            label: boardName ? `${category.category_name} (${boardName})` : category.category_name,
          };
        }),
    ];
  };

  const subcategoryOptionsFor = (categoryId: string | null): SelectOption[] => [
    anyOption,
    ...categories
      .filter((category) => !!categoryId && category.parent_category === categoryId)
      .map((category): SelectOption => ({
        value: category.category_id,
        label: category.category_name,
      })),
  ];

  const priorityOptions: SelectOption[] = [
    anyOption,
    ...priorities
      .slice()
      .sort((a, b) => (a.order_number - b.order_number) || a.priority_name.localeCompare(b.priority_name))
      .map((priority): SelectOption => ({
        value: priority.priority_id,
        label: priority.priority_name,
      })),
  ];

  const columns: ColumnDefinition<IChecklistTemplate>[] = [
    {
      title: t('ticketing.checklistTemplates.table.name'),
      dataIndex: 'name',
      width: '20%',
      render: (value: string) => (
        <span className="text-gray-700 font-medium">{value}</span>
      ),
    },
    {
      title: t('ticketing.checklistTemplates.table.description'),
      dataIndex: 'description',
      width: '25%',
      render: (value: string | null) => (
        <span className="text-gray-600">{value || '-'}</span>
      ),
    },
    {
      title: t('ticketing.checklistTemplates.table.scope'),
      dataIndex: 'client_id',
      width: '12%',
      render: (_value: string | null, record: IChecklistTemplate) => (
        <span className="text-gray-600">
          {record.client_id
            ? (record.client_name || t('ticketing.checklistTemplates.scope.unknownClient'))
            : t('ticketing.checklistTemplates.scope.allClients')}
        </span>
      ),
    },
    {
      title: t('ticketing.checklistTemplates.table.items'),
      dataIndex: 'items',
      width: '12%',
      render: (value: IChecklistTemplateItem[] | undefined) => (
        <span className="text-gray-600">{value?.length || 0}</span>
      ),
    },
    {
      title: t('ticketing.checklistTemplates.table.status'),
      dataIndex: 'is_active',
      width: '15%',
      render: (value: boolean, record: IChecklistTemplate) => (
        <div className="flex items-center space-x-2">
          <span className="text-sm text-gray-600">
            {value ? t('ticketing.checklistTemplates.statusLabels.active') : t('ticketing.checklistTemplates.statusLabels.inactive')}
          </span>
          <Switch
            checked={value}
            onCheckedChange={async (checked) => {
              try {
                const result = await updateChecklistTemplate(record.template_id, { is_active: checked });
                if (isReturnedActionError(result)) {
                  toast.error(getErrorMessage(result));
                  return;
                }
                await fetchTemplates();
              } catch (error) {
                handleError(error, t('ticketing.checklistTemplates.messages.error.updateStatusFailed'));
              }
            }}
            className="data-[state=checked]:bg-primary-500"
          />
        </div>
      ),
    },
    {
      title: t('ticketing.checklistTemplates.table.actions'),
      dataIndex: 'template_id',
      width: '8%',
      render: (value: string, record: IChecklistTemplate) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button id="checklist-template-actions-menu" variant="ghost" className="h-8 w-8 p-0">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => startEditing(record)}>
              {t('ticketing.checklistTemplates.actions.edit')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDuplicateDialog({ template: record, clientId: null })}>
              {t('ticketing.checklistTemplates.actions.duplicateToClient')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setDeleteDialog({
                isOpen: true,
                templateId: value,
                templateName: record.name,
              })}
              className="text-destructive"
            >
              {t('ticketing.checklistTemplates.actions.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    },
  ];

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm">
      <div>
        <h3 className="text-lg font-semibold mb-4 text-gray-800">{t('ticketing.checklistTemplates.title')}</h3>
        <Alert variant="info" className="mb-4">
          <AlertDescription>
            {t('ticketing.checklistTemplates.alert')}
          </AlertDescription>
        </Alert>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="mb-4 flex items-center gap-2">
          <Label htmlFor="checklist-template-client-filter">{t('ticketing.checklistTemplates.filter.client')}</Label>
          <ClientPicker
            id="checklist-template-client-filter"
            searchClients={searchClientsForPicker}
            selectedClientId={clientFilterId}
            onSelect={(clientId) => { setClientFilterId(clientId); setCurrentPage(1); }}
            placeholder={t('ticketing.checklistTemplates.filter.allClients')}
            fitContent={true}
          />
          {clientFilterId && (
            <Button id="clear-checklist-template-client-filter" variant="ghost" onClick={() => { setClientFilterId(null); setCurrentPage(1); }}>
              {t('ticketing.checklistTemplates.filter.clear')}
            </Button>
          )}
        </div>
        <DataTable
          id="checklist-templates-table"
          data={clientFilterId ? templates.filter((template) => template.client_id === clientFilterId) : templates}
          columns={columns}
          pagination={true}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          pageSize={pageSize}
          onItemsPerPageChange={handlePageSizeChange}
        />
        <div className="mt-4">
          <Button
            id="add-checklist-template-button"
            onClick={startAdding}
            className="bg-primary-500 text-white hover:bg-primary-600"
          >
            <Plus className="h-4 w-4 mr-2" /> {t('ticketing.checklistTemplates.actions.addTemplate')}
          </Button>
        </div>
      </div>

      <ConfirmationDialog
        id="delete-checklist-template-dialog"
        isOpen={deleteDialog.isOpen}
        onClose={() => setDeleteDialog({ isOpen: false, templateId: '', templateName: '' })}
        onConfirm={handleDeleteTemplate}
        title={t('ticketing.checklistTemplates.dialog.deleteTitle')}
        message={t('ticketing.checklistTemplates.dialog.deleteMessage', { name: deleteDialog.templateName })}
        confirmLabel={t('ticketing.checklistTemplates.actions.delete')}
        cancelLabel={t('ticketing.checklistTemplates.actions.cancel')}
      />

      <Dialog
        isOpen={!!duplicateDialog.template}
        onClose={() => setDuplicateDialog({ template: null, clientId: null })}
        title={t('ticketing.checklistTemplates.dialog.duplicateTitle')}
        footer={(
          <div className="flex justify-end space-x-2">
            <Button id="cancel-duplicate-checklist-template" variant="outline" onClick={() => setDuplicateDialog({ template: null, clientId: null })}>
              {t('ticketing.checklistTemplates.actions.cancel')}
            </Button>
            <Button id="confirm-duplicate-checklist-template" onClick={handleDuplicateToClient} disabled={!duplicateDialog.clientId}>
              {t('ticketing.checklistTemplates.actions.duplicate')}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              {t('ticketing.checklistTemplates.dialog.duplicateHelp', { name: duplicateDialog.template?.name ?? '' })}
            </p>
            <ClientPicker
              id="duplicate-checklist-template-client"
              searchClients={searchClientsForPicker}
              selectedClientId={duplicateDialog.clientId}
              onSelect={(clientId) => setDuplicateDialog((prev) => ({ ...prev, clientId }))}
              placeholder={t('ticketing.checklistTemplates.dialog.duplicateClientPlaceholder')}
              fitContent={true}
              modal={true}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Add/Edit Dialog */}
      <Dialog
        isOpen={showAddEditDialog}
        onClose={closeDialog}
        title={editingTemplate ? t('ticketing.checklistTemplates.dialog.editTemplate') : t('ticketing.checklistTemplates.dialog.addTemplate')}
        footer={(
          <div className="space-y-3">
            {dialogError && (
              <Alert variant="destructive">
                <AlertDescription>{dialogError}</AlertDescription>
              </Alert>
            )}
            <div className="flex justify-end space-x-2">
              <Button
                id="cancel-checklist-template-dialog"
                variant="outline"
                onClick={closeDialog}
              >
                {editingTemplate ? t('ticketing.checklistTemplates.actions.close') : t('ticketing.checklistTemplates.actions.cancel')}
              </Button>
              <Button
                id="save-checklist-template-button"
                onClick={handleSaveTemplate}
                disabled={!formData.name.trim()}
              >
                {editingTemplate ? t('ticketing.checklistTemplates.actions.update') : t('ticketing.checklistTemplates.actions.create')}
              </Button>
            </div>
          </div>
        )}
      >
        <DialogContent>
          <div className="space-y-4">
            <div>
              <Label htmlFor="checklist-template-name" required>{t('ticketing.checklistTemplates.fields.name.label')}</Label>
              <Input
                id="checklist-template-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={t('ticketing.checklistTemplates.fields.name.placeholder')}
              />
            </div>
            <div>
              <Label htmlFor="checklist-template-description">{t('ticketing.checklistTemplates.fields.description.label')}</Label>
              <Input
                id="checklist-template-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder={t('ticketing.checklistTemplates.fields.description.placeholder')}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="checklist-template-active">{t('ticketing.checklistTemplates.fields.active')}</Label>
              <Switch
                id="checklist-template-active"
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
              />
            </div>

            <div>
              <Label htmlFor="checklist-template-client">{t('ticketing.checklistTemplates.fields.availableTo.label')}</Label>
              <div className="flex items-center gap-2">
                <ClientPicker
                  id="checklist-template-client"
                  searchClients={searchClientsForPicker}
                  selectedClientId={formData.client_id}
                  onSelect={(clientId) => setFormData({ ...formData, client_id: clientId })}
                  placeholder={t('ticketing.checklistTemplates.scope.allClients')}
                  fitContent={true}
                  modal={true}
                />
                {formData.client_id && (
                  <Button
                    id="clear-checklist-template-client"
                    type="button"
                    variant="ghost"
                    onClick={() => setFormData({ ...formData, client_id: null })}
                  >
                    {t('ticketing.checklistTemplates.fields.availableTo.clear')}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t('ticketing.checklistTemplates.fields.availableTo.help')}
              </p>
            </div>

            {!editingTemplate && (
              <p className="text-xs text-muted-foreground">
                {t('ticketing.checklistTemplates.dialog.createFirstHelp')}
              </p>
            )}

            {editingTemplate && (
              <div className="space-y-3 rounded-md border border-gray-200 p-4">
                <div>
                  <Label>{t('ticketing.checklistTemplates.fields.items.label')}</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('ticketing.checklistTemplates.fields.items.help')}
                  </p>
                </div>

                {items.map((item, index) => (
                  <div key={item.template_item_id} className="grid gap-3 rounded-md border border-gray-200 p-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
                    <div>
                      <Label htmlFor={`checklist-template-item-name-${index}`}>{t('ticketing.checklistTemplates.fields.items.itemName')}</Label>
                      <Input
                        id={`checklist-template-item-name-${index}`}
                        value={item.item_name}
                        onChange={(event) => updateLocalItem(item.template_item_id, { item_name: event.target.value })}
                        onBlur={() => persistItemName(items[index])}
                        placeholder={t('ticketing.checklistTemplates.fields.items.itemName')}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`checklist-template-item-required-${index}`}>{t('ticketing.checklistTemplates.fields.items.required')}</Label>
                      <Switch
                        id={`checklist-template-item-required-${index}`}
                        checked={item.is_required}
                        onCheckedChange={(checked) => handleToggleItemRequired(item, checked)}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        id={`move-checklist-template-item-up-${index}`}
                        type="button"
                        variant="ghost"
                        onClick={() => moveItem(item.template_item_id, 'up')}
                        disabled={index === 0}
                      >
                        {t('ticketing.checklistTemplates.actions.up')}
                      </Button>
                      <Button
                        id={`move-checklist-template-item-down-${index}`}
                        type="button"
                        variant="ghost"
                        onClick={() => moveItem(item.template_item_id, 'down')}
                        disabled={index === items.length - 1}
                      >
                        {t('ticketing.checklistTemplates.actions.down')}
                      </Button>
                      <Button
                        id={`remove-checklist-template-item-${index}`}
                        type="button"
                        variant="ghost"
                        onClick={() => handleDeleteItem(item.template_item_id)}
                      >
                        {t('ticketing.checklistTemplates.actions.remove')}
                      </Button>
                    </div>
                  </div>
                ))}

                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Label htmlFor="new-checklist-template-item-name">{t('ticketing.checklistTemplates.fields.items.newItemLabel')}</Label>
                    <Input
                      id="new-checklist-template-item-name"
                      value={newItemName}
                      onChange={(e) => setNewItemName(e.target.value)}
                      placeholder={t('ticketing.checklistTemplates.fields.items.newItemPlaceholder')}
                    />
                  </div>
                  <Button
                    id="add-checklist-template-item-button"
                    type="button"
                    variant="outline"
                    onClick={handleAddItem}
                    disabled={!newItemName.trim()}
                  >
                    {t('ticketing.checklistTemplates.actions.addItem')}
                  </Button>
                </div>
              </div>
            )}

            {editingTemplate && (
              <div className="space-y-3 rounded-md border border-gray-200 p-4">
                <div>
                  <Label>{t('ticketing.checklistTemplates.fields.rules.label')}</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('ticketing.checklistTemplates.fields.rules.help')}
                  </p>
                </div>

                {ownerClientName != null && (
                  <Alert variant="warning">
                    <AlertDescription>
                      {t('ticketing.checklistTemplates.fields.rules.clientScopedWarning', { client: ownerClientName })}
                    </AlertDescription>
                  </Alert>
                )}

                {applyRules.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t('ticketing.checklistTemplates.fields.rules.empty')}</p>
                )}

                {applyRules.map((rule, index) => (
                  <div key={rule.apply_rule_id} className="space-y-3 rounded-md border border-gray-200 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <Switch id={`checklist-rule-enabled-${index}`} checked={rule.is_enabled}
                      label={t('ticketing.checklistTemplates.predicate.enabled')}
                      onCheckedChange={(is_enabled) => void persistRule(rule, { ...rule, is_enabled })} />
                    <Button id={`remove-checklist-template-rule-${index}`} type="button" variant="ghost" onClick={() => handleDeleteRule(rule.apply_rule_id)}>
                      {t('ticketing.checklistTemplates.actions.remove')}
                    </Button>
                  </div>
                  {tagLoadError && <Alert variant="destructive"><AlertDescription>
                    {t('ticketing.checklistTemplates.predicate.tagsFailed')}
                    <Button id={`retry-rule-tags-${index}`} variant="ghost" onClick={() => void loadTagOptions()}>{t('ticketing.checklistTemplates.predicate.retry')}</Button>
                  </AlertDescription></Alert>}
                  <ChecklistRuleMatchers rule={rule} index={index} clientNames={clientNames}
                    tags={tagOptions} ownerClientName={ownerClientName}
                    options={{ boards: boardOptions, categories: categoryOptionsFor(null),
                      subcategories: categories.filter((category) => category.parent_category).map((category) => ({ value: category.category_id, label: category.category_name })),
                      priorities: priorityOptions,
                      origins: ['internal', 'client_portal', 'inbound_email', 'api', 'recurring'].map((value) => ({ value, label: t(`ticketing.checklistTemplates.fields.rules.originLabels.${value}`, { defaultValue: value }) })),
                      definitions: serviceRequestDefinitions.map((definition) => ({ value: definition.definition_id, label: definition.name })) }}
                    onClientPicked={(clientId) => void loadClientNames([clientId])}
                    onChange={(where: PredicateGroup) => persistRule(rule, { ...rule, where })} />
                  </div>
                ))}

                <div className="flex justify-start">
                  <Button
                    id="add-checklist-template-rule-button"
                    type="button"
                    variant="outline"
                    onClick={handleAddRule}
                  >
                    {t('ticketing.checklistTemplates.actions.addRule')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ChecklistTemplatesSettings;
