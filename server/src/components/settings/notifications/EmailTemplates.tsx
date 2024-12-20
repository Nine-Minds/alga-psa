import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { TextArea } from "@/components/ui/TextArea";
import { Switch } from "@/components/ui/Switch";
import { DataTable } from "@/components/ui/DataTable";
import { ColumnDefinition } from "@/interfaces/dataTable.interfaces";
import { 
  getTemplatesAction,
  createTenantTemplateAction,
  updateTenantTemplateAction 
} from "@/lib/actions/notification-actions/notificationActions";
import { 
  SystemEmailTemplate,
  TenantEmailTemplate 
} from "@/lib/models/notification";

export async function EmailTemplates() {
  const { systemTemplates, tenantTemplates } = await getTemplatesAction("default"); // TODO: Get tenant from context
  return <EmailTemplatesContent 
    systemTemplates={systemTemplates} 
    tenantTemplates={tenantTemplates} 
  />;
}

type TemplateType = (SystemEmailTemplate | TenantEmailTemplate) & { type: "system" | "tenant" };

function EmailTemplatesContent({
  systemTemplates,
  tenantTemplates
}: {
  systemTemplates: SystemEmailTemplate[];
  tenantTemplates: TenantEmailTemplate[];
}) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TenantEmailTemplate | null>(null);

  const handleCreateTemplate = () => {
    setEditingTemplate(null);
    setIsDialogOpen(true);
  };

  const handleEditTemplate = (template: TenantEmailTemplate) => {
    setEditingTemplate(template);
    setIsDialogOpen(true);
  };

  const columns: ColumnDefinition<TemplateType>[] = [
    { 
      title: "Name",
      dataIndex: "name"
    },
    { 
      title: "Subject",
      dataIndex: "subject"
    },
    { 
      title: "Version",
      dataIndex: "version"
    },
    { 
      title: "Type",
      dataIndex: "type",
      render: (value) => value === "tenant" ? "Tenant" : "System"
    },
    { 
      title: "Active",
      dataIndex: "is_active",
      render: (value) => value ? "Yes" : "No"
    },
    { 
      title: "Actions",
      dataIndex: "type",
      render: (value, record) => value === "tenant" ? (
        <Button onClick={() => handleEditTemplate(record as TenantEmailTemplate)}>
          Edit
        </Button>
      ) : null
    }
  ];

  // Combine system and tenant templates, marking tenant overrides
  const templates: TemplateType[] = [
    ...systemTemplates.map(t => ({ ...t, type: "system" as const })),
    ...tenantTemplates.map(t => ({ ...t, type: "tenant" as const }))
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Email Templates</h2>
        <Button onClick={handleCreateTemplate}>
          Create Template
        </Button>
      </div>

      <Card className="p-6">
        <DataTable
          data={templates}
          columns={columns}
          pagination={true}
          pageSize={10}
        />
      </Card>

      <TemplateDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        template={editingTemplate}
        systemTemplates={systemTemplates}
      />
    </div>
  );
}

function TemplateDialog({
  isOpen,
  onClose,
  template,
  systemTemplates
}: {
  isOpen: boolean;
  onClose: () => void;
  template: TenantEmailTemplate | null;
  systemTemplates: SystemEmailTemplate[];
}) {
  const [formData, setFormData] = useState<Partial<TenantEmailTemplate>>(
    template ?? {
      name: "",
      subject: "",
      html_content: "",
      text_content: "",
      is_active: true
    }
  );
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      if (template) {
        await updateTenantTemplateAction("default", template.id, formData);
      } else {
        await createTenantTemplateAction("default", formData as Omit<TenantEmailTemplate, "id" | "created_at" | "updated_at">);
      }
      onClose();
    } catch (error) {
      console.error("Failed to save template:", error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <DialogTitle>{template ? "Edit Template" : "Create Template"}</DialogTitle>
        
        <DialogContent className="space-y-4">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              required
            />
          </div>

          <div>
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              value={formData.subject}
              onChange={(e) => setFormData(prev => ({ ...prev, subject: e.target.value }))}
              required
            />
          </div>

          <div>
            <Label htmlFor="html-content">HTML Content</Label>
            <TextArea
              id="html-content"
              value={formData.html_content}
              onChange={(e) => setFormData(prev => ({ ...prev, html_content: e.target.value }))}
              required
              rows={10}
            />
          </div>

          <div>
            <Label htmlFor="text-content">Text Content</Label>
            <TextArea
              id="text-content"
              value={formData.text_content}
              onChange={(e) => setFormData(prev => ({ ...prev, text_content: e.target.value }))}
              required
              rows={10}
            />
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="is-active"
              checked={formData.is_active}
              onCheckedChange={(checked) => 
                setFormData(prev => ({ ...prev, is_active: checked }))
              }
            />
            <Label htmlFor="is-active">Active</Label>
          </div>
        </DialogContent>

        <DialogFooter>
          <Button type="button" onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button type="submit" disabled={isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
