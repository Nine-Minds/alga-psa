'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { EmptyState } from '@alga-psa/ui/components/EmptyState';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { FileText } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ColumnDefinition, IMarketingCampaign, IMarketingContent } from '@alga-psa/types';
import { deleteMarketingContent } from '../actions/contentActions';
import { ContentEditorDialog } from './ContentEditorDialog';
import { formatDate } from './format';

/** Content library: list, create/edit dialog, delete with blocked-error toast. */
export function ContentLibrary({
  items,
  campaigns,
}: {
  items: IMarketingContent[];
  campaigns: IMarketingCampaign[];
}): React.ReactElement {
  const { t } = useTranslation('msp/core');
  const router = useRouter();
  const [editorFor, setEditorFor] = useState<IMarketingContent | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteFor, setDeleteFor] = useState<IMarketingContent | null>(null);
  const [deleting, setDeleting] = useState(false);

  const campaignName = (campaignId?: string | null) =>
    campaigns.find((campaign) => campaign.campaign_id === campaignId)?.name ?? '—';

  const handleDelete = async () => {
    if (!deleteFor) return;
    setDeleting(true);
    try {
      await deleteMarketingContent(deleteFor.content_id);
      toast.success(t('marketing.content.toast.deleted', 'Content deleted'));
      setDeleteFor(null);
      router.refresh();
    } catch (err) {
      // Deletion is blocked when posts reference the content — surface the server message.
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  const columns: ColumnDefinition<IMarketingContent>[] = [
    {
      title: t('marketing.content.columns.title', 'Title'),
      dataIndex: 'title',
      render: (value: string) => (
        <span className="font-medium text-[rgb(var(--color-text-800))]">{value}</span>
      ),
    },
    {
      title: t('marketing.content.columns.campaign', 'Campaign'),
      dataIndex: 'campaign_id',
      render: (value: string | null) => campaignName(value),
    },
    {
      title: t('marketing.content.columns.variants', 'Variants'),
      dataIndex: 'channel_variants',
      sortable: false,
      render: (value: Record<string, string>) => Object.keys(value ?? {}).length,
    },
    {
      title: t('marketing.content.columns.updated', 'Updated'),
      dataIndex: 'updated_at',
      render: (value: string) => formatDate(value),
    },
    {
      title: t('marketing.content.columns.actions', 'Actions'),
      dataIndex: 'content_id',
      sortable: false,
      render: (_value: string, record: IMarketingContent) => (
        <div className="flex items-center gap-1.5">
          <Button
            id={`marketing-content-edit-${record.content_id}`}
            type="button"
            size="xs"
            variant="outline"
            onClick={() => {
              setEditorFor(record);
              setEditorOpen(true);
            }}
          >
            {t('marketing.actions.edit', 'Edit')}
          </Button>
          <Button
            id={`marketing-content-delete-${record.content_id}`}
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => setDeleteFor(record)}
          >
            {t('marketing.actions.delete', 'Delete')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">
          {t('marketing.content.title', 'Content')}
        </h1>
        <Button
          id="marketing-content-new"
          type="button"
          size="sm"
          onClick={() => {
            setEditorFor(null);
            setEditorOpen(true);
          }}
        >
          {t('marketing.content.new', 'New content')}
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-6 w-6" />}
          title={t('marketing.content.emptyTitle', 'No content yet')}
          description={t(
            'marketing.content.emptyBody',
            'Write the posts you want to publish, then schedule them from the Posts page.'
          )}
          action={
            <Button
              id="marketing-content-empty-new"
              type="button"
              size="sm"
              onClick={() => {
                setEditorFor(null);
                setEditorOpen(true);
              }}
            >
              {t('marketing.content.new', 'New content')}
            </Button>
          }
        />
      ) : (
        <DataTable data={items} columns={columns} pagination={false} />
      )}

      <ContentEditorDialog
        item={editorFor}
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        campaigns={campaigns}
        onCompleted={() => router.refresh()}
      />
      <ConfirmationDialog
        id="marketing-content-delete-dialog"
        isOpen={deleteFor != null}
        onClose={() => setDeleteFor(null)}
        onConfirm={handleDelete}
        title={t('marketing.content.deleteDialog.title', 'Delete content')}
        message={t(
          'marketing.content.deleteDialog.message',
          'Delete "{{title}}"? This cannot be undone.',
          { title: deleteFor?.title ?? '' }
        )}
        confirmLabel={t('marketing.actions.delete', 'Delete')}
        isConfirming={deleting}
      />
    </div>
  );
}
