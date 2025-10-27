'use client';

import { useState, useEffect } from "react";
import { Card } from "server/src/components/ui/Card";
import { Button } from "server/src/components/ui/Button";
import { Switch } from "server/src/components/ui/Switch";
import { DataTable } from "server/src/components/ui/DataTable";
import { ColumnDefinition } from "server/src/interfaces/dataTable.interfaces";
import { 
  getCategoriesAction,
  getCategoryWithSubtypesAction,
  updateCategoryAction,
  updateSubtypeAction
} from "@product/actions/notification-actions/notificationActions";
import { 
  NotificationCategory,
  NotificationSubtype 
} from "server/src/lib/models/notification";

export function NotificationCategories() {
  const [categories, setCategories] = useState<NotificationCategory[] | null>(null);
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

  return <NotificationCategoriesContent categories={categories} />;
}

function NotificationCategoriesContent({
  categories: initialCategories,
}: {
  categories: NotificationCategory[];
}) {
  const [categories, setCategories] = useState(initialCategories);
  const [expandedCategory, setExpandedCategory] = useState<number | null>(null);
  const [subtypes, setSubtypes] = useState<NotificationSubtype[]>([]);
  const [currentCategory, setCurrentCategory] = useState<NotificationCategory | null>(null);

  const handleToggleCategory = async (category: NotificationCategory) => {
    try {
      const updated = await updateCategoryAction(category.id, {
        is_enabled: !category.is_enabled
      });
      setCategories(prev => 
        prev.map((c): NotificationCategory => c.id === category.id ? updated : c)
      );
      
      // If this is the currently expanded category, update its reference
      if (category.id === currentCategory?.id) {
        setCurrentCategory(updated);
      }

      // If disabling the category, also disable all subtypes
      if (!updated.is_enabled && category.id === expandedCategory) {
        const updatedSubtypes = await Promise.all(
          subtypes.map(async (subtype): Promise<NotificationSubtype> => {
            if (subtype.is_enabled) {
              const updated = await updateSubtypeAction(subtype.id, {
                is_enabled: false
              });
              return updated;
            }
            return subtype;
          })
        );
        setSubtypes(updatedSubtypes);
      }
    } catch (error) {
      console.error("Failed to update category:", error);
    }
  };

  const handleToggleSubtype = async (subtype: NotificationSubtype) => {
    // Don't allow toggling if category is disabled
    if (!currentCategory?.is_enabled) return;

    try {
      const updated = await updateSubtypeAction(subtype.id, {
        is_enabled: !subtype.is_enabled
      });
      setSubtypes(prev =>
        prev.map((s): NotificationSubtype => s.id === subtype.id ? updated : s)
      );
    } catch (error) {
      console.error("Failed to update subtype:", error);
    }
  };

  const handleExpandCategory = async (category: NotificationCategory) => {
    if (expandedCategory === category.id) {
      setExpandedCategory(null);
      setSubtypes([]);
      setCurrentCategory(null);
      return;
    }

    try {
      const { subtypes } = await getCategoryWithSubtypesAction(category.id);
      setSubtypes(subtypes);
      setExpandedCategory(category.id);
      setCurrentCategory(category);
    } catch (error) {
      console.error("Failed to load subtypes:", error);
    }
  };

  const categoryColumns: ColumnDefinition<NotificationCategory>[] = [
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
          onCheckedChange={() => handleToggleCategory(record)}
        />
      )
    },
    {
      title: "Actions",
      dataIndex: "id",
      render: (value, record): React.ReactNode => (
        <Button
          id={`category-${record.id}`}
          onClick={() => handleExpandCategory(record)}
          variant="outline"
        >
          {expandedCategory === record.id ? "Hide Subtypes" : "Show Subtypes"}
        </Button>
      )
    }
  ];

  const subtypeColumns: ColumnDefinition<NotificationSubtype>[] = [
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
      render: (value, record) => (
        <div className="flex flex-col">
          <Switch
            checked={value}
            onCheckedChange={() => handleToggleSubtype(record)}
            disabled={!currentCategory?.is_enabled}
          />
          {!currentCategory?.is_enabled && (
            <span className="text-xs text-gray-500 mt-1">
              Enable the category first
            </span>
          )}
        </div>
      )
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Notification Categories</h2>
      </div>

      <Card className="p-6">
        <DataTable
          data={categories}
          columns={categoryColumns}
          pagination={true}
          pageSize={10}
        />
      </Card>

      {expandedCategory && (
        <Card className="p-6">
          <div className="mb-4">
            <h3 className="text-md font-semibold">Subtypes</h3>
            {!currentCategory?.is_enabled && (
              <p className="text-sm text-gray-500 mt-1">
                These notification subtypes are currently disabled because their parent category is disabled.
              </p>
            )}
          </div>
          <DataTable
            data={subtypes}
            columns={subtypeColumns}
            pagination={true}
            pageSize={5}
          />
        </Card>
      )}
    </div>
  );
}
