'use client';

import { useState, useEffect, useCallback } from "react";
import { Button } from "@alga-psa/ui/components/Button";
import { Switch } from "@alga-psa/ui/components/Switch";
import { DataTable } from "@alga-psa/ui/components/DataTable";
import { ColumnDefinition } from "server/src/interfaces/dataTable.interfaces";
import { ChevronDown, ChevronRight, CornerDownRight, MoreVertical } from "lucide-react";
import { toast } from "react-hot-toast";
import { useUserPreference } from "server/src/hooks/useUserPreference";
import {
  getCategoriesAction,
  getSubtypesAction,
  updateInternalCategoryAction,
  updateInternalSubtypeAction
} from "server/src/lib/actions/internal-notification-actions/internalNotificationActions";
import {
  InternalNotificationCategory,
  InternalNotificationSubtype
} from "server/src/lib/models/internalNotification";
import LoadingIndicator from "@alga-psa/ui/components/LoadingIndicator";
import { ConfirmationDialog } from "@alga-psa/ui/components/ConfirmationDialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@alga-psa/ui/components/DropdownMenu";
import { Alert, AlertDescription } from "@alga-psa/ui/components/Alert";
import { useRegisterUnsavedChanges } from "server/src/contexts/UnsavedChangesContext";

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
  categoryId?: number; // For subtypes, the parent category id
}

export function InternalNotificationCategories() {
  const [categories, setCategories] = useState<InternalNotificationCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const currentCategories = await getCategoriesAction();
        setCategories(currentCategories);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load categories');
      }
    }
    init();
  }, []);

  if (error) {
    return <div className="text-red-500">{error}</div>;
  }

  if (!categories) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingIndicator
          layout="stacked"
          text="Loading internal notification categories..."
          spinnerProps={{ size: 'md' }}
        />
      </div>
    );
  }

  return <InternalNotificationCategoriesContent initialCategories={categories} />;
}

function InternalNotificationCategoriesContent({
  initialCategories,
}: {
  initialCategories: InternalNotificationCategory[];
}) {
  // Current state (what's displayed)
  const [categories, setCategories] = useState(initialCategories);
  const [subtypesByCategory, setSubtypesByCategory] = useState<Record<number, InternalNotificationSubtype[]>>({});
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(new Set());
  const [loadingSubtypes, setLoadingSubtypes] = useState<Set<number>>(new Set());

  // Original state (what's saved in DB)
  const [originalCategories, setOriginalCategories] = useState(initialCategories);
  const [originalSubtypes, setOriginalSubtypes] = useState<Record<number, InternalNotificationSubtype[]>>({});

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
  } = useUserPreference<number>('internal_notification_categories_page_size', {
    defaultValue: 10,
    localStorageKey: 'internal_notification_categories_page_size',
  });

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };


  // Check if there are unsaved changes
  const hasUnsavedChanges = pendingCategoryChanges.size > 0 || pendingSubtypeChanges.size > 0;

  // Register unsaved changes with context (handles navigation protection)
  useRegisterUnsavedChanges('internal-notification-categories', hasUnsavedChanges);

  // Load subtypes for a category
  const loadSubtypes = useCallback(async (categoryId: number) => {
    if (subtypesByCategory[categoryId]) {
      return; // Already loaded
    }

    setLoadingSubtypes(prev => new Set(prev).add(categoryId));
    try {
      const subtypes = await getSubtypesAction(categoryId);
      setSubtypesByCategory(prev => ({ ...prev, [categoryId]: subtypes }));
      setOriginalSubtypes(prev => ({ ...prev, [categoryId]: subtypes }));
    } catch (error) {
      console.error("Failed to load subtypes:", error);
      toast.error("Failed to load notification subtypes");
    } finally {
      setLoadingSubtypes(prev => {
        const next = new Set(prev);
        next.delete(categoryId);
        return next;
      });
    }
  }, [subtypesByCategory]);

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
  const handleToggleCategory = (category: InternalNotificationCategory, field: 'is_enabled' | 'is_default_enabled') => {
    const newValue = !category[field];

    // Update local state
    setCategories(prev =>
      prev.map(c => c.internal_notification_category_id === category.internal_notification_category_id
        ? { ...c, [field]: newValue }
        : c
      )
    );

    // Track pending change
    setPendingCategoryChanges(prev => {
      const next = new Map(prev);
      const existing = next.get(category.internal_notification_category_id) || { id: category.internal_notification_category_id };
      next.set(category.internal_notification_category_id, { ...existing, [field]: newValue });
      return next;
    });

    // If disabling category, also disable all subtypes in local state
    if (field === 'is_enabled' && !newValue) {
      const categorySubtypes = subtypesByCategory[category.internal_notification_category_id] || [];
      categorySubtypes.forEach(subtype => {
        if (subtype.is_enabled) {
          handleToggleSubtype(subtype, 'is_enabled', category.internal_notification_category_id, true);
        }
      });
    }
  };

  // Handle subtype toggle (local state only)
  const handleToggleSubtype = (
    subtype: InternalNotificationSubtype,
    field: 'is_enabled' | 'is_default_enabled',
    categoryId: number,
    skipCategoryCheck = false
  ) => {
    // Don't allow enabling if category is disabled
    const category = categories.find(c => c.internal_notification_category_id === categoryId);
    if (!skipCategoryCheck && field === 'is_enabled' && !category?.is_enabled) {
      return;
    }

    const newValue = skipCategoryCheck ? false : !subtype[field];

    // Update local state
    setSubtypesByCategory(prev => ({
      ...prev,
      [categoryId]: prev[categoryId].map(s =>
        s.internal_notification_subtype_id === subtype.internal_notification_subtype_id
          ? { ...s, [field]: newValue }
          : s
      )
    }));

    // Track pending change
    setPendingSubtypeChanges(prev => {
      const next = new Map(prev);
      const existing = next.get(subtype.internal_notification_subtype_id) || { id: subtype.internal_notification_subtype_id, categoryId };
      next.set(subtype.internal_notification_subtype_id, { ...existing, [field]: newValue });
      return next;
    });
  };

  // Save all pending changes
  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Save category changes
      const categoryPromises = Array.from(pendingCategoryChanges.values()).map(change =>
        updateInternalCategoryAction(change.id, {
          is_enabled: change.is_enabled,
          is_default_enabled: change.is_default_enabled
        })
      );

      // Save subtype changes
      const subtypePromises = Array.from(pendingSubtypeChanges.values()).map(change =>
        updateInternalSubtypeAction(change.id, {
          is_enabled: change.is_enabled,
          is_default_enabled: change.is_default_enabled
        })
      );

      await Promise.all([...categoryPromises, ...subtypePromises]);

      // Update original state to current state
      setOriginalCategories([...categories]);
      setOriginalSubtypes({ ...subtypesByCategory });

      // Clear pending changes
      setPendingCategoryChanges(new Map());
      setPendingSubtypeChanges(new Map());

      toast.success("Notification settings saved successfully");
    } catch (error) {
      console.error("Failed to save notification settings:", error);
      toast.error("Failed to save notification settings");
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
    toast.success("Changes discarded");
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
        id: `cat_${category.internal_notification_category_id}`,
        originalId: category.internal_notification_category_id,
        name: category.name,
        description: category.description,
        is_enabled: category.is_enabled,
        is_default_enabled: category.is_default_enabled,
        isCategory: true,
      });

      // Add subtypes if expanded
      if (expandedCategories.has(category.internal_notification_category_id)) {
        const subtypes = subtypesByCategory[category.internal_notification_category_id] || [];
        subtypes.forEach(subtype => {
          rows.push({
            id: `sub_${subtype.internal_notification_subtype_id}`,
            originalId: subtype.internal_notification_subtype_id,
            name: subtype.name,
            description: subtype.description,
            is_enabled: subtype.is_enabled,
            is_default_enabled: subtype.is_default_enabled,
            isCategory: false,
            categoryId: category.internal_notification_category_id,
          });
        });
      }
    });

    return rows;
  };

  const flatList = buildFlatList();

  const columns: ColumnDefinition<NotificationRow>[] = [
    {
      title: 'Name',
      dataIndex: 'name',
      render: (value: string, record: NotificationRow) => {
        if (record.isCategory) {
          const isExpanded = expandedCategories.has(record.originalId);
          const isLoading = loadingSubtypes.has(record.originalId);
          return (
            <div
              className="flex items-center"
              id={`expand-internal-category-${record.id}`}
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
      title: 'Description',
      dataIndex: 'description',
      render: (value: string | null) => (
        <span className="text-gray-600">{value || '-'}</span>
      ),
    },
    {
      title: 'Enabled',
      dataIndex: 'is_enabled',
      render: (value: boolean, record: NotificationRow) => {
        if (record.isCategory) {
          const category = categories.find(c => c.internal_notification_category_id === record.originalId)!;
          return (
            <div onClick={(e) => e.stopPropagation()}>
              <Switch
                id={`internal-category-enabled-${record.id}`}
                checked={value}
                onCheckedChange={() => handleToggleCategory(category, 'is_enabled')}
              />
            </div>
          );
        } else {
          const category = categories.find(c => c.internal_notification_category_id === record.categoryId);
          const subtype = subtypesByCategory[record.categoryId!]?.find(s => s.internal_notification_subtype_id === record.originalId);
          if (!subtype) return null;
          return (
            <div onClick={(e) => e.stopPropagation()}>
              <Switch
                id={`internal-subtype-enabled-${record.id}`}
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
      title: 'Default for Users',
      dataIndex: 'is_default_enabled',
      render: (value: boolean, record: NotificationRow) => {
        if (record.isCategory) {
          const category = categories.find(c => c.internal_notification_category_id === record.originalId)!;
          return (
            <div onClick={(e) => e.stopPropagation()}>
              <Switch
                id={`internal-category-default-${record.id}`}
                checked={value}
                onCheckedChange={() => handleToggleCategory(category, 'is_default_enabled')}
              />
            </div>
          );
        } else {
          const category = categories.find(c => c.internal_notification_category_id === record.categoryId);
          const subtype = subtypesByCategory[record.categoryId!]?.find(s => s.internal_notification_subtype_id === record.originalId);
          if (!subtype) return null;
          return (
            <div onClick={(e) => e.stopPropagation()}>
              <Switch
                id={`internal-subtype-default-${record.id}`}
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
      title: 'Actions',
      dataIndex: 'id',
      width: '10%',
      render: (value: string, record: NotificationRow) => {
        if (record.isCategory) {
          const category = categories.find(c => c.internal_notification_category_id === record.originalId)!;
          return (
            <div onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button id={`internal-category-${value}-actions-button`} variant="ghost" className="h-8 w-8 p-0">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    id={`enable-all-internal-subtypes-${value}`}
                    onClick={async () => {
                      await loadSubtypes(category.internal_notification_category_id);
                      const subtypes = subtypesByCategory[category.internal_notification_category_id] || [];
                      subtypes.forEach(subtype => {
                        if (!subtype.is_enabled) {
                          handleToggleSubtype(subtype, 'is_enabled', category.internal_notification_category_id);
                        }
                      });
                    }}
                    disabled={!category.is_enabled}
                  >
                    Enable all subtypes
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    id={`disable-all-internal-subtypes-${value}`}
                    onClick={async () => {
                      await loadSubtypes(category.internal_notification_category_id);
                      const subtypes = subtypesByCategory[category.internal_notification_category_id] || [];
                      subtypes.forEach(subtype => {
                        if (subtype.is_enabled) {
                          handleToggleSubtype(subtype, 'is_enabled', category.internal_notification_category_id, true);
                        }
                      });
                    }}
                  >
                    Disable all subtypes
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        } else {
          const category = categories.find(c => c.internal_notification_category_id === record.categoryId);
          const subtype = subtypesByCategory[record.categoryId!]?.find(s => s.internal_notification_subtype_id === record.originalId);
          if (!subtype) return null;

          return (
            <div onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button id={`internal-subtype-${value}-actions-button`} variant="ghost" className="h-8 w-8 p-0">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    id={`toggle-internal-subtype-enabled-${value}`}
                    onClick={() => handleToggleSubtype(subtype, 'is_enabled', record.categoryId!)}
                    disabled={!category?.is_enabled}
                  >
                    {subtype.is_enabled ? 'Disable' : 'Enable'}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    id={`toggle-internal-subtype-default-${value}`}
                    onClick={() => handleToggleSubtype(subtype, 'is_default_enabled', record.categoryId!)}
                  >
                    {subtype.is_default_enabled ? 'Disable default' : 'Enable default'}
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
            Control which internal notification types are available and set defaults for new users.
          </p>
          <ul className="text-sm text-gray-600 mt-2 ml-4 list-disc space-y-1">
            <li><strong>Enabled:</strong> Controls whether this notification type is active in the system</li>
            <li><strong>Default for Users:</strong> Sets whether new users have this notification enabled by default</li>
          </ul>
        </div>
        {hasUnsavedChanges && (
          <div className="flex gap-2">
            <Button
              id="discard-internal-notification-changes"
              variant="outline"
              onClick={() => setShowDiscardDialog(true)}
              disabled={isSaving}
            >
              Discard Changes
            </Button>
            <Button
              id="save-internal-notification-changes"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        )}
      </div>

      {hasUnsavedChanges && (
        <Alert variant="info">
          <AlertDescription>
            You have unsaved changes. Click "Save Changes" to apply them.
          </AlertDescription>
        </Alert>
      )}

      <DataTable
        id="internal-notification-categories-table"
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
        id="discard-internal-notification-changes-dialog"
        isOpen={showDiscardDialog}
        onClose={() => setShowDiscardDialog(false)}
        onConfirm={handleDiscard}
        title="Discard Changes?"
        message="Are you sure you want to discard all unsaved changes? This action cannot be undone."
        confirmLabel="Discard Changes"
        cancelLabel="Cancel"
      />
    </div>
  );
}
