'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { EmptyState } from '@alga-psa/ui/components/EmptyState';
import { Target, X } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ColumnDefinition, IMarketingCampaign, IMarketingCampaignFunnel } from '@alga-psa/types';
import { getCampaignFunnel } from '../actions/campaignActions';
import { CampaignDialog } from './CampaignDialog';
import { CampaignStatusBadge } from './StatusBadge';
import { formatDate } from './format';

function FunnelStrip({ funnel }: { funnel: IMarketingCampaignFunnel }): React.ReactElement {
  const { t } = useTranslation('msp/core');
  const stats: Array<{ key: string; label: string; value: number }> = [
    { key: 'posts_published', label: t('marketing.campaigns.funnel.postsPublished', 'Posts published'), value: funnel.posts_published },
    { key: 'emails_sent', label: t('marketing.campaigns.funnel.emailsSent', 'Emails sent'), value: funnel.emails_sent },
    { key: 'emails_opened', label: t('marketing.campaigns.funnel.emailsOpened', 'Opened'), value: funnel.emails_opened },
    { key: 'emails_clicked', label: t('marketing.campaigns.funnel.emailsClicked', 'Clicked'), value: funnel.emails_clicked },
    { key: 'forms_submitted', label: t('marketing.campaigns.funnel.formsSubmitted', 'Forms submitted'), value: funnel.forms_submitted },
    { key: 'suggestions_created', label: t('marketing.campaigns.funnel.suggestionsCreated', 'Suggestions'), value: funnel.suggestions_created },
    { key: 'suggestions_accepted', label: t('marketing.campaigns.funnel.suggestionsAccepted', 'Accepted'), value: funnel.suggestions_accepted },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
      {stats.map((stat) => (
        <div
          key={stat.key}
          className="rounded-md border border-[rgb(var(--color-border-100))] bg-[rgb(var(--color-border-50))] p-2 text-center"
        >
          <div className="text-lg font-semibold text-[rgb(var(--color-text-900))]">{stat.value}</div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-[rgb(var(--color-text-400))]">
            {stat.label}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CampaignsList({ items }: { items: IMarketingCampaign[] }): React.ReactElement {
  const { t } = useTranslation('msp/core');
  const router = useRouter();
  const [dialogFor, setDialogFor] = useState<IMarketingCampaign | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<IMarketingCampaign | null>(null);
  const [funnel, setFunnel] = useState<IMarketingCampaignFunnel | null>(null);

  useEffect(() => {
    if (!selected) {
      setFunnel(null);
      return;
    }
    let cancelled = false;
    getCampaignFunnel(selected.campaign_id)
      .then((result) => {
        if (!cancelled) setFunnel(result);
      })
      .catch((err) => {
        if (!cancelled) toast.error(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const columns: ColumnDefinition<IMarketingCampaign>[] = [
    {
      title: t('marketing.campaigns.columns.name', 'Name'),
      dataIndex: 'name',
      render: (value: string) => (
        <span className="font-medium text-[rgb(var(--color-text-800))]">{value}</span>
      ),
    },
    {
      title: t('marketing.campaigns.columns.status', 'Status'),
      dataIndex: 'status',
      render: (value: IMarketingCampaign['status']) => <CampaignStatusBadge status={value} />,
    },
    {
      title: t('marketing.campaigns.columns.startDate', 'Start'),
      dataIndex: 'start_date',
      render: (value: string | null) => formatDate(value),
    },
    {
      title: t('marketing.campaigns.columns.endDate', 'End'),
      dataIndex: 'end_date',
      render: (value: string | null) => formatDate(value),
    },
    {
      title: t('marketing.campaigns.columns.actions', 'Actions'),
      dataIndex: 'campaign_id',
      sortable: false,
      render: (_value: string, record: IMarketingCampaign) => (
        <div className="flex items-center gap-1.5">
          <Button
            id={`marketing-campaigns-view-${record.campaign_id}`}
            type="button"
            size="xs"
            variant="outline"
            onClick={() => setSelected(record)}
          >
            {t('marketing.campaigns.view', 'View')}
          </Button>
          <Button
            id={`marketing-campaigns-edit-${record.campaign_id}`}
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
        </div>
      ),
    },
  ];

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">
          {t('marketing.campaigns.title', 'Campaigns')}
        </h1>
        <Button
          id="marketing-campaigns-new"
          type="button"
          size="sm"
          onClick={() => {
            setDialogFor(null);
            setDialogOpen(true);
          }}
        >
          {t('marketing.campaigns.new', 'New campaign')}
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<Target className="h-6 w-6" />}
          title={t('marketing.campaigns.emptyTitle', 'No campaigns yet')}
          description={t(
            'marketing.campaigns.emptyBody',
            'Campaigns group posts, content, forms, and sequences so you can see the funnel in one place.'
          )}
          action={
            <Button
              id="marketing-campaigns-empty-new"
              type="button"
              size="sm"
              onClick={() => {
                setDialogFor(null);
                setDialogOpen(true);
              }}
            >
              {t('marketing.campaigns.new', 'New campaign')}
            </Button>
          }
        />
      ) : (
        <>
          <DataTable data={items} columns={columns} pagination={false} />
          {selected && (
            <div className="mt-4 rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="text-sm font-semibold text-[rgb(var(--color-text-800))]">{selected.name}</span>
                <CampaignStatusBadge status={selected.status} />
                <Button
                  id="marketing-campaigns-close-detail"
                  type="button"
                  size="xs"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => setSelected(null)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              {selected.goal && (
                <p className="mb-3 text-sm text-[rgb(var(--color-text-500))]">{selected.goal}</p>
              )}
              {funnel ? (
                <FunnelStrip funnel={funnel} />
              ) : (
                <p className="text-sm text-[rgb(var(--color-text-400))]">
                  {t('marketing.campaigns.funnel.loading', 'Loading funnel…')}
                </p>
              )}
            </div>
          )}
        </>
      )}

      <CampaignDialog
        item={dialogFor}
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCompleted={() => router.refresh()}
      />
    </div>
  );
}
