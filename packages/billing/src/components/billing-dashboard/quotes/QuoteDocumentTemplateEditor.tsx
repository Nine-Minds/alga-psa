'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Editor } from '@monaco-editor/react';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { INVOICE_TEMPLATE_AST_VERSION, type IQuoteDocumentTemplate } from '@alga-psa/types';
import { getQuoteDocumentTemplate, saveQuoteDocumentTemplate } from '../../../actions/quoteDocumentTemplates';
import { QUOTE_TEMPLATE_COLLECTION_BINDINGS, QUOTE_TEMPLATE_VALUE_BINDINGS } from '../../../lib/quote-template-ast/bindings';
import { getStandardQuoteTemplateAstByCode } from '../../../lib/quote-template-ast/standardTemplates';

interface QuoteDocumentTemplateEditorProps {
  templateId: string | null;
  standardCode?: string | null;
}

const QuoteDocumentTemplateEditor: React.FC<QuoteDocumentTemplateEditorProps> = ({ templateId, standardCode }) => {
  const router = useRouter();
  const isNewTemplate = !templateId;
  const [template, setTemplate] = useState<Partial<IQuoteDocumentTemplate> | null>(null);
  const [astJson, setAstJson] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'code' | 'bindings'>('code');

  useEffect(() => {
    const loadTemplate = async () => {
      try {
        setIsLoading(true);
        setError(null);

        if (templateId) {
          const loadedResult = await getQuoteDocumentTemplate(templateId);
          if (loadedResult && typeof loadedResult === 'object' && 'permissionError' in loadedResult) {
            throw new Error(loadedResult.permissionError);
          }
          if (!loadedResult) {
            throw new Error('Quote document template not found.');
          }
          const loadedTemplate = loadedResult as IQuoteDocumentTemplate;
          setTemplate(loadedTemplate);
          setAstJson(JSON.stringify(loadedTemplate.templateAst ?? {}, null, 2));
          return;
        }

        const initialAst = getStandardQuoteTemplateAstByCode(standardCode || 'standard-quote-default')
          ?? getStandardQuoteTemplateAstByCode('standard-quote-default')
          ?? { kind: 'invoice-template-ast', version: INVOICE_TEMPLATE_AST_VERSION, layout: { id: 'root', type: 'document', children: [] } };
        const nextTemplate: Partial<IQuoteDocumentTemplate> = {
          name: '',
          version: 1,
          is_default: false,
          templateAst: initialAst,
        };
        setTemplate(nextTemplate);
        setAstJson(JSON.stringify(initialAst, null, 2));
      } catch (loadError) {
        console.error('Error loading quote template editor:', loadError);
        setError(loadError instanceof Error ? loadError.message : 'Failed to load quote template editor');
      } finally {
        setIsLoading(false);
      }
    };

    void loadTemplate();
  }, [standardCode, templateId]);

  const bindingEntries = useMemo(() => ([
    ...Object.entries(QUOTE_TEMPLATE_VALUE_BINDINGS).map(([key, value]) => ({ key, path: value.path, kind: 'Value' })),
    ...Object.entries(QUOTE_TEMPLATE_COLLECTION_BINDINGS).map(([key, value]) => ({ key, path: value.path, kind: 'Collection' })),
  ]), []);

  const handleSave = async () => {
    if (!template) {
      return;
    }

    try {
      setIsSaving(true);
      setError(null);

      let parsedAst: unknown;
      try {
        parsedAst = JSON.parse(astJson);
      } catch (parseError) {
        setError(`Invalid JSON: ${parseError instanceof SyntaxError ? parseError.message : 'Could not parse template AST'}`);
        setIsSaving(false);
        return;
      }

      const result = await saveQuoteDocumentTemplate({
        ...template,
        template_id: template.template_id,
        templateAst: parsedAst as any,
      });

      if (result && typeof result === 'object' && 'permissionError' in result) {
        throw new Error(result.permissionError);
      }

      const saveResult = result as { success: boolean; template?: IQuoteDocumentTemplate; error?: string };
      if (!saveResult.success || !saveResult.template) {
        throw new Error(saveResult.error || 'Failed to save quote template');
      }

      setTemplate(saveResult.template);
      router.push(`/msp/quote-document-templates?templateId=${saveResult.template.template_id}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save quote template');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{isNewTemplate ? 'New Quote Document Template' : 'Edit Quote Document Template'}</h1>
          <p className="text-sm text-muted-foreground">Edit the quote document AST and use quote-specific bindings for optional items, phases, totals, and validity messaging.</p>
        </div>
        <div className="flex gap-2">
          <Button id="quote-template-editor-back" variant="outline" onClick={() => router.push('/msp/quote-document-templates')}>
            Back to Templates
          </Button>
          <Button id="quote-template-editor-save" onClick={() => void handleSave()} disabled={isSaving || isLoading}>
            Save Template
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Quote Template Editor</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Template Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
            Template Name
            <Input
              value={template?.name || ''}
              onChange={(event) => setTemplate((current) => ({ ...(current ?? {}), name: event.target.value }))}
              placeholder="Quote Template"
              disabled={isLoading}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
            Version
            <Input
              type="number"
              min="1"
              step="1"
              value={String(template?.version || 1)}
              onChange={(event) => setTemplate((current) => ({ ...(current ?? {}), version: Math.max(1, Number(event.target.value) || 1) }))}
              disabled={isLoading}
            />
          </label>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'code' | 'bindings')} className="space-y-4">
        <TabsList>
          <TabsTrigger value="code">Template AST</TabsTrigger>
          <TabsTrigger value="bindings">Bindings</TabsTrigger>
        </TabsList>
        <TabsContent value="code">
          <Card>
            <CardContent className="pt-6">
              <Editor
                height="70vh"
                defaultLanguage="json"
                value={astJson}
                onChange={(value) => setAstJson(value || '')}
                options={{ minimap: { enabled: false }, wordWrap: 'on' }}
              />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="bindings">
          <Card>
            <CardHeader>
              <CardTitle>Quote Bindings Reference</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {bindingEntries.map((binding) => (
                  <div key={binding.key} className="rounded-md border border-border px-3 py-2">
                    <div className="text-sm font-medium text-foreground">{binding.key}</div>
                    <div className="text-xs text-muted-foreground">{binding.kind} • {binding.path}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default QuoteDocumentTemplateEditor;
