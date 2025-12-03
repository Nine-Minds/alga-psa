'use client';

import { useState, useEffect } from "react";
import { Card } from "server/src/components/ui/Card";
import { Button } from "server/src/components/ui/Button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "server/src/components/ui/Dialog";
import { Input } from "server/src/components/ui/Input";
import { Label } from "server/src/components/ui/Label";
import { TextArea } from "server/src/components/ui/TextArea";
import { DataTable } from "server/src/components/ui/DataTable";
import { ColumnDefinition } from "server/src/interfaces/dataTable.interfaces";
import { 
  getTemplatesAction,
  updateTenantTemplateAction,
  cloneSystemTemplateAction,
  deactivateTenantTemplateAction
} from "server/src/lib/actions/notification-actions/notificationActions";
import { 
  SystemEmailTemplate,
  TenantEmailTemplate 
} from "server/src/lib/models/notification";
import { getCurrentTenant } from "server/src/lib/tenant-client";
import LoadingIndicator from "server/src/components/ui/LoadingIndicator";

export function EmailTemplates() {
  const [templates, setTemplates] = useState<{
    systemTemplates: (SystemEmailTemplate & { category: string })[];
    tenantTemplates: TenantEmailTemplate[];
  } | null>(null);
  const [tenant, setTenant] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCloning, setIsCloning] = useState(false);
  const [viewingTemplate, setViewingTemplate] = useState<SystemEmailTemplate | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<TenantEmailTemplate | null>(null);

  // Separate pagination state for each category
  const [paginationState, setPaginationState] = useState<Record<string, { currentPage: number; pageSize: number }>>({});

  const getCurrentPage = (category: string) => {
    return paginationState[category]?.currentPage ?? 1;
  };

  const getPageSize = (category: string) => {
    return paginationState[category]?.pageSize ?? 10;
  };

  const handlePageChange = (category: string, newPage: number) => {
    setPaginationState(prev => {
      const currentState = prev[category] ?? { currentPage: 1, pageSize: 10 };
      return {
        ...prev,
        [category]: {
          currentPage: newPage,
          pageSize: currentState.pageSize
        }
      };
    });
  };

  const handlePageSizeChange = (category: string, newPageSize: number) => {
    setPaginationState(prev => ({
      ...prev,
      [category]: { currentPage: 1, pageSize: newPageSize }
    }));
  };

  useEffect(() => {
    async function init() {
      try {
        const currentTenant = await getCurrentTenant();
        setTenant(currentTenant);
        const currentTemplates = await getTemplatesAction(currentTenant);
        setTemplates(currentTemplates);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load templates');
      }
    }
    init();
  }, []);

  const handleCreateCustom = async (template: SystemEmailTemplate) => {
    if (!tenant) {
      console.error("No tenant found");
      return;
    }
    
    try {
      setIsCloning(true);
      console.log("Cloning template:", template.id);
      const cloned = await cloneSystemTemplateAction(tenant, template.id);
      console.log("Cloned template:", cloned);
      
      // Refresh templates
      const currentTemplates = await getTemplatesAction(tenant);
      console.log("Updated templates:", currentTemplates);
      setTemplates(currentTemplates);
    } catch (error) {
      console.error("Failed to create custom template:", error);
      if (error instanceof Error) {
        console.error("Error details:", error.message, error.stack);
      }
    } finally {
      setIsCloning(false);
    }
  };

  const handleUseStandard = async (name: string) => {
    if (!tenant) return;
    try {
      await deactivateTenantTemplateAction(tenant, name);
      // Refresh templates
      const currentTemplates = await getTemplatesAction(tenant);
      setTemplates(currentTemplates);
    } catch (error) {
      console.error("Failed to switch to standard template:", error);
    }
  };

  if (error) {
    return <div className="text-red-500">{error}</div>;
  }

  if (!templates || !tenant) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingIndicator 
          layout="stacked" 
          text="Loading email templates..."
          spinnerProps={{ size: 'md' }}
        />
      </div>
    );
  }

  // Group templates by category and name
  const templateGroups = templates.systemTemplates.reduce((acc: Record<string, Array<{
    name: string;
    systemTemplate: SystemEmailTemplate;
    tenantTemplate?: TenantEmailTemplate;
    activeTemplate: SystemEmailTemplate | TenantEmailTemplate;
    category: string;
  }>>, systemTemplate) => {
    const tenantTemplate = templates.tenantTemplates.find(
      t => t.name === systemTemplate.name
    );
    
    const category = systemTemplate.category;
    
    if (!acc[category]) {
      acc[category] = [];
    }
    
    acc[category].push({
      name: formatTemplateName(systemTemplate.name),
      systemTemplate,
      tenantTemplate,
      activeTemplate: tenantTemplate ? tenantTemplate : systemTemplate,
      category
    });
    
    return acc;
  }, {} as Record<string, Array<{
    name: string;
    systemTemplate: SystemEmailTemplate;
    tenantTemplate?: TenantEmailTemplate;
    activeTemplate: SystemEmailTemplate | TenantEmailTemplate;
    category: string;
  }>>);

  // Helper to format template names for display
  function formatTemplateName(name: string): string {
    return name
      .split('-')
      .map((word): string => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  const columns: ColumnDefinition<typeof templateGroups[string][number]>[] = [
    {
      title: "Event Type",
      dataIndex: "name" as any,
      sortable: true,
      render: (_, record): JSX.Element => (
        <div>
          <div className="font-medium">{record.name}</div>
          <div className="text-sm text-gray-500">
            {record.tenantTemplate
              ? "Using custom template"
              : "Using standard template"}
          </div>
        </div>
      )
    },
    {
      title: "Language",
      dataIndex: "activeTemplate.language_code" as any,
      sortable: true,
      render: (_, record): JSX.Element => {
        const languageCode = record.activeTemplate.language_code;
        const languageNames: Record<string, string> = {
          'en': 'English',
          'fr': 'French',
          'es': 'Spanish',
          'de': 'German',
          'nl': 'Dutch',
          'it': 'Italian'
        };
        return (
          <div className="text-sm">
            {languageNames[languageCode] || languageCode.toUpperCase()}
          </div>
        );
      }
    },
    {
      title: "Subject",
      dataIndex: "activeTemplate.subject" as any,
      sortable: true,
      render: (_, record): JSX.Element => (
        <div className="break-words">
          {record.activeTemplate.subject}
        </div>
      )
    },
    {
      title: "Template",
      dataIndex: "template",
      render: (_, record): JSX.Element => {
        if (record.tenantTemplate) {
          return (
            <div className="flex space-x-2">
              <Button id="edit-custom-template-btn" onClick={() => setEditingTemplate(record.tenantTemplate!)}>
                Edit Custom
              </Button>
              <Button
                id="switch-to-standard-btn"
                variant="outline"
                onClick={() => handleUseStandard(record.systemTemplate.name)}
              >
                Switch to Standard
              </Button>
            </div>
          );
        } else {
          return (
            <div className="flex space-x-2">
              <Button
                id="view-template-btn"
                variant="outline"
                onClick={() => setViewingTemplate(record.systemTemplate)}
              >
                View
              </Button>
              <Button
                id="customize-template-btn"
                variant="outline"
                onClick={() => handleCreateCustom(record.systemTemplate)}
                disabled={isCloning}
              >
                Customize
              </Button>
            </div>
          );
        }
      }
    }
  ];

  return (
    <div className="space-y-6">
      <div className="mb-4">
        <p className="text-sm text-gray-600 mt-2">
          Each event type has a standard template that can be customized. 
          You can either use the standard template or create a custom version.
        </p>
      </div>

      {Object.entries(templateGroups).map(([category, templates]): JSX.Element => (
        <Card key={category} className="p-6">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900">{category}</h3>
          </div>
          <div className="overflow-hidden">
            <style jsx>{`
              :global(table) {
                table-layout: fixed;
                width: 100%;
                border-collapse: separate;
                border-spacing: 0;
                border: 1px solid rgb(var(--color-border));
                border-radius: 0.5rem;
              }
              :global(th) {
                padding: 1rem;
                background-color: rgb(var(--color-background-100));
                font-weight: 600;
              }
              :global(td) {
                padding: 1rem;
                vertical-align: top;
              }
              :global(th:nth-child(1)) {
                width: 20%;
              }
              :global(th:nth-child(2)) {
                width: 10%;
              }
              :global(th:nth-child(3)) {
                width: 30%;
              }
              :global(th:nth-child(4)) {
                width: 40%;
              }
            `}</style>
            <DataTable
              key={`${category}-${getCurrentPage(category)}-${getPageSize(category)}`}
              id={`email-templates-table-${category}`}
              data={templates}
              columns={columns}
              pagination={true}
              currentPage={getCurrentPage(category)}
              onPageChange={(newPage) => handlePageChange(category, newPage)}
              pageSize={getPageSize(category)}
              onItemsPerPageChange={(newPageSize) => handlePageSizeChange(category, newPageSize)}
            />
          </div>
        </Card>
      ))}

      <ViewTemplateDialog
        template={viewingTemplate}
        onClose={() => setViewingTemplate(null)}
      />

      <EditTemplateDialog
        isOpen={!!editingTemplate}
        onClose={() => setEditingTemplate(null)}
        template={editingTemplate}
        tenant={tenant}
        onTemplatesChange={setTemplates}
      />
    </div>
  );
}

function ViewTemplateDialog({
  template,
  onClose
}: {
  template: SystemEmailTemplate | null;
  onClose: () => void;
}) {
  if (!template) return null;

  const languageNames: Record<string, string> = {
    'en': 'English',
    'fr': 'French',
    'es': 'Spanish',
    'de': 'German',
    'nl': 'Dutch',
    'it': 'Italian'
  };

  return (
    <Dialog isOpen={!!template} onClose={onClose}>
      <DialogTitle>Standard Template: {formatTemplateName(template.name)}</DialogTitle>

      <DialogContent className="space-y-4 max-h-[80vh] overflow-y-auto px-6">
        <div>
          <Label>Language</Label>
          <div className="p-2 bg-gray-50 rounded border">
            {languageNames[template.language_code] || template.language_code.toUpperCase()}
          </div>
        </div>

        <div>
          <Label>Subject</Label>
          <div className="p-2 bg-gray-50 rounded border">{template.subject}</div>
        </div>

        <div>
          <Label>HTML Content</Label>
          <div className="p-2 bg-gray-50 rounded border whitespace-pre-wrap font-mono text-sm">
            {template.html_content}
          </div>
        </div>

        <div>
          <Label>Text Content</Label>
          <div className="p-2 bg-gray-50 rounded border whitespace-pre-wrap font-mono text-sm">
            {template.text_content}
          </div>
        </div>
      </DialogContent>

      <DialogFooter>
          <Button id="close-view-dialog-btn" type="button" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function EditTemplateDialog({
  isOpen,
  onClose,
  template,
  tenant,
  onTemplatesChange
}: {
  isOpen: boolean;
  onClose: () => void;
  template: TenantEmailTemplate | null;
  tenant: string;
  onTemplatesChange: (templates: { systemTemplates: (SystemEmailTemplate & { category: string })[]; tenantTemplates: TenantEmailTemplate[] }) => void;
}) {
  const [formData, setFormData] = useState<Partial<TenantEmailTemplate>>({
    name: template?.name ?? "",
    subject: template?.subject ?? "",
    html_content: template?.html_content ?? "",
    text_content: template?.text_content ?? "",
    language_code: template?.language_code ?? "en"
  });

  // Update form data when template changes
  useEffect(() => {
    if (template) {
      setFormData({
        name: template.name,
        subject: template.subject,
        html_content: template.html_content,
        text_content: template.text_content,
        language_code: template.language_code
      });
    }
  }, [template]);
  const [isSaving, setIsSaving] = useState(false);

  const languageNames: Record<string, string> = {
    'en': 'English',
    'fr': 'French',
    'es': 'Spanish',
    'de': 'German',
    'nl': 'Dutch',
    'it': 'Italian'
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await updateTenantTemplateAction(tenant, template!.id, formData);
      // Refresh templates
      const currentTemplates = await getTemplatesAction(tenant);
      onTemplatesChange(currentTemplates);
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
        <DialogTitle>Edit Custom Template: {formatTemplateName(template?.name ?? '')}</DialogTitle>

        <DialogContent className="space-y-4 max-h-[80vh] overflow-y-auto px-6">
          <div>
            <Label>Language</Label>
            <div className="p-2 bg-gray-50 rounded border text-gray-700">
              {formData.language_code ? (languageNames[formData.language_code] || formData.language_code.toUpperCase()) : 'N/A'}
            </div>
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
        </DialogContent>

        <DialogFooter>
          <Button id="cancel-edit-dialog-btn" type="button" onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button id="save-template-btn" type="submit" disabled={isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function formatTemplateName(name: string): string {
    return name
      .split('-')
      .map((word): string => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
}
