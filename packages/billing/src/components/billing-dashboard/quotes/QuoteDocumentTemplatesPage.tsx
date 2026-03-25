'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import type { ColumnDefinition, IQuoteDocumentTemplate } from '@alga-psa/types';
import { isActionPermissionError, getErrorMessage } from '@alga-psa/ui/lib/errorHandling';
import { getQuoteDocumentTemplates } from '../../../actions/quoteDocumentTemplates';
import QuoteDocumentTemplateEditor from './QuoteDocumentTemplateEditor';

const QuoteDocumentTemplatesPage: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedTemplateId = searchParams?.get('templateId');
  const standardCode = searchParams?.get('standardCode');
  const [templates, setTemplates] = useState<IQuoteDocumentTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadTemplates = async () => {
      try {
        const result = await getQuoteDocumentTemplates();
        if (isActionPermissionError(result)) {
          setError(getErrorMessage(result));
          return;
        }
        setTemplates(result as IQuoteDocumentTemplate[]);
        setError(null);
      } catch (loadError) {
        console.error('Error loading quote document templates:', loadError);
        setError(loadError instanceof Error ? loadError.message : 'Failed to load quote document templates');
      }
    };

    void loadTemplates();
  }, [selectedTemplateId]);

  const columns = useMemo((): ColumnDefinition<IQuoteDocumentTemplate>[] => [
    { title: 'Name', dataIndex: 'name' },
    {
      title: 'Source',
      dataIndex: 'templateSource',
      render: (value: string | null | undefined, record: IQuoteDocumentTemplate) => record.isStandard ? 'Standard' : (value || 'Custom'),
    },
    { title: 'Version', dataIndex: 'version' },
    {
      title: 'Default',
      dataIndex: 'isTenantDefault',
      render: (value: boolean | null | undefined) => value ? 'Yes' : 'No',
    },
  ], []);

  const handleNavigateToEditor = (templateId: string | 'new', code?: string) => {
    const params = new URLSearchParams();
    params.set('tab', 'quote-templates');
    params.set('templateId', templateId);
    if (code) {
      params.set('standardCode', code);
    }
    router.push(`/msp/billing?${params.toString()}`);
  };

  if (selectedTemplateId || standardCode) {
    return (
      <QuoteDocumentTemplateEditor
        templateId={selectedTemplateId === 'new' ? null : selectedTemplateId}
        standardCode={standardCode}
        onBack={() => router.push('/msp/billing?tab=quote-templates')}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Quote Layouts</h2>
          <p className="text-sm text-muted-foreground">Design the layouts used to render quote PDFs and previews.</p>
        </div>
        <Button id="quote-document-templates-new" onClick={() => handleNavigateToEditor('new')}>
          New Layout
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Quote Layouts</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Available Layouts</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            data={templates}
            columns={columns}
            pagination
            onRowClick={(record) => {
              if (record.isStandard) {
                handleNavigateToEditor('new', record.standard_quote_document_template_code || 'standard-quote-default');
              } else {
                handleNavigateToEditor(record.template_id);
              }
            }}
            rowClassName={() => 'cursor-pointer'}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default QuoteDocumentTemplatesPage;
