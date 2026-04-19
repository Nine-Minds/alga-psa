'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import { MoreVertical, Edit, Copy, Trash2 } from 'lucide-react';
import type { ColumnDefinition, IQuoteListItem } from '@alga-psa/types';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { listQuotes, deleteQuote } from '../../../actions/quoteActions';

interface QuoteTemplatesListProps {
  onEdit: (quoteId: string) => void;
  onCreateFromTemplate: (quoteId: string) => void;
  onNewTemplate?: () => void;
}

const QuoteTemplatesList: React.FC<QuoteTemplatesListProps> = ({ onEdit, onCreateFromTemplate, onNewTemplate }) => {
  const { t } = useTranslation('msp/quotes');
  const { formatCurrency, formatDate } = useFormatters();
  const [templates, setTemplates] = useState<IQuoteListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogState, setDeleteDialogState] = useState<{ isOpen: boolean; quoteId: string | null }>({ isOpen: false, quoteId: null });
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    void loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      setIsLoading(true);
      const result = await listQuotes({ is_template: true, pageSize: 200 });
      if ('permissionError' in result) {
        setError(result.permissionError);
        setTemplates([]);
      } else {
        setTemplates(result.data);
        setError(null);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('quoteTemplates.errors.load', {
        defaultValue: 'Failed to load templates',
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteTemplate = async () => {
    const quoteId = deleteDialogState.quoteId;
    if (!quoteId) return;

    setIsDeleting(true);
    setError(null);
    try {
      const result = await deleteQuote(quoteId);
      if (result && typeof result === 'object' && 'permissionError' in result) {
        setError(result.permissionError);
      } else {
        void loadTemplates();
      }
      setDeleteDialogState({ isOpen: false, quoteId: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('quoteTemplates.errors.delete', {
        defaultValue: 'Failed to delete template.',
      }));
    } finally {
      setIsDeleting(false);
    }
  };

  const columns: ColumnDefinition<IQuoteListItem>[] = useMemo(() => [
    {
      title: t('common.columns.title', { defaultValue: 'Title' }),
      dataIndex: 'title' as const,
      render: (value: string | null | undefined) => value || '—',
    },
    {
      title: t('common.columns.items', { defaultValue: 'Items' }),
      dataIndex: 'total_amount',
      render: (_: unknown, record: IQuoteListItem) => formatCurrency(Number(record.total_amount ?? 0) / 100, record.currency_code || 'USD'),
    },
    {
      title: t('common.columns.currency', { defaultValue: 'Currency' }),
      dataIndex: 'currency_code',
      render: (value: string | null | undefined) => value || 'USD',
    },
    {
      title: t('common.columns.created', { defaultValue: 'Created' }),
      dataIndex: 'created_at',
      render: (value: string | null | undefined) => value ? formatDate(value) : '—',
    },
    {
      title: t('common.columns.actions', { defaultValue: 'Actions' }),
      dataIndex: 'quote_id',
      width: '5%',
      render: (_: unknown, record: IQuoteListItem) => (
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                id={`template-row-actions-${record.quote_id}`}
                variant="ghost"
                className="h-8 w-8 p-0"
                aria-label={t('quoteTemplates.actions.templateActions', { defaultValue: 'Template actions' })}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => onEdit(record.quote_id)}
                className="flex items-center gap-2"
              >
                <Edit className="h-4 w-4" />
                {t('quoteTemplates.actions.editTemplate', { defaultValue: 'Edit Template' })}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onCreateFromTemplate(record.quote_id)}
                className="flex items-center gap-2"
              >
                <Copy className="h-4 w-4" />
                {t('quoteTemplates.actions.createQuoteFromTemplate', { defaultValue: 'Create Quote from Template' })}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setDeleteDialogState({ isOpen: true, quoteId: record.quote_id })}
                className="flex items-center gap-2 text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
                {t('quoteTemplates.actions.delete', { defaultValue: 'Delete' })}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ], [formatCurrency, formatDate, onCreateFromTemplate, onEdit, t]);

  if (isLoading) {
    return (
      <LoadingIndicator
        className="py-12 text-muted-foreground"
        layout="stacked"
        spinnerProps={{ size: 'md' }}
        text={t('quoteTemplates.loading', { defaultValue: 'Loading templates...' })}
        textClassName="text-muted-foreground"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t('quoteTemplates.description', {
            defaultValue: 'Quote templates let you save reusable sets of line items, terms, and notes. Select a template when creating a new quote to start with prefilled data.',
          })}
        </p>
        {onNewTemplate && (
          <Button id="quote-templates-new" onClick={onNewTemplate}>
            {t('common.actions.newTemplate', { defaultValue: 'New Template' })}
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>{t('quoteTemplates.title', { defaultValue: 'Templates' })}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {templates.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t('quoteTemplates.empty.inline', {
            defaultValue: 'No quote templates yet. Create a template by clicking "Save as Template" from any quote\'s detail view.',
          })}
        </div>
      ) : (
        <DataTable
          data={templates}
          columns={columns}
          pagination
          onRowClick={(record) => onEdit(record.quote_id)}
          rowClassName={() => 'cursor-pointer'}
        />
      )}

      <ConfirmationDialog
        id="delete-template-confirmation"
        isOpen={deleteDialogState.isOpen}
        onClose={() => setDeleteDialogState({ isOpen: false, quoteId: null })}
        onConfirm={handleDeleteTemplate}
        title={t('quoteTemplates.dialogs.delete.title', { defaultValue: 'Delete Template' })}
        message={t('quoteTemplates.dialogs.delete.message', {
          defaultValue: 'Are you sure you want to delete this quote template? This action cannot be undone.',
        })}
        confirmLabel={t('common.actions.delete', { defaultValue: 'Delete' })}
        cancelLabel={t('common.actions.cancel', { defaultValue: 'Cancel' })}
        isConfirming={isDeleting}
      />
    </div>
  );
};

export default QuoteTemplatesList;
