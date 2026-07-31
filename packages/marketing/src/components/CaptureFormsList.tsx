'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { EmptyState } from '@alga-psa/ui/components/EmptyState';
import { useTenant } from '@alga-psa/ui/components/providers/TenantProvider';
import { ClipboardList } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ColumnDefinition, IMarketingCampaign, IMarketingCaptureForm } from '@alga-psa/types';
import { CaptureFormDialog } from './CaptureFormDialog';
import { copyToClipboard } from './format';

export function CaptureFormsList({
  items,
  campaigns,
}: {
  items: IMarketingCaptureForm[];
  campaigns: IMarketingCampaign[];
}): React.ReactElement {
  const { t } = useTranslation('msp/core');
  const router = useRouter();
  const tenant = useTenant();
  const [dialogFor, setDialogFor] = useState<IMarketingCaptureForm | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const campaignName = (campaignId?: string | null) =>
    campaigns.find((campaign) => campaign.campaign_id === campaignId)?.name ?? '—';

  const captureUrl = (slug: string) =>
    `${typeof window !== 'undefined' ? window.location.origin : ''}/api/marketing/capture/${tenant ?? '{tenant}'}/${slug}`;

  const handleCopyUrl = async (slug: string) => {
    const ok = await copyToClipboard(captureUrl(slug));
    if (ok) {
      toast.success(t('marketing.forms.toast.urlCopied', 'Capture URL copied'));
    } else {
      toast.error(t('marketing.posts.toast.copyFailed', 'Could not copy to clipboard'));
    }
  };

  const columns: ColumnDefinition<IMarketingCaptureForm>[] = [
    {
      title: t('marketing.forms.columns.name', 'Name'),
      dataIndex: 'name',
      render: (value: string) => (
        <span className="font-medium text-[rgb(var(--color-text-800))]">{value}</span>
      ),
    },
    {
      title: t('marketing.forms.columns.slug', 'Slug'),
      dataIndex: 'slug',
      render: (value: string) => (
        <code className="rounded bg-[rgb(var(--color-border-100))] px-1.5 py-0.5 text-xs text-[rgb(var(--color-text-700))]">
          {value}
        </code>
      ),
    },
    {
      title: t('marketing.forms.columns.campaign', 'Campaign'),
      dataIndex: 'campaign_id',
      render: (value: string | null) => campaignName(value),
    },
    {
      title: t('marketing.forms.columns.status', 'Status'),
      dataIndex: 'is_active',
      sortable: false,
      render: (value: boolean, record: IMarketingCaptureForm) => (
        <div className="flex items-center gap-1.5">
          <Badge variant={value ? 'success' : 'default-muted'} size="sm">
            {value ? t('marketing.forms.active', 'active') : t('marketing.forms.inactive', 'inactive')}
          </Badge>
          {record.creates_suggestion && (
            <Badge variant="info" size="sm">
              {t('marketing.forms.createsSuggestion', 'suggestion')}
            </Badge>
          )}
        </div>
      ),
    },
    {
      title: t('marketing.forms.columns.captureUrl', 'Capture URL'),
      dataIndex: 'form_id',
      sortable: false,
      render: (_value: string, record: IMarketingCaptureForm) => (
        <div className="flex items-center gap-1.5">
          <span className="max-w-64 truncate text-xs text-[rgb(var(--color-text-400))]">
            {`/api/marketing/capture/${tenant ?? '{tenant}'}/${record.slug}`}
          </span>
          <Button
            id={`marketing-forms-copy-${record.form_id}`}
            type="button"
            size="xs"
            variant="outline"
            onClick={() => void handleCopyUrl(record.slug)}
          >
            {t('marketing.forms.copyUrl', 'Copy')}
          </Button>
        </div>
      ),
    },
    {
      title: t('marketing.forms.columns.actions', 'Actions'),
      dataIndex: 'updated_at',
      sortable: false,
      render: (_value: string, record: IMarketingCaptureForm) => (
        <Button
          id={`marketing-forms-edit-${record.form_id}`}
          type="button"
          size="xs"
          variant="ghost"
          onClick={() => {
            setDialogFor(record);
            setDialogOpen(true);
          }}
        >
          {t('marketing.actions.edit', 'Edit')}
        </Button>
      ),
    },
  ];

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">
          {t('marketing.forms.title', 'Capture forms')}
        </h1>
        <Button
          id="marketing-forms-new"
          type="button"
          size="sm"
          onClick={() => {
            setDialogFor(null);
            setDialogOpen(true);
          }}
        >
          {t('marketing.forms.new', 'New form')}
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-6 w-6" />}
          title={t('marketing.forms.emptyTitle', 'No capture forms yet')}
          description={t(
            'marketing.forms.emptyBody',
            'Public forms turn inbound leads into contacts — and optionally into opportunity suggestions.'
          )}
          action={
            <Button
              id="marketing-forms-empty-new"
              type="button"
              size="sm"
              onClick={() => {
                setDialogFor(null);
                setDialogOpen(true);
              }}
            >
              {t('marketing.forms.new', 'New form')}
            </Button>
          }
        />
      ) : (
        <DataTable data={items} columns={columns} pagination={false} />
      )}

      <CaptureFormDialog
        item={dialogFor}
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        campaigns={campaigns}
        onCompleted={() => router.refresh()}
      />
    </div>
  );
}
