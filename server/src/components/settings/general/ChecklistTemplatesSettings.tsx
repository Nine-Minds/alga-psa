'use client'

import React, { useState, useEffect } from 'react';
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
  addChecklistTemplateItem,
  updateChecklistTemplateItem,
  deleteChecklistTemplateItem,
  reorderChecklistTemplateItems,
  getChecklistTemplateApplyRules,
  createChecklistTemplateApplyRule,
  updateChecklistTemplateApplyRule,
  deleteChecklistTemplateApplyRule,
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
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const isReturnedActionError = (value: unknown): value is ActionMessageError | ActionPermissionError =>
  isActionMessageError(value) || isActionPermissionError(value);

const ChecklistTemplatesSettings: React.FC = () => {
  const { t } = useTranslation('msp/settings');
  const [templates, setTemplates] = useState<IChecklistTemplate[]>([]);
  const [boards, setBoards] = useState<IBoard[]>([]);
  const [categories, setCategories] = useState<ITicketCategory[]>([]);
  const [priorities, setPriorities] = useState<IPriority[]>([]);
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
  const [formData, setFormData] = useState({ name: '', description: '', is_active: true });
  const [items, setItems] = useState<IChecklistTemplateItem[]>([]);
  const [newItemName, setNewItemName] = useState('');
  const [applyRules, setApplyRules] = useState<IChecklistTemplateApplyRule[]>([]);

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
  }, []);

  const fetchTemplates = async () => {
    try {
      const allTemplates = await getChecklistTemplates({ includeInactive: true });
      setTemplates(allTemplates);
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
    setFormData({ name: '', description: '', is_active: true });
    setItems([]);
    setNewItemName('');
    setApplyRules([]);
    setDialogError(null);
  };

  const startAdding = () => {
    setEditingTemplate(null);
    setFormData({ name: '', description: '', is_active: true });
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
    });
    setItems(template.items || []);
    setNewItemName('');
    setApplyRules([]);
    setDialogError(null);
    setShowAddEditDialog(true);

    try {
      const rules = await getChecklistTemplateApplyRules(template.template_id);
      setApplyRules(rules);
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

  const handleAddRule = async () => {
    if (!editingTemplate) return;
    try {
      const created = await createChecklistTemplateApplyRule(editingTemplate.template_id, {});
      if (isReturnedActionError(created)) {
        toast.error(getErrorMessage(created));
        return;
      }
      setApplyRules((prev) => [...prev, created]);
    } catch (error) {
      handleError(error, t('ticketing.checklistTemplates.messages.error.ruleSaveFailed'));
    }
  };

  const handleRuleChange = async (
    rule: IChecklistTemplateApplyRule,
    field: 'board_id' | 'category_id' | 'subcategory_id' | 'priority_id',
    value: string
  ) => {
    const nextRule: IChecklistTemplateApplyRule = { ...rule, [field]: value || null };
    if (field === 'category_id') {
      nextRule.subcategory_id = null;
    }
    setApplyRules((prev) => prev.map((r) =>
      r.apply_rule_id === rule.apply_rule_id ? nextRule : r
    ));

    try {
      const result = await updateChecklistTemplateApplyRule(rule.apply_rule_id, {
        board_id: nextRule.board_id,
        category_id: nextRule.category_id,
        subcategory_id: nextRule.subcategory_id,
        priority_id: nextRule.priority_id,
        is_enabled: nextRule.is_enabled,
      });
      if (isReturnedActionError(result)) {
        setApplyRules((prev) => prev.map((r) =>
          r.apply_rule_id === rule.apply_rule_id ? rule : r
        ));
        toast.error(getErrorMessage(result));
        return;
      }
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

  const categoryOptions: SelectOption[] = [
    anyOption,
    ...categories
      .filter((category) => !category.parent_category)
      .map((category): SelectOption => ({
        value: category.category_id,
        label: category.category_name,
      })),
  ];

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
      width: '25%',
      render: (value: string) => (
        <span className="text-gray-700 font-medium">{value}</span>
      ),
    },
    {
      title: t('ticketing.checklistTemplates.table.description'),
      dataIndex: 'description',
      width: '35%',
      render: (value: string | null) => (
        <span className="text-gray-600">{value || '-'}</span>
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
        <DataTable
          id="checklist-templates-table"
          data={templates}
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

                {applyRules.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t('ticketing.checklistTemplates.fields.rules.empty')}</p>
                )}

                {applyRules.map((rule, index) => (
                  <div key={rule.apply_rule_id} className="grid gap-3 rounded-md border border-gray-200 p-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto] md:items-end">
                    <div>
                      <Label htmlFor={`checklist-template-rule-board-${index}`}>{t('ticketing.checklistTemplates.fields.rules.board')}</Label>
                      <CustomSelect
                        id={`checklist-template-rule-board-${index}`}
                        value={rule.board_id || ''}
                        onValueChange={(value) => handleRuleChange(rule, 'board_id', value)}
                        options={boardOptions}
                        placeholder={t('ticketing.checklistTemplates.fields.rules.any')}
                      />
                    </div>
                    <div>
                      <Label htmlFor={`checklist-template-rule-category-${index}`}>{t('ticketing.checklistTemplates.fields.rules.category')}</Label>
                      <CustomSelect
                        id={`checklist-template-rule-category-${index}`}
                        value={rule.category_id || ''}
                        onValueChange={(value) => handleRuleChange(rule, 'category_id', value)}
                        options={categoryOptions}
                        placeholder={t('ticketing.checklistTemplates.fields.rules.any')}
                      />
                    </div>
                    <div>
                      <Label htmlFor={`checklist-template-rule-subcategory-${index}`}>{t('ticketing.checklistTemplates.fields.rules.subcategory')}</Label>
                      <CustomSelect
                        id={`checklist-template-rule-subcategory-${index}`}
                        value={rule.subcategory_id || ''}
                        onValueChange={(value) => handleRuleChange(rule, 'subcategory_id', value)}
                        options={subcategoryOptionsFor(rule.category_id)}
                        placeholder={t('ticketing.checklistTemplates.fields.rules.any')}
                        disabled={!rule.category_id}
                      />
                    </div>
                    <div>
                      <Label htmlFor={`checklist-template-rule-priority-${index}`}>{t('ticketing.checklistTemplates.fields.rules.priority')}</Label>
                      <CustomSelect
                        id={`checklist-template-rule-priority-${index}`}
                        value={rule.priority_id || ''}
                        onValueChange={(value) => handleRuleChange(rule, 'priority_id', value)}
                        options={priorityOptions}
                        placeholder={t('ticketing.checklistTemplates.fields.rules.any')}
                      />
                    </div>
                    <Button
                      id={`remove-checklist-template-rule-${index}`}
                      type="button"
                      variant="ghost"
                      onClick={() => handleDeleteRule(rule.apply_rule_id)}
                    >
                      {t('ticketing.checklistTemplates.actions.remove')}
                    </Button>
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
