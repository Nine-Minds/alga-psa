'use client';

import { useState, useEffect } from "react";
import { Card } from "server/src/components/ui/Card";
import { Button } from "server/src/components/ui/Button";
import { Switch } from "server/src/components/ui/Switch";
import { DataTable } from "server/src/components/ui/DataTable";
import { ColumnDefinition } from "server/src/interfaces/dataTable.interfaces";
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
    return <div>Loading...</div>;
  }

  return <InternalNotificationCategoriesContent categories={categories} />;
}

function InternalNotificationCategoriesContent({
  categories: initialCategories,
}: {
  categories: InternalNotificationCategory[];
}) {
  const [categories, setCategories] = useState(initialCategories);
  const [expandedCategory, setExpandedCategory] = useState<number | null>(null);
  const [subtypes, setSubtypes] = useState<InternalNotificationSubtype[]>([]);
  const [currentCategory, setCurrentCategory] = useState<InternalNotificationCategory | null>(null);

  // Pagination state for categories table
  const [currentPageCategories, setCurrentPageCategories] = useState(1);
  const [pageSizeCategories, setPageSizeCategories] = useState(10);

  // Handle page size change for categories - reset to page 1
  const handlePageSizeChangeCategories = (newPageSize: number) => {
    setPageSizeCategories(newPageSize);
    setCurrentPageCategories(1);
  };

  // Pagination state for subtypes table
  const [currentPageSubtypes, setCurrentPageSubtypes] = useState(1);
  const [pageSizeSubtypes, setPageSizeSubtypes] = useState(10);

  // Handle page size change for subtypes - reset to page 1
  const handlePageSizeChangeSubtypes = (newPageSize: number) => {
    setPageSizeSubtypes(newPageSize);
    setCurrentPageSubtypes(1);
  };

  const handleToggleCategory = async (category: InternalNotificationCategory, field: 'is_enabled' | 'is_default_enabled') => {
    try {
      const updated = await updateInternalCategoryAction(category.internal_notification_category_id, {
        [field]: !category[field]
      });

      setCategories(prev =>
        prev.map(c => c.internal_notification_category_id === category.internal_notification_category_id ? updated : c)
      );

      if (currentCategory?.internal_notification_category_id === category.internal_notification_category_id) {
        setCurrentCategory(updated);
      }
    } catch (error) {
      console.error(`Failed to update category ${field}:`, error);
    }
  };

  const handleToggleSubtype = async (subtype: InternalNotificationSubtype, field: 'is_enabled' | 'is_default_enabled') => {
    try {
      const updated = await updateInternalSubtypeAction(subtype.internal_notification_subtype_id, {
        [field]: !subtype[field]
      });

      setSubtypes(prev =>
        prev.map(s => s.internal_notification_subtype_id === subtype.internal_notification_subtype_id ? updated : s)
      );
    } catch (error) {
      console.error(`Failed to update subtype ${field}:`, error);
    }
  };

  const handleExpandCategory = async (category: InternalNotificationCategory) => {
    if (expandedCategory === category.internal_notification_category_id) {
      setExpandedCategory(null);
      setSubtypes([]);
      setCurrentCategory(null);
      return;
    }

    try {
      const subtypesData = await getSubtypesAction(category.internal_notification_category_id);
      setSubtypes(subtypesData);
      setExpandedCategory(category.internal_notification_category_id);
      setCurrentCategory(category);
    } catch (error) {
      console.error("Failed to load subtypes:", error);
    }
  };

  const categoryColumns: ColumnDefinition<InternalNotificationCategory>[] = [
    {
      title: "Name",
      dataIndex: "name"
    },
    {
      title: "Description",
      dataIndex: "description",
      render: (value): React.ReactNode => value || "-"
    },
    {
      title: "Enabled",
      dataIndex: "is_enabled",
      render: (value, record): React.ReactNode => (
        <Switch
          checked={value}
          onCheckedChange={() => handleToggleCategory(record, 'is_enabled')}
        />
      )
    },
    {
      title: "Default for Users",
      dataIndex: "is_default_enabled",
      render: (value, record): React.ReactNode => (
        <Switch
          checked={value}
          onCheckedChange={() => handleToggleCategory(record, 'is_default_enabled')}
        />
      )
    },
    {
      title: "Actions",
      dataIndex: "internal_notification_category_id",
      render: (value, record): React.ReactNode => (
        <Button
          id={`category-${record.internal_notification_category_id}`}
          onClick={() => handleExpandCategory(record)}
          variant="outline"
        >
          {expandedCategory === record.internal_notification_category_id ? "Hide Subtypes" : "Show Subtypes"}
        </Button>
      )
    }
  ];

  const subtypeColumns: ColumnDefinition<InternalNotificationSubtype>[] = [
    {
      title: "Name",
      dataIndex: "name"
    },
    {
      title: "Description",
      dataIndex: "description",
      render: (value): React.ReactNode => value || "-"
    },
    {
      title: "Enabled",
      dataIndex: "is_enabled",
      render: (value, record): React.ReactNode => (
        <Switch
          checked={value}
          onCheckedChange={() => handleToggleSubtype(record, 'is_enabled')}
          disabled={!currentCategory?.is_enabled}
        />
      )
    },
    {
      title: "Default for Users",
      dataIndex: "is_default_enabled",
      render: (value, record): React.ReactNode => (
        <Switch
          checked={value}
          onCheckedChange={() => handleToggleSubtype(record, 'is_default_enabled')}
          disabled={!currentCategory?.is_enabled}
        />
      )
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold">Internal Notification Categories</h2>
          <p className="text-sm text-gray-600 mt-1">
            Control which internal notification types are available system-wide and set defaults for new users.
          </p>
          <ul className="text-sm text-gray-600 mt-2 ml-4 list-disc space-y-1">
            <li><strong>Enabled:</strong> Controls whether this notification type is active in the system</li>
            <li><strong>Default for Users:</strong> Sets whether new users have this notification enabled by default</li>
          </ul>
        </div>
      </div>

      <Card className="p-6">
        <DataTable
          id="internal-notification-categories-table"
          data={categories}
          columns={categoryColumns}
          pagination={true}
          currentPage={currentPageCategories}
          onPageChange={setCurrentPageCategories}
          pageSize={pageSizeCategories}
          onItemsPerPageChange={handlePageSizeChangeCategories}
        />
      </Card>

      {expandedCategory && (
        <Card className="p-6">
          <div className="mb-4">
            <h3 className="text-md font-semibold">Notification Subtypes</h3>
            {!currentCategory?.is_enabled && (
              <p className="text-sm text-gray-500 mt-1">
                These notification subtypes are currently disabled because their parent category is disabled.
              </p>
            )}
          </div>
          <DataTable
            id="internal-notification-subtypes-table"
            data={subtypes}
            columns={subtypeColumns}
            pagination={true}
            currentPage={currentPageSubtypes}
            onPageChange={setCurrentPageSubtypes}
            pageSize={pageSizeSubtypes}
            onItemsPerPageChange={handlePageSizeChangeSubtypes}
          />
        </Card>
      )}
    </div>
  );
}
