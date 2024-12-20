import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { DataTable } from "@/components/ui/DataTable";
import { ColumnDefinition } from "@/interfaces/dataTable.interfaces";
import { 
  getCategoriesAction,
  getCategoryWithSubtypesAction,
  updateCategoryAction 
} from "@/lib/actions/notification-actions/notificationActions";
import { 
  NotificationCategory,
  NotificationSubtype 
} from "@/lib/models/notification";

export async function NotificationCategories() {
  const categories = await getCategoriesAction("default"); // TODO: Get tenant from context
  return <NotificationCategoriesContent categories={categories} />;
}

function NotificationCategoriesContent({
  categories: initialCategories
}: {
  categories: NotificationCategory[];
}) {
  const [categories, setCategories] = useState(initialCategories);
  const [expandedCategory, setExpandedCategory] = useState<number | null>(null);
  const [subtypes, setSubtypes] = useState<NotificationSubtype[]>([]);

  const handleToggleCategory = async (category: NotificationCategory) => {
    try {
      const updated = await updateCategoryAction("default", category.id, {
        is_enabled: !category.is_enabled
      });
      setCategories(prev => 
        prev.map(c => c.id === category.id ? updated : c)
      );
    } catch (error) {
      console.error("Failed to update category:", error);
    }
  };

  const handleExpandCategory = async (categoryId: number) => {
    if (expandedCategory === categoryId) {
      setExpandedCategory(null);
      setSubtypes([]);
      return;
    }

    try {
      const { subtypes } = await getCategoryWithSubtypesAction("default", categoryId);
      setSubtypes(subtypes);
      setExpandedCategory(categoryId);
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
      render: (value) => value || "-"
    },
    { 
      title: "Enabled",
      dataIndex: "is_enabled",
      render: (value, record) => (
        <Switch
          checked={value}
          onCheckedChange={() => handleToggleCategory(record)}
        />
      )
    },
    { 
      title: "Default Enabled",
      dataIndex: "is_default_enabled",
      render: (value) => value ? "Yes" : "No"
    },
    {
      title: "Actions",
      dataIndex: "id",
      render: (value, record) => (
        <Button 
          onClick={() => handleExpandCategory(record.id)}
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
      render: (value) => value || "-"
    },
    { 
      title: "Enabled",
      dataIndex: "is_enabled",
      render: (value) => value ? "Yes" : "No"
    },
    { 
      title: "Default Enabled",
      dataIndex: "is_default_enabled",
      render: (value) => value ? "Yes" : "No"
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
          <h3 className="text-md font-semibold mb-4">Subtypes</h3>
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
