'use client';


import { useState, useEffect, useCallback } from "react";
import { Button } from "@alga-psa/ui/components/Button";
import { Switch } from "@alga-psa/ui/components/Switch";
import { DataTable } from "@alga-psa/ui/components/DataTable";
import { ColumnDefinition } from "@alga-psa/types";
import { ChevronDown, ChevronRight, CornerDownRight, MoreVertical, Lock } from "lucide-react";
import { toast } from "react-hot-toast";
import { getErrorMessage, handleError } from "@alga-psa/ui/lib/errorHandling";
import { useUserPreference } from "@alga-psa/user-composition/hooks";
import {
  getCategoriesAction,
  getCategoryWithSubtypesAction,
  isNotificationActionError,
  updateCategoryAction,
  updateSubtypeAction
} from "../../actions";
import {
  NotificationCategory,
  NotificationSubtype
} from "../../types/notification";
import LoadingIndicator from "@alga-psa/ui/components/LoadingIndicator";
import { ConfirmationDialog } from "@alga-psa/ui/components/ConfirmationDialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@alga-psa/ui/components/DropdownMenu";
import { Alert, AlertDescription } from "@alga-psa/ui/components/Alert";
import { useRegisterUnsavedChanges } from "@alga-psa/ui";
import { useTranslation } from "@alga-psa/ui/lib/i18n/client";

// Types for tracking pending changes
interface PendingCategoryChange {
  id: number;
  is_enabled?: boolean;
  is_default_enabled?: boolean;
}

interface PendingSubtypeChange {
  id: number;
  categoryId: number;
  is_enabled?: boolean;
  is_default_enabled?: boolean;
}

// Combined row type for the flat list
interface NotificationRow {
  id: string; // Unique ID for DataTable: "cat_<id>" or "sub_<id>"
  originalId: number; // The actual DB ID for lookups
  name: string;
  description: string | null;
  is_enabled: boolean;
  is_default_enabled: boolean;
  isCategory: boolean;
  is_locked?: boolean; // For categories, whether it's locked (cannot be disabled)
  categoryId?: number; // For subtypes, the parent category id
  category_id?: number; // From the original subtype
}

export function NotificationCategories() {
  const { t } = useTranslation('msp/settings');
  const [categories, setCategories] = useState<NotificationCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const currentCategories = await getCategoriesAction();
        setCategories(currentCategories);
      } catch (err) {
        console.error('Failed to load notification categories:', err);
        setError(t('notifications.categoriesUi.errors.loadCategories', 'Failed to load categories'));
      }
    }
    init();
  }, [t]);

  if (error) {
    return <div className="text-red-500">{error}</div>;
  }

  if (!categories) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingIndicator
          layout="stacked"
          text={t('notifications.categoriesUi.loading', 'Loading notification categories...')}
          spinnerProps={{ size: 'md' }}
        />
      </div>
    );
  }

  return <NotificationCategoriesContent initialCategories={categories} />;
}

function NotificationCategoriesContent({
  initialCategories,
}: {
  initialCategories: NotificationCategory[];
}) {
  const { t } = useTranslation('msp/settings');
  // Current state (what's displayed)
  const [categories, setCategories] = useState(initialCategories);
  const [subtypesByCategory, setSubtypesByCategory] = useState<Record<number, NotificationSubtype[]>>({});
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(new Set());
  const [loadingSubtypes, setLoadingSubtypes] = useState<Set<number>>(new Set());

  // Original state (what's saved in DB)
  const [originalCategories, setOriginalCategories] = useState(initialCategories);
  const [originalSubtypes, setOriginalSubtypes] = useState<Record<number, NotificationSubtype[]>>({});

  // Pending changes tracking
  const [pendingCategoryChanges, setPendingCategoryChanges] = useState<Map<number, PendingCategoryChange>>(new Map());
  const [pendingSubtypeChanges, setPendingSubtypeChanges] = useState<Map<number, PendingSubtypeChange>>(new Map());

  // UI state
  const [isSaving, setIsSaving] = useState(false);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);

  const {
    value: pageSize,
    setValue: setPageSize
  } = useUserPreference<number>('email_notification_categories_page_size', {
    defaultValue: 10,
    localStorageKey: 'email_notification_categories_page_size',
  });

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };


  // Check if there are unsaved changes
  const hasUnsavedChanges = pendingCategoryChanges.size > 0 || pendingSubtypeChanges.size > 0;

  // Register unsaved changes with context (handles navigation protection)
  useRegisterUnsavedChanges('email-notification-categories', hasUnsavedChanges);

  // Load subtypes for a category
  const loadSubtypes = useCallback(async (categoryId: number) => {
    if (subtypesByCategory[categoryId]) {
      return; // Already loaded
    }

    setLoadingSubtypes(prev => new Set(prev).add(categoryId));
    try {
      const result = await getCategoryWithSubtypesAction(categoryId);
      if (isNotificationActionError(result)) {
        handleError(result, t('notifications.categoriesUi.errors.loadSubtypes', 'Failed to load notification subtypes'));
        return;
      }
      const { subtypes } = result;
      setSubtypesByCategory(prev => ({ ...prev, [categoryId]: subtypes }));
      setOriginalSubtypes(prev => ({ ...prev, [categoryId]: subtypes }));
    } catch (error) {
      handleError(error, t('notifications.categoriesUi.errors.loadSubtypes', 'Failed to load notification subtypes'));
    } finally {
      setLoadingSubtypes(prev => {
        const next = new Set(prev);
        next.delete(categoryId);
        return next;
      });
    }
  }, [subtypesByCategory, t]);

  // Toggle category expansion
  const handleToggleExpand = async (categoryId: number) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(categoryId)) {
      newExpanded.delete(categoryId);
    } else {
      newExpanded.add(categoryId);
      await loadSubtypes(categoryId);
    }
    setExpandedCategories(newExpanded);
  };

  // Handle category toggle (local state only)
  const handleToggleCategory = (category: NotificationCategory, field: 'is_enabled' | 'is_default_enabled') => {
    const newValue = !category[field];

    // Update local state
    setCategories(prev =>
      prev.map(c => c.id === category.id ? { ...c, [field]: newValue } : c)
    );

    // Track pending change
    setPendingCategoryChanges(prev => {
      const next = new Map(prev);
      const existing = next.get(category.id) || { id: category.id };
      next.set(category.id, { ...existing, [field]: newValue });
      return next;
    });

    // If disabling category, also disable all subtypes in local state
    if (field === 'is_enabled' && !newValue) {
      const categorySubtypes = subtypesByCategory[category.id] || [];
      categorySubtypes.forEach(subtype => {
        if (subtype.is_enabled) {
          handleToggleSubtype(subtype, 'is_enabled', category.id, true);
        }
      });
    }
  };

  // Handle subtype toggle (local state only)
  const handleToggleSubtype = (
    subtype: NotificationSubtype,
    field: 'is_enabled' | 'is_default_enabled',
    categoryId: number,
    skipCategoryCheck = false
  ) => {
    // Don't allow enabling if category is disabled
    const category = categories.find(c => c.id === categoryId);
    if (!skipCategoryCheck && field === 'is_enabled' && !category?.is_enabled) {
      return;
    }

    const newValue = skipCategoryCheck ? false : !subtype[field];

    // Update local state
    setSubtypesByCategory(prev => ({
      ...prev,
      [categoryId]: prev[categoryId].map(s =>
        s.id === subtype.id ? { ...s, [field]: newValue } : s
      )
    }));

    // Track pending change
    setPendingSubtypeChanges(prev => {
      const next = new Map(prev);
      const existing = next.get(subtype.id) || { id: subtype.id, categoryId };
      next.set(subtype.id, { ...existing, [field]: newValue });
      return next;
    });
  };

  // Save all pending changes
  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Save category changes
      const categoryPromises = Array.from(pendingCategoryChanges.values()).map(change =>
        updateCategoryAction(change.id, {
          is_enabled: change.is_enabled,
          is_default_enabled: change.is_default_enabled
        })
      );

      // Save subtype changes
      const subtypePromises = Array.from(pendingSubtypeChanges.values()).map(change =>
        updateSubtypeAction(change.id, {
          is_enabled: change.is_enabled,
          is_default_enabled: change.is_default_enabled
        })
      );

      const results = await Promise.all([...categoryPromises, ...subtypePromises]);
      const firstError = results.find(isNotificationActionError);
      if (firstError) {
        toast.error(getErrorMessage(firstError));
        return;
      }

      // Update original state to current state
      setOriginalCategories([...categories]);
      setOriginalSubtypes({ ...subtypesByCategory });

      // Clear pending changes
      setPendingCategoryChanges(new Map());
      setPendingSubtypeChanges(new Map());

      toast.success(t('notifications.categoriesUi.toasts.saved', 'Notification settings saved successfully'));
    } catch (error) {
      handleError(error, t('notifications.categoriesUi.errors.save', 'Failed to save notification settings'));
    } finally {
      setIsSaving(false);
    }
  };

  // Discard all pending changes
  const handleDiscard = () => {
    // Restore original state
    setCategories([...originalCategories]);
    setSubtypesByCategory({ ...originalSubtypes });

    // Clear pending changes
    setPendingCategoryChanges(new Map());
    setPendingSubtypeChanges(new Map());

    setShowDiscardDialog(false);
    toast.success(t('notifications.categoriesUi.toasts.discarded', 'Changes discarded'));
  };

  // Check if a row has pending changes
  const rowHasChanges = (row: NotificationRow): boolean => {
    if (row.isCategory) {
      return pendingCategoryChanges.has(row.originalId);
    }
    return pendingSubtypeChanges.has(row.originalId);
  };

  // Build flat list with categories and their subtypes interleaved
  const buildFlatList = (): NotificationRow[] => {
    const rows: NotificationRow[] = [];

    categories.forEach(category => {
      // Add category row
      rows.push({
        id: `cat_${category.id}`,
        originalId: category.id,
        name: category.name,
        description: category.description,
        is_enabled: category.is_enabled,
        is_default_enabled: category.is_default_enabled,
        isCategory: true,
        is_locked: category.is_locked,
      });

      // Add subtypes if expanded
      if (expandedCategories.has(category.id)) {
        const subtypes = subtypesByCategory[category.id] || [];
        subtypes.forEach(subtype => {
          rows.push({
            id: `sub_${subtype.id}`,
            originalId: subtype.id,
            name: subtype.name,
            description: subtype.description,
            is_enabled: subtype.is_enabled,
            is_default_enabled: subtype.is_default_enabled,
            isCategory: false,
            categoryId: category.id,
            category_id: subtype.category_id,
          });
        });
      }
    });

    return rows;
  };

  const flatList = buildFlatList();

  const columns: ColumnDefinition<NotificationRow>[] = [
    {
      title: t('notifications.categoriesUi.columns.name', 'Name'),
      dataIndex: 'name',
      render: (value: string, record: NotificationRow) => {
        if (record.isCategory) {
          const isExpanded = expandedCategories.has(record.originalId);
          const isLoading = loadingSubtypes.has(record.originalId);
          return (
            <div
              className="flex items-center"
              id={`expand-category-${record.id}`}
            >
              <div className="p-1 mr-2">
                {isLoading ? (
                  <LoadingIndicator spinnerProps={{ size: 'sm' }} />
                ) : isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </div>
              <span className={`font-semibold ${rowHasChanges(record) ? 'text-blue-600' : 'text-gray-700'}`}>
                {value}
                {rowHasChanges(record) && <span className="ml-1 text-xs">*</span>}
              </span>
              {record.is_locked && (
                <span className="ml-2 flex items-center text-gray-400" title={t('notifications.categoriesUi.tooltips.cannotDisable', 'This category cannot be disabled')}>
                  <Lock className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
          );
        } else {
          return (
            <div className="flex items-center pl-8">
              <CornerDownRight className="h-3 w-3 text-muted-foreground mr-2" />
              <span className={`font-medium ${rowHasChanges(record) ? 'text-blue-600' : 'text-gray-700'}`}>
                {value}
                {rowHasChanges(record) && <span className="ml-1 text-xs">*</span>}
              </span>
            </div>
          );
        }
      },
    },
    {
      title: t('notifications.categoriesUi.columns.description', 'Description'),
      dataIndex: 'description',
      render: (value: string | null) => (
        <span className="text-gray-600">{value || '-'}</span>
      ),
    },
    {
      title: t('notifications.categoriesUi.columns.enabled', 'Enabled'),
      dataIndex: 'is_enabled',
      render: (value: boolean, record: NotificationRow) => {
        if (record.isCategory) {
          const category = categories.find(c => c.id === record.originalId)!;
          const isLocked = record.is_locked;
          return (
            <div onClick={(e) => e.stopPropagation()} title={isLocked ? t('notifications.categoriesUi.tooltips.cannotDisable', 'This category cannot be disabled') : undefined}>
              <Switch
                id={`category-enabled-${record.id}`}
                checked={isLocked ? true : value}
                onCheckedChange={() => !isLocked && handleToggleCategory(category, 'is_enabled')}
                disabled={isLocked}
              />
            </div>
          );
        } else {
          const category = categories.find(c => c.id === record.categoryId);
          const subtype = subtypesByCategory[record.categoryId!]?.find(s => s.id === record.originalId);
          if (!subtype) return null;
          return (
            <div onClick={(e) => e.stopPropagation()}>
              <Switch
                id={`subtype-enabled-${record.id}`}
                checked={value}
                onCheckedChange={() => handleToggleSubtype(subtype, 'is_enabled', record.categoryId!)}
                disabled={!category?.is_enabled}
              />
            </div>
          );
        }
      },
    },
    {
      title: t('notifications.categoriesUi.columns.defaultForUsers', 'Default for Users'),
      dataIndex: 'is_default_enabled',
      render: (value: boolean, record: NotificationRow) => {
        if (record.isCategory) {
          const category = categories.find(c => c.id === record.originalId)!;
          const isLocked = record.is_locked;
          return (
            <div onClick={(e) => e.stopPropagation()} title={isLocked ? t('notifications.categoriesUi.tooltips.cannotModify', 'This category cannot be modified') : undefined}>
              <Switch
                id={`category-default-${record.id}`}
                checked={isLocked ? true : value}
                onCheckedChange={() => !isLocked && handleToggleCategory(category, 'is_default_enabled')}
                disabled={isLocked}
              />
            </div>
          );
        } else {
          const category = categories.find(c => c.id === record.categoryId);
          const subtype = subtypesByCategory[record.categoryId!]?.find(s => s.id === record.originalId);
          if (!subtype) return null;
          return (
            <div onClick={(e) => e.stopPropagation()}>
              <Switch
                id={`subtype-default-${record.id}`}
                checked={value}
                onCheckedChange={() => handleToggleSubtype(subtype, 'is_default_enabled', record.categoryId!)}
                disabled={!category?.is_enabled}
              />
            </div>
          );
        }
      },
    },
    {
      title: t('notifications.categoriesUi.columns.actions', 'Actions'),
      dataIndex: 'id',
      width: '10%',
      render: (value: string, record: NotificationRow) => {
        if (record.isCategory) {
          const category = categories.find(c => c.id === record.originalId)!;
          return (
            <div onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button id={`category-${value}-actions-button`} variant="ghost" className="h-8 w-8 p-0">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    id={`enable-all-subtypes-${value}`}
                    onClick={async () => {
                      await loadSubtypes(category.id);
                      const subtypes = subtypesByCategory[category.id] || [];
                      subtypes.forEach(subtype => {
                        if (!subtype.is_enabled) {
                          handleToggleSubtype(subtype, 'is_enabled', category.id);
                        }
                      });
                    }}
                    disabled={!category.is_enabled}
                  >
                    {t('notifications.categoriesUi.actions.enableAllSubtypes', 'Enable all subtypes')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    id={`disable-all-subtypes-${value}`}
                    onClick={async () => {
                      await loadSubtypes(category.id);
                      const subtypes = subtypesByCategory[category.id] || [];
                      subtypes.forEach(subtype => {
                        if (subtype.is_enabled) {
                          handleToggleSubtype(subtype, 'is_enabled', category.id, true);
                        }
                      });
                    }}
                  >
                    {t('notifications.categoriesUi.actions.disableAllSubtypes', 'Disable all subtypes')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        } else {
          const category = categories.find(c => c.id === record.categoryId);
          const subtype = subtypesByCategory[record.categoryId!]?.find(s => s.id === record.originalId);
          if (!subtype) return null;

          return (
            <div onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button id={`subtype-${value}-actions-button`} variant="ghost" className="h-8 w-8 p-0">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    id={`toggle-subtype-enabled-${value}`}
                    onClick={() => handleToggleSubtype(subtype, 'is_enabled', record.categoryId!)}
                    disabled={!category?.is_enabled}
                  >
                    {subtype.is_enabled ? t('notifications.categoriesUi.actions.disable', 'Disable') : t('notifications.categoriesUi.actions.enable', 'Enable')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    id={`toggle-subtype-default-${value}`}
                    onClick={() => handleToggleSubtype(subtype, 'is_default_enabled', record.categoryId!)}
                  >
                    {subtype.is_default_enabled ? t('notifications.categoriesUi.actions.disableDefault', 'Disable default') : t('notifications.categoriesUi.actions.enableDefault', 'Enable default')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        }
      },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-sm text-gray-600">
            {t('notifications.categoriesUi.help.intro', 'Control which email notification types are available and set defaults for new users.')}
          </p>
          <ul className="text-sm text-gray-600 mt-2 ml-4 list-disc space-y-1">
            <li><strong>{t('notifications.categoriesUi.help.enabledLabel', 'Enabled:')}</strong> {t('notifications.categoriesUi.help.enabledDescription', 'Controls whether this notification type is active')}</li>
            <li><strong>{t('notifications.categoriesUi.help.defaultLabel', 'Default for Users:')}</strong> {t('notifications.categoriesUi.help.defaultDescription', 'Sets whether new users have this notification enabled by default')}</li>
          </ul>
        </div>
        {hasUnsavedChanges && (
          <div className="flex gap-2">
            <Button
              id="discard-notification-changes"
              variant="outline"
              onClick={() => setShowDiscardDialog(true)}
              disabled={isSaving}
            >
              {t('notifications.categoriesUi.actions.discardChanges', 'Discard Changes')}
            </Button>
            <Button
              id="save-notification-changes"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? t('notifications.categoriesUi.actions.saving', 'Saving...') : t('notifications.categoriesUi.actions.saveChanges', 'Save Changes')}
            </Button>
          </div>
        )}
      </div>

      {hasUnsavedChanges && (
        <Alert variant="info">
          <AlertDescription>
            {t('notifications.categoriesUi.unsavedChangesAlert', 'You have unsaved changes. Click "Save Changes" to apply them.')}
          </AlertDescription>
        </Alert>
      )}

      <DataTable
        id="notification-categories-table"
        data={flatList}
        columns={columns}
        pagination={true}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        pageSize={pageSize}
        onItemsPerPageChange={handlePageSizeChange}
        onRowClick={(row: NotificationRow) => {
          // Only expand/collapse for category rows
          if (row.isCategory && !loadingSubtypes.has(row.originalId)) {
            handleToggleExpand(row.originalId);
          }
        }}
      />

      {/* Discard confirmation dialog */}
      <ConfirmationDialog
        id="discard-notification-changes-dialog"
        isOpen={showDiscardDialog}
        onClose={() => setShowDiscardDialog(false)}
        onConfirm={handleDiscard}
        title={t('notifications.categoriesUi.discardDialog.title', 'Discard Changes?')}
        message={t('notifications.categoriesUi.discardDialog.message', 'Are you sure you want to discard all unsaved changes? This action cannot be undone.')}
        confirmLabel={t('notifications.categoriesUi.actions.discardChanges', 'Discard Changes')}
        cancelLabel={t('notifications.categoriesUi.actions.cancel', 'Cancel')}
      />
    </div>
  );
}
