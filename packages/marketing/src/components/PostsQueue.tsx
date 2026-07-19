'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { EmptyState } from '@alga-psa/ui/components/EmptyState';
import { Share2 } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type {
  ColumnDefinition,
  IMarketingCampaign,
  IMarketingChannel,
  IMarketingContent,
  ISocialPostQueueItem,
  SocialPostTargetStatus,
} from '@alga-psa/types';
import { getSocialPostQueue, skipPostTarget } from '../actions/postActions';
import { CreatePostDialog } from './CreatePostDialog';
import { ReschedulePostDialog } from './ReschedulePostDialog';
import { MarkPublishedDialog } from './MarkPublishedDialog';
import { CopyTextButton } from './CopyTextButton';
import { PostTargetStatusBadge } from './StatusBadge';
import { formatDateTime } from './format';

const STATUS_OPTIONS: SocialPostTargetStatus[] = [
  'scheduled',
  'awaiting-manual-publish',
  'published',
  'skipped',
  'expired',
];

export function PostsQueue({
  initialItems,
  channels,
  campaigns,
  content,
}: {
  initialItems: ISocialPostQueueItem[];
  channels: IMarketingChannel[];
  campaigns: IMarketingCampaign[];
  content: IMarketingContent[];
}): React.ReactElement {
  const { t } = useTranslation('msp/core');
  const router = useRouter();
  const pathname = usePathname();
  const [items, setItems] = useState<ISocialPostQueueItem[]>(initialItems);
  const [status, setStatus] = useState('');
  const [channelId, setChannelId] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [createOpen, setCreateOpen] = useState(false);
  const [rescheduleFor, setRescheduleFor] = useState<ISocialPostQueueItem | null>(null);
  const [markFor, setMarkFor] = useState<ISocialPostQueueItem | null>(null);
  const skipInitialFetch = useRef(true);

  // Allow /msp/marketing/posts?create=1 to deep-link the create dialog (used by the calendar page).
  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('create') === '1') {
      setCreateOpen(true);
    }
  }, []);

  // Whole scheduled days: from = local start of day, to = end of that day.
  const filters = {
    status: (status || undefined) as SocialPostTargetStatus | undefined,
    channel_id: channelId || undefined,
    campaign_id: campaignId || undefined,
    date_from: dateFrom
      ? new Date(dateFrom.getFullYear(), dateFrom.getMonth(), dateFrom.getDate()).toISOString()
      : undefined,
    date_to: dateTo
      ? new Date(dateTo.getFullYear(), dateTo.getMonth(), dateTo.getDate() + 1).toISOString()
      : undefined,
  };

  const refresh = useCallback(async () => {
    try {
      setItems(await getSocialPostQueue(filters));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, channelId, campaignId, dateFrom, dateTo]);

  useEffect(() => {
    if (skipInitialFetch.current) {
      skipInitialFetch.current = false;
      return;
    }
    void refresh();
  }, [refresh]);

  const handleSkip = async (targetId: string) => {
    try {
      await skipPostTarget(targetId);
      toast.success(t('marketing.calendar.toast.skipped', 'Skipped'));
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const columns: ColumnDefinition<ISocialPostQueueItem>[] = [
    {
      title: t('marketing.posts.columns.content', 'Content'),
      dataIndex: 'content_title',
      render: (value: string) => (
        <span className="font-medium text-[rgb(var(--color-text-800))]">{value}</span>
      ),
    },
    { title: t('marketing.posts.columns.channel', 'Channel'), dataIndex: 'channel_name' },
    {
      title: t('marketing.posts.columns.campaign', 'Campaign'),
      dataIndex: 'campaign_name',
      render: (value: string | null) => value ?? '—',
    },
    {
      title: t('marketing.posts.columns.scheduled', 'Scheduled'),
      dataIndex: 'scheduled_at',
      render: (value: string | null) => formatDateTime(value),
    },
    {
      title: t('marketing.posts.columns.status', 'Status'),
      dataIndex: 'status',
      render: (value: SocialPostTargetStatus) => <PostTargetStatusBadge status={value} />,
    },
    {
      title: t('marketing.posts.columns.actions', 'Actions'),
      dataIndex: 'target_id',
      sortable: false,
      render: (_value: string, record: ISocialPostQueueItem) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <CopyTextButton id={`marketing-posts-copy-${record.target_id}`} text={record.rendered_text} />
          {record.status === 'awaiting-manual-publish' && (
            <>
              <Button
                id={`marketing-posts-mark-${record.target_id}`}
                type="button"
                size="xs"
                variant="outline"
                onClick={() => setMarkFor(record)}
              >
                {t('marketing.posts.markPublished.confirm', 'Mark published')}
              </Button>
              <Button
                id={`marketing-posts-skip-${record.target_id}`}
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => void handleSkip(record.target_id)}
              >
                {t('marketing.posts.skip', 'Skip')}
              </Button>
            </>
          )}
          {(record.status === 'scheduled' || record.status === 'awaiting-manual-publish') && (
            <Button
              id={`marketing-posts-reschedule-${record.target_id}`}
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => setRescheduleFor(record)}
            >
              {t('marketing.posts.reschedule', 'Reschedule')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">
          {t('marketing.posts.title', 'Posts')}
        </h1>
        <Button id="marketing-posts-new" type="button" size="sm" onClick={() => setCreateOpen(true)}>
          {t('marketing.posts.new', 'New post')}
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <CustomSelect
          id="marketing-posts-filter-status"
          label={t('marketing.posts.filters.status', 'Status')}
          options={STATUS_OPTIONS.map((value) => ({
            value,
            label: t(`marketing.posts.status.${value}`, value),
          }))}
          value={status}
          onValueChange={setStatus}
          placeholder={t('marketing.posts.filters.all', 'All')}
          allowClear
          size="sm"
        />
        <CustomSelect
          id="marketing-posts-filter-channel"
          label={t('marketing.posts.filters.channel', 'Channel')}
          options={channels.map((channel) => ({ value: channel.channel_id, label: channel.name }))}
          value={channelId}
          onValueChange={setChannelId}
          placeholder={t('marketing.posts.filters.all', 'All')}
          allowClear
          size="sm"
        />
        <CustomSelect
          id="marketing-posts-filter-campaign"
          label={t('marketing.posts.filters.campaign', 'Campaign')}
          options={campaigns.map((campaign) => ({ value: campaign.campaign_id, label: campaign.name }))}
          value={campaignId}
          onValueChange={setCampaignId}
          placeholder={t('marketing.posts.filters.all', 'All')}
          allowClear
          size="sm"
        />
        <DatePicker
          id="marketing-posts-filter-date-from"
          label={t('marketing.posts.filters.dateFrom', 'Scheduled from')}
          value={dateFrom}
          onChange={(date?: Date) => setDateFrom(date)}
        />
        <DatePicker
          id="marketing-posts-filter-date-to"
          label={t('marketing.posts.filters.dateTo', 'Scheduled to')}
          value={dateTo}
          onChange={(date?: Date) => setDateTo(date)}
        />
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<Share2 className="h-6 w-6" />}
          title={t('marketing.posts.emptyTitle', 'No posts yet')}
          description={t(
            'marketing.posts.emptyBody',
            'Create a post from your content library and it will appear in this queue.'
          )}
          action={
            <Button id="marketing-posts-empty-new" type="button" size="sm" onClick={() => setCreateOpen(true)}>
              {t('marketing.posts.new', 'New post')}
            </Button>
          }
        />
      ) : (
        <DataTable data={items} columns={columns} pagination={false} />
      )}

      <CreatePostDialog
        isOpen={createOpen}
        onClose={() => {
          setCreateOpen(false);
          // Clear the ?create=1 deep link so refresh/back doesn't reopen it.
          if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('create') === '1') {
            router.replace(pathname);
          }
        }}
        content={content}
        channels={channels.filter((channel) => channel.is_active)}
        campaigns={campaigns}
        onCompleted={() => {
          void refresh();
          router.refresh();
        }}
      />
      <ReschedulePostDialog
        item={rescheduleFor}
        isOpen={rescheduleFor != null}
        onClose={() => setRescheduleFor(null)}
        onCompleted={() => void refresh()}
      />
      <MarkPublishedDialog
        target={markFor}
        isOpen={markFor != null}
        onClose={() => setMarkFor(null)}
        onCompleted={() => void refresh()}
      />
    </div>
  );
}
