'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import type { ColumnDefinition, IQuoteDocumentTemplate } from '@alga-psa/types';
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
        const loadedTemplates = await getQuoteDocumentTemplates();
        setTemplates(loadedTemplates);
        setError(null);
      } catch (loadError) {
        console.error('Error loading quote document templates:', loadError);
        setError(loadError instanceof Error ? loadError.message : 'Failed to load quote document templates');
      }
    };

    void loadTemplates();
  }, [selectedTemplateId]);

  const columns = useMemo<ColumnDefinition<IQuoteDocumentTemplate>[]>(() => ([
    { title: 'Name', dataIndex: 'name' },
    {
      title: 'Source',
      dataIndex: 'templateSource',
      render: (value: string | null | undefined, record) => record.isStandard ? 'Standard' : (value || 'Custom'),
    },
    { title: 'Version', dataIndex: 'version' },
    {
      title: 'Default',
      dataIndex: 'isTenantDefault',
      render: (value: boolean | null | undefined) => value ? 'Yes' : 'No',
    },
  ]), []);

  if (selectedTemplateId || standardCode) {
    return <QuoteDocumentTemplateEditor templateId={selectedTemplateId === 'new' ? null : selectedTemplateId} standardCode={standardCode} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Quote Document Templates</h1>
          <p className="text-sm text-muted-foreground">Manage the AST-driven templates used to render quote PDFs and previews.</p>
        </div>
        <div className="flex gap-2">
          <Button id="quote-document-templates-back" variant="outline" onClick={() => router.push('/msp/billing?tab=quotes')}>
            Back to Quotes
          </Button>
          <Button id="quote-document-templates-new" onClick={() => router.push('/msp/quote-document-templates?templateId=new')}>
            New Template
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Quote Document Templates</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Available Templates</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            data={templates}
            columns={columns}
            pagination
            onRowClick={(record) => {
              if (record.isStandard) {
                router.push(`/msp/quote-document-templates?templateId=new&standardCode=${record.standard_quote_document_template_code || 'standard-quote-default'}`);
                return;
              }

              router.push(`/msp/quote-document-templates?templateId=${record.template_id}`);
            }}
            rowClassName={() => 'cursor-pointer'}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default QuoteDocumentTemplatesPage;
