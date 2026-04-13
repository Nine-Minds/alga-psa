'use client';


import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@alga-psa/ui/components/Button";
import { Dialog, DialogContent, DialogTitle } from "@alga-psa/ui/components/Dialog";
import { Input } from "@alga-psa/ui/components/Input";
import { Label } from "@alga-psa/ui/components/Label";
import { TextArea } from "@alga-psa/ui/components/TextArea";
import { DataTable } from "@alga-psa/ui/components/DataTable";
import { ColumnDefinition } from "@alga-psa/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@alga-psa/ui/components/Tabs";
import { ChevronDown, ChevronRight, CornerDownRight, MoreVertical, Filter, Check, XCircle, Send } from "lucide-react";
import { useUserPreference } from "@alga-psa/user-composition/hooks";
import {
  getTemplatesAction,
  updateTenantTemplateAction,
  cloneSystemTemplateAction,
  deactivateTenantTemplateAction,
  sendTestEmailAction
} from "../../actions";
import {
  SystemEmailTemplate,
  TenantEmailTemplate
} from "../../types/notification";
import { getSampleDataForPreview } from "../../lib/templateSampleData";
import LoadingIndicator from "@alga-psa/ui/components/LoadingIndicator";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@alga-psa/ui/components/DropdownMenu";

// Language names mapping (shared across component)
const LANGUAGE_NAMES: Record<string, string> = {
  'en': 'English',
  'fr': 'French',
  'es': 'Spanish',
  'de': 'German',
  'nl': 'Dutch',
  'it': 'Italian',
  'pl': 'Polish'
};

// Row types for flat list
interface CategoryRow {
  id: string;
  type: 'category';
  name: string;
  templateCount: number;
}

interface TemplateRow {
  id: string;
  type: 'template';
  name: string;
  displayName: string;
  category: string;
  systemTemplate: SystemEmailTemplate;
  tenantTemplate?: TenantEmailTemplate;
  activeTemplate: SystemEmailTemplate | TenantEmailTemplate;
  isCustom: boolean;
  language: string;
  subject: string;
}

type EmailTemplateRow = CategoryRow | TemplateRow;

/**
 * Replace {{variable}} placeholders in content with sample data values.
 * Supports both simple ({{name}}) and dotted ({{user.name}}) variables.
 */
export function replaceTemplateVariables(
  content: string,
  data: Record<string, string>
): string {
  // First, process {{#if condition}}...{{/if}} blocks.
  // For preview, show the block content (with variables replaced) since sample data is available.
  let result = content.replace(
    /\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, _condition, blockContent) => blockContent
  );

  // Then replace simple {{variable}} placeholders
  result = result.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const trimmedKey = key.trim();
    return trimmedKey in data ? data[trimmedKey] : match;
  });

  return result;
}

/**
 * Renders HTML content in a sandboxed iframe for email template preview.
 */
function EmailTemplatePreview({
  htmlContent,
  templateName,
  subject,
}: {
  htmlContent: string;
  templateName: string;
  subject?: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const sampleData = useMemo(
    () => getSampleDataForPreview(templateName, htmlContent, subject),
    [templateName, htmlContent, subject]
  );

  const renderedHtml = useMemo(
    () => replaceTemplateVariables(htmlContent, sampleData),
    [htmlContent, sampleData]
  );

  const renderedSubject = useMemo(
    () => subject ? replaceTemplateVariables(subject, sampleData) : undefined,
    [subject, sampleData]
  );

  // Auto-resize iframe to content height
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      try {
        const doc = iframe.contentDocument;
        if (doc?.body) {
          iframe.style.height = `${doc.body.scrollHeight + 20}px`;
        }
      } catch {
        // sandbox may restrict access
      }
    };

    iframe.addEventListener('load', handleLoad);
    return () => iframe.removeEventListener('load', handleLoad);
  }, [renderedHtml]);

  return (
    <div className="space-y-2">
      {renderedSubject && (
        <div>
          <Label className="text-xs text-gray-500">Subject Preview</Label>
          <div className="p-2 bg-gray-50 rounded border text-sm">
            {renderedSubject}
          </div>
        </div>
      )}
      <div className="border rounded overflow-hidden">
        <iframe
          ref={iframeRef}
          srcDoc={renderedHtml}
          sandbox="allow-same-origin"
          title="Email template preview"
          className="w-full min-h-[200px] bg-white"
          style={{ border: 'none' }}
        />
      </div>
      <p className="text-xs text-gray-400">
        Preview uses sample data. Actual emails will contain real values.
      </p>
    </div>
  );
}

export function EmailTemplates() {
  const { data: session } = useSession();
  const [templates, setTemplates] = useState<{
    systemTemplates: (SystemEmailTemplate & { category: string })[];
    tenantTemplates: TenantEmailTemplate[];
  } | null>(null);
  const [tenant, setTenant] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCloning, setIsCloning] = useState(false);
  const [viewingTemplate, setViewingTemplate] = useState<SystemEmailTemplate | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<TenantEmailTemplate | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // Language filter state - empty means show all languages
  const [selectedLanguages, setSelectedLanguages] = useState<Set<string>>(new Set());

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);

  const {
    value: pageSize,
    setValue: setPageSize
  } = useUserPreference<number>('email_templates_page_size', {
    defaultValue: 10,
    localStorageKey: 'email_templates_page_size',
  });

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  // Adjust page if current page is out of bounds after data changes (e.g., filtering)
  // Only adjust when filters change, not when expanding/collapsing categories
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedLanguages.size]);

  // Get available languages from templates
  const availableLanguages = useMemo(() => {
    if (!templates) return [];
    const languageCodes = new Set<string>();
    templates.systemTemplates.forEach(t => languageCodes.add(t.language_code));
    templates.tenantTemplates.forEach(t => languageCodes.add(t.language_code));
    return Array.from(languageCodes).sort();
  }, [templates]);

  // Toggle language in filter
  const handleToggleLanguage = useCallback((languageCode: string) => {
    setSelectedLanguages(prev => {
      const next = new Set(prev);
      if (next.has(languageCode)) {
        next.delete(languageCode);
      } else {
        next.add(languageCode);
      }
      return next;
    });
  }, []);

  // Clear all language filters
  const handleClearLanguageFilters = useCallback(() => {
    setSelectedLanguages(new Set());
  }, []);

  useEffect(() => {
    async function init() {
      try {
        const currentTenant = (session?.user as any)?.tenant as string | undefined;
        if (!currentTenant) return;
        setTenant(currentTenant);
        const currentTemplates = await getTemplatesAction(currentTenant);
        setTemplates(currentTemplates);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load templates');
      }
    }
    init();
  }, [session]);

  const handleToggleExpand = useCallback((category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  const handleCreateCustom = async (template: SystemEmailTemplate) => {
    if (!tenant) {
      console.error("No tenant found");
      return;
    }

    try {
      setIsCloning(true);
      await cloneSystemTemplateAction(tenant, template.id);

      // Refresh templates
      const currentTemplates = await getTemplatesAction(tenant);
      setTemplates(currentTemplates);
    } catch (error) {
      console.error("Failed to create custom template:", error);
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

  // Helper to format template names for display
  function formatTemplateName(name: string): string {
    return name
      .split('-')
      .map((word): string => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  // Group templates by category (filtered by selected languages)
  const templatesByCategory = templates.systemTemplates.reduce((acc, systemTemplate) => {
    const tenantTemplate = templates.tenantTemplates.find(
      t => t.name === systemTemplate.name && t.language_code === systemTemplate.language_code
    );
    const activeTemplate = tenantTemplate || systemTemplate;

    // Apply language filter - if no languages selected, show all
    if (selectedLanguages.size > 0 && !selectedLanguages.has(activeTemplate.language_code)) {
      return acc;
    }

    const category = systemTemplate.category;
    if (!acc[category]) {
      acc[category] = [];
    }

    acc[category].push({
      systemTemplate,
      tenantTemplate,
      activeTemplate,
    });

    return acc;
  }, {} as Record<string, Array<{
    systemTemplate: SystemEmailTemplate & { category: string };
    tenantTemplate?: TenantEmailTemplate;
    activeTemplate: SystemEmailTemplate | TenantEmailTemplate;
  }>>);

  // Build flat list with categories and templates
  const buildFlatList = (): EmailTemplateRow[] => {
    const rows: EmailTemplateRow[] = [];
    const categories = Object.keys(templatesByCategory).sort();

    categories.forEach(category => {
      const categoryTemplates = templatesByCategory[category];

      // Add category row
      rows.push({
        id: `cat_${category}`,
        type: 'category',
        name: category,
        templateCount: categoryTemplates.length,
      });

      // Add templates if expanded
      if (expandedCategories.has(category)) {
        categoryTemplates.forEach(({ systemTemplate, tenantTemplate, activeTemplate }) => {
          rows.push({
            id: `tpl_${systemTemplate.id}`,
            type: 'template',
            name: systemTemplate.name,
            displayName: formatTemplateName(systemTemplate.name),
            category,
            systemTemplate,
            tenantTemplate,
            activeTemplate,
            isCustom: !!tenantTemplate,
            language: LANGUAGE_NAMES[activeTemplate.language_code] || activeTemplate.language_code.toUpperCase(),
            subject: activeTemplate.subject,
          });
        });
      }
    });

    return rows;
  };

  const flatList = buildFlatList();

  const columns: ColumnDefinition<EmailTemplateRow>[] = [
    {
      title: 'Name',
      dataIndex: 'name',
      render: (value: string, record: EmailTemplateRow) => {
        if (record.type === 'category') {
          const isExpanded = expandedCategories.has(record.name);
          return (
            <div
              className="flex items-center"
              id={`expand-template-category-${record.name}`}
            >
              <div className="p-1 mr-2">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </div>
              <span className="font-semibold text-gray-700">
                {value}
              </span>
              <span className="ml-2 text-sm text-gray-500">
                ({(record as CategoryRow).templateCount} templates)
              </span>
            </div>
          );
        } else {
          const tplRecord = record as TemplateRow;
          return (
            <div className="flex items-center pl-8">
              <CornerDownRight className="h-3 w-3 text-muted-foreground mr-2" />
              <div>
                <span className="font-medium text-gray-700">{tplRecord.displayName}</span>
                <div className="text-xs text-gray-500">
                  {tplRecord.isCustom ? 'Using custom template' : 'Using standard template'}
                </div>
              </div>
            </div>
          );
        }
      },
    },
    {
      title: 'Language',
      dataIndex: 'language',
      width: '100px',
      render: (value: string, record: EmailTemplateRow) => {
        if (record.type === 'category') return null;
        return <span className="text-sm">{(record as TemplateRow).language}</span>;
      },
    },
    {
      title: 'Subject',
      dataIndex: 'subject',
      render: (value: string, record: EmailTemplateRow) => {
        if (record.type === 'category') return null;
        return <span className="text-sm text-gray-600 break-words">{(record as TemplateRow).subject}</span>;
      },
    },
    {
      title: 'Actions',
      dataIndex: 'id',
      width: '15%',
      render: (value: string, record: EmailTemplateRow) => {
        if (record.type === 'category') {
          return (
            <div onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button id={`category-${value}-actions`} variant="ghost" className="h-8 w-8 p-0">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    id={`expand-all-${value}`}
                    onClick={() => handleToggleExpand(record.name)}
                  >
                    {expandedCategories.has(record.name) ? 'Collapse' : 'Expand'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        }

        const tplRecord = record as TemplateRow;
        if (tplRecord.isCustom) {
          return (
            <div className="flex space-x-2" onClick={(e) => e.stopPropagation()}>
              <Button
                id={`edit-template-${tplRecord.systemTemplate.id}`}
                size="sm"
                onClick={() => setEditingTemplate(tplRecord.tenantTemplate!)}
              >
                Edit
              </Button>
              <Button
                id={`use-standard-${tplRecord.systemTemplate.id}`}
                variant="outline"
                size="sm"
                onClick={() => handleUseStandard(tplRecord.systemTemplate.name)}
              >
                Use Standard
              </Button>
            </div>
          );
        } else {
          return (
            <div className="flex space-x-2" onClick={(e) => e.stopPropagation()}>
              <Button
                id={`view-template-${tplRecord.systemTemplate.id}`}
                variant="outline"
                size="sm"
                onClick={() => setViewingTemplate(tplRecord.systemTemplate)}
              >
                View
              </Button>
              <Button
                id={`customize-template-${tplRecord.systemTemplate.id}`}
                variant="outline"
                size="sm"
                onClick={() => handleCreateCustom(tplRecord.systemTemplate)}
                disabled={isCloning}
              >
                Customize
              </Button>
            </div>
          );
        }
      },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <p className="text-sm text-gray-600">
          Each event type has a standard template that can be customized.
          You can either use the standard template or create a custom version.
        </p>

        {/* Language Filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id="language-filter-btn"
              variant="outline"
              size="sm"
              className="ml-4 flex items-center gap-2 whitespace-nowrap"
            >
              <Filter className="h-4 w-4" />
              Languages
              {selectedLanguages.size > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-xs bg-primary-100 text-primary-700 rounded-full">
                  {selectedLanguages.size}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {availableLanguages.map(langCode => (
              <DropdownMenuItem
                key={langCode}
                id={`filter-language-${langCode}`}
                onClick={(e) => {
                  e.preventDefault();
                  handleToggleLanguage(langCode);
                }}
                className="flex items-center justify-between cursor-pointer"
              >
                <span>{LANGUAGE_NAMES[langCode] || langCode.toUpperCase()}</span>
                {selectedLanguages.has(langCode) && (
                  <Check className="h-4 w-4 text-primary-600" />
                )}
              </DropdownMenuItem>
            ))}
            {selectedLanguages.size > 0 && (
              <>
                <div className="border-t border-gray-200 my-1" />
                <DropdownMenuItem
                  id="clear-language-filter"
                  onClick={(e) => {
                    e.preventDefault();
                    handleClearLanguageFilters();
                  }}
                  className="flex items-center gap-2 text-gray-600 cursor-pointer"
                >
                  <XCircle className="h-4 w-4" />
                  Reset
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <DataTable
        id="email-templates-table"
        data={flatList}
        columns={columns}
        pagination={true}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        pageSize={pageSize}
        onItemsPerPageChange={handlePageSizeChange}
        onRowClick={(row: EmailTemplateRow) => {
          // Only expand/collapse for category rows
          if (row.type === 'category') {
            handleToggleExpand(row.name);
          }
        }}
      />

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
  onClose,
}: {
  template: SystemEmailTemplate | null;
  onClose: () => void;
}) {
  const [htmlTab, setHtmlTab] = useState<string>('preview');
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Reset tab and test result when dialog opens
  useEffect(() => {
    if (template) {
      setHtmlTab('preview');
      setTestResult(null);
    }
  }, [template]);

  const handleSendTest = async () => {
    if (!template) return;
    setSendingTest(true);
    setTestResult(null);
    try {
      const result = await sendTestEmailAction(template.id, 'system');
      if (result.success) {
        setTestResult({ success: true, message: `Test email sent to ${result.sentTo}` });
      } else {
        setTestResult({ success: false, message: result.error || 'Failed to send test email.' });
      }
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : 'Failed to send test email.' });
    } finally {
      setSendingTest(false);
    }
  };

  if (!template) return null;

  const footer = (
    <div className="flex justify-end space-x-2">
      <Button
        id="send-test-email-view-btn"
        type="button"
        variant="outline"
        onClick={handleSendTest}
        disabled={sendingTest}
        className="mr-auto flex items-center gap-2"
      >
        <Send className="h-4 w-4" />
        {sendingTest ? "Sending..." : "Send Test Email"}
      </Button>
      <Button id="close-view-dialog-btn" type="button" onClick={onClose}>
        Close
      </Button>
    </div>
  );

  return (
    <Dialog isOpen={!!template} onClose={onClose} footer={footer}>
      <DialogTitle>Standard Template: {formatTemplateName(template.name)}</DialogTitle>

      <DialogContent className="space-y-4 px-6">
        <div>
          <Label>Language</Label>
          <div className="p-2 bg-gray-50 rounded border">
            {LANGUAGE_NAMES[template.language_code] || template.language_code.toUpperCase()}
          </div>
        </div>

        <div>
          <Label>Subject</Label>
          <div className="p-2 bg-gray-50 rounded border">{template.subject}</div>
        </div>

        <div>
          <Label>HTML Content</Label>
          <Tabs value={htmlTab} onValueChange={setHtmlTab}>
            <TabsList>
              <TabsTrigger value="source">Source</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
            </TabsList>
            <TabsContent value="source">
              <div className="p-2 bg-gray-50 rounded border whitespace-pre-wrap font-mono text-sm max-h-48 overflow-y-auto mt-2">
                {template.html_content}
              </div>
            </TabsContent>
            <TabsContent value="preview">
              <div className="mt-2">
                <EmailTemplatePreview
                  htmlContent={template.html_content}
                  templateName={template.name}
                  subject={template.subject}
                />
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {htmlTab !== 'preview' && (
          <div>
            <Label>Text Content</Label>
            <div className="p-2 bg-gray-50 rounded border whitespace-pre-wrap font-mono text-sm max-h-48 overflow-y-auto">
              {template.text_content}
            </div>
          </div>
        )}

        {testResult && (
          <div className={`p-3 rounded text-sm ${testResult.success ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {testResult.message}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditTemplateDialog({
  isOpen,
  onClose,
  template,
  tenant,
  onTemplatesChange,
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
  const [htmlTab, setHtmlTab] = useState<string>('source');
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

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
      setHtmlTab('source');
      setTestResult(null);
    }
  }, [template]);
  const [isSaving, setIsSaving] = useState(false);

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

  const handleSendTest = async () => {
    if (!template) return;
    setSendingTest(true);
    setTestResult(null);
    try {
      // Send the current draft content (not the saved version)
      const result = await sendTestEmailAction(template.id, 'tenant', {
        subject: formData.subject,
        html_content: formData.html_content,
        text_content: formData.text_content,
      });
      if (result.success) {
        setTestResult({ success: true, message: `Test email sent to ${result.sentTo}` });
      } else {
        setTestResult({ success: false, message: result.error || 'Failed to send test email.' });
      }
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : 'Failed to send test email.' });
    } finally {
      setSendingTest(false);
    }
  };

  const footer = (
    <div className="flex justify-end space-x-2">
      <Button
        id="send-test-email-edit-btn"
        type="button"
        variant="outline"
        onClick={handleSendTest}
        disabled={sendingTest}
        className="mr-auto flex items-center gap-2"
      >
        <Send className="h-4 w-4" />
        {sendingTest ? "Sending..." : "Send Test Email"}
      </Button>
      <Button id="cancel-edit-dialog-btn" type="button" onClick={onClose} variant="outline">
        Cancel
      </Button>
      <Button
        id="save-template-btn"
        type="button"
        disabled={isSaving}
        onClick={() => (document.getElementById('edit-template-form') as HTMLFormElement | null)?.requestSubmit()}
      >
        {isSaving ? "Saving..." : "Save"}
      </Button>
    </div>
  );

  return (
    <Dialog isOpen={isOpen} onClose={onClose} footer={footer}>
      <form id="edit-template-form" onSubmit={handleSubmit}>
        <DialogTitle>Edit Custom Template: {formatTemplateName(template?.name ?? '')}</DialogTitle>

        <DialogContent className="space-y-4 px-6">
          <div>
            <Label>Language</Label>
            <div className="p-2 bg-gray-50 rounded border text-gray-700">
              {formData.language_code ? (LANGUAGE_NAMES[formData.language_code] || formData.language_code.toUpperCase()) : 'N/A'}
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
            <Tabs value={htmlTab} onValueChange={setHtmlTab}>
              <TabsList>
                <TabsTrigger value="source">Source</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
              </TabsList>
              <TabsContent value="source">
                <TextArea
                  id="html-content"
                  value={formData.html_content}
                  onChange={(e) => setFormData(prev => ({ ...prev, html_content: e.target.value }))}
                  required
                  rows={10}
                  className="mt-2"
                />
              </TabsContent>
              <TabsContent value="preview">
                <div className="mt-2">
                  <EmailTemplatePreview
                    htmlContent={formData.html_content ?? ''}
                    templateName={template?.name ?? ''}
                    subject={formData.subject}
                  />
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {htmlTab !== 'preview' && (
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
          )}

          {testResult && (
            <div className={`p-3 rounded text-sm ${testResult.success ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
              {testResult.message}
            </div>
          )}
        </DialogContent>
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
