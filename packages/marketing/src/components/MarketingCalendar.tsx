'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { EmptyState } from '@alga-psa/ui/components/EmptyState';
import { CalendarDays } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IMarketingChannel, ISocialPostQueueItem } from '@alga-psa/types';
import { skipPostTarget } from '../actions/postActions';
import { CopyTextButton } from './CopyTextButton';
import { MarkPublishedDialog } from './MarkPublishedDialog';
import { PostTargetStatusBadge } from './StatusBadge';
import { dayStart, formatDateTime, formatTime, isSameDay, overdueLabel, platformChip } from './format';

interface DayGroup {
  key: string;
  label: string;
  items: ISocialPostQueueItem[];
}

function PlatformChip({ platform }: { platform: string }): React.ReactElement {
  return (
    <span className="mt-0.5 flex-shrink-0 rounded border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-[rgb(var(--color-text-500))]">
      {platformChip(platform)}
    </span>
  );
}

export function MarketingCalendar({
  awaiting,
  items,
  channels,
  rangeLabel,
}: {
  awaiting: ISocialPostQueueItem[];
  items: ISocialPostQueueItem[];
  channels: IMarketingChannel[];
  rangeLabel: string;
}): React.ReactElement {
  const { t } = useTranslation('msp/core');
  const router = useRouter();
  const [markFor, setMarkFor] = useState<ISocialPostQueueItem | null>(null);

  const refresh = () => router.refresh();

  const handleSkip = async (targetId: string) => {
    try {
      await skipPostTarget(targetId);
      toast.success(t('marketing.calendar.toast.skipped', 'Skipped'));
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const { upcomingGroups, published } = useMemo(() => {
    const now = new Date();
    const todayStart = dayStart(now);
    const scheduledItems = items.filter((item) => item.scheduled_at);

    const upcoming = scheduledItems
      .filter((item) => dayStart(item.scheduled_at as string).getTime() >= todayStart.getTime())
      .sort((a, b) => new Date(a.scheduled_at as string).getTime() - new Date(b.scheduled_at as string).getTime());

    const groups: DayGroup[] = [];
    for (const item of upcoming) {
      const due = new Date(item.scheduled_at as string);
      const key = dayStart(due).toISOString();
      let group = groups.find((g) => g.key === key);
      if (!group) {
        const dayLabel = isSameDay(due, now)
          ? t('marketing.calendar.today', 'Today')
          : isSameDay(due, new Date(todayStart.getTime() + 86_400_000))
            ? t('marketing.calendar.tomorrow', 'Tomorrow')
            : due.toLocaleDateString(undefined, { weekday: 'long' });
        group = {
          key,
          label: `${dayLabel} · ${due.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`,
          items: [],
        };
        groups.push(group);
      }
      group.items.push(item);
    }

    const publishedItems = scheduledItems
      .filter((item) => item.status === 'published')
      .sort((a, b) => new Date(b.published_at ?? 0).getTime() - new Date(a.published_at ?? 0).getTime())
      .slice(0, 5);

    return { upcomingGroups: groups, published: publishedItems };
  }, [items, t]);

  const stats = useMemo(() => {
    const weekEnd = Date.now() + 7 * 86_400_000;
    const inWeek = items.filter((item) => {
      if (!item.scheduled_at) return false;
      const due = new Date(item.scheduled_at).getTime();
      return due <= weekEnd;
    });
    return {
      published: inWeek.filter((item) => item.status === 'published').length,
      scheduled: inWeek.filter((item) => item.status === 'scheduled').length,
      awaiting: awaiting.length,
    };
  }, [items, awaiting]);

  const overdueCount = useMemo(
    () => awaiting.filter((item) => overdueLabel(item.scheduled_at) !== null).length,
    [awaiting]
  );

  const isEmpty = items.length === 0 && awaiting.length === 0;

  const renderAgendaItem = (item: ISocialPostQueueItem) => {
    const isAwaiting = item.status === 'awaiting-manual-publish';
    return (
      <div
        key={item.target_id}
        className={`flex items-start gap-3 rounded-md border p-3 ${
          isAwaiting
            ? 'border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/10'
            : 'border-[rgb(var(--color-border-100))]'
        }`}
      >
        <PlatformChip platform={item.channel_platform} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-[rgb(var(--color-text-800))]">
              {item.content_title}
            </span>
            <PostTargetStatusBadge status={item.status} />
          </div>
          <p
            className={`mt-1 text-sm text-[rgb(var(--color-text-600))] ${isAwaiting ? 'line-clamp-2' : 'truncate'}`}
          >
            {item.rendered_text}
          </p>
          {isAwaiting ? (
            <div className="mt-2 flex items-center gap-2">
              <CopyTextButton id={`marketing-calendar-copy-${item.target_id}`} text={item.rendered_text} />
              <Button
                id={`marketing-calendar-mark-${item.target_id}`}
                type="button"
                size="xs"
                variant="outline"
                onClick={() => setMarkFor(item)}
              >
                {t('marketing.posts.markPublished.confirm', 'Mark published')}
              </Button>
              <Button
                id={`marketing-calendar-skip-${item.target_id}`}
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => void handleSkip(item.target_id)}
              >
                {t('marketing.posts.skip', 'Skip')}
              </Button>
              <span className="ml-auto flex-shrink-0 text-xs text-[rgb(var(--color-text-400))]">
                {t('marketing.calendar.dueAt', 'due {{time}}', { time: formatTime(item.scheduled_at) })}
              </span>
            </div>
          ) : (
            <div className="mt-1.5 text-xs text-[rgb(var(--color-text-400))]">
              {[formatTime(item.scheduled_at), item.channel_name].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">
            {t('marketing.calendar.title', 'Marketing calendar')}
          </h1>
          <p className="text-xs text-[rgb(var(--color-text-500))]">{rangeLabel}</p>
        </div>
        <div className="ml-auto flex flex-shrink-0 items-center gap-2">
          <Button
            id="marketing-calendar-new-post"
            type="button"
            size="sm"
            onClick={() => router.push('/msp/marketing/posts?create=1')}
          >
            {t('marketing.calendar.newPost', 'New post')}
          </Button>
        </div>
      </div>

      {isEmpty ? (
        <EmptyState
          icon={<CalendarDays className="h-6 w-6" />}
          title={t('marketing.calendar.emptyTitle', 'Nothing on the calendar yet')}
          description={t(
            'marketing.calendar.emptyBody',
            'Create a post from the Posts page and it will show up here on its scheduled day.'
          )}
          action={
            <Button
              id="marketing-calendar-empty-new-post"
              type="button"
              size="sm"
              onClick={() => router.push('/msp/marketing/posts?create=1')}
            >
              {t('marketing.calendar.newPost', 'New post')}
            </Button>
          }
        />
      ) : (
        <div className="flex items-start gap-4">
          {/* Agenda column */}
          <div className="min-w-0 flex-1 space-y-4">
            {upcomingGroups.length === 0 && (
              <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4 text-sm text-[rgb(var(--color-text-500))]">
                {t('marketing.calendar.noUpcoming', 'Nothing scheduled in this range.')}
              </div>
            )}
            {upcomingGroups.map((group) => (
              <div
                key={group.key}
                className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4"
              >
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-400))]">
                  {group.label}
                </div>
                <div className="space-y-2">{group.items.map(renderAgendaItem)}</div>
              </div>
            ))}

            {published.length > 0 && (
              <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-400))]">
                  {t('marketing.calendar.publishedRecently', 'Published recently')}
                </div>
                <ul className="divide-y divide-[rgb(var(--color-border-100))]">
                  {published.map((item) => (
                    <li key={item.target_id} className="flex items-center gap-2 py-1.5">
                      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500" />
                      <span className="truncate text-sm text-[rgb(var(--color-text-600))]">{item.content_title}</span>
                      <span className="ml-auto flex-shrink-0 text-xs text-[rgb(var(--color-text-400))]">
                        {item.published_at
                          ? formatDateTime(item.published_at)
                          : item.channel_name}
                        {item.permalink ? ' · permalink ✓' : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Right rail */}
          <div className="w-72 flex-shrink-0 space-y-4">
            {awaiting.length > 0 && (
              <div className="flex min-w-0 flex-col rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-900/10">
                <div className="mb-1 flex items-center">
                  <span className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                    {t('marketing.calendar.needsPublishing', 'Needs publishing')}
                  </span>
                  <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                    {overdueCount > 0
                      ? t('marketing.calendar.needsPublishingCount', '{{total}} waiting · {{overdue}} overdue', {
                          total: awaiting.length,
                          overdue: overdueCount,
                        })
                      : t('marketing.calendar.needsPublishingCountSimple', '{{total}} waiting', {
                          total: awaiting.length,
                        })}
                  </span>
                </div>
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  {t('marketing.calendar.needsPublishingHint', 'Copy the text, publish on the platform, then mark it published.')}
                </p>
                <div className="mt-2 space-y-2">
                  {awaiting.map((item) => (
                    <div key={item.target_id} className="rounded-md border border-amber-200 bg-white p-2.5 dark:border-amber-900/40 dark:bg-transparent">
                      <div className="truncate text-sm font-medium text-[rgb(var(--color-text-800))]">
                        {item.content_title}
                      </div>
                      <div className="text-xs text-[rgb(var(--color-text-500))]">
                        {item.channel_name}
                        {overdueLabel(item.scheduled_at) ? ` · ${overdueLabel(item.scheduled_at)}` : ''}
                      </div>
                      <div className="mt-2 flex gap-1.5">
                        <CopyTextButton id={`marketing-rail-copy-${item.target_id}`} text={item.rendered_text} />
                        <Button
                          id={`marketing-rail-mark-${item.target_id}`}
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() => setMarkFor(item)}
                        >
                          {t('marketing.posts.markPublished.confirm', 'Mark published')}
                        </Button>
                        <Button
                          id={`marketing-rail-skip-${item.target_id}`}
                          type="button"
                          size="xs"
                          variant="ghost"
                          onClick={() => void handleSkip(item.target_id)}
                        >
                          {t('marketing.posts.skip', 'Skip')}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-400))]">
                {t('marketing.calendar.thisWeek', 'This week')}
              </div>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-[rgb(var(--color-text-500))]">{t('marketing.calendar.stats.published', 'Published')}</span>
                  <span className="font-medium text-[rgb(var(--color-text-800))]">{stats.published}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[rgb(var(--color-text-500))]">{t('marketing.calendar.stats.scheduled', 'Scheduled')}</span>
                  <span className="font-medium text-[rgb(var(--color-text-800))]">{stats.scheduled}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[rgb(var(--color-text-500))]">{t('marketing.calendar.stats.awaiting', 'Awaiting publish')}</span>
                  <span className="font-medium text-amber-700 dark:text-amber-300">{stats.awaiting}</span>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4">
              <div className="mb-2 flex items-center">
                <span className="truncate text-sm font-semibold text-[rgb(var(--color-text-800))]">
                  {t('marketing.calendar.channels', 'Channels')}
                </span>
                <Link
                  href="/msp/marketing/channels"
                  className="ml-auto text-xs font-medium text-[rgb(var(--color-primary-600))] hover:underline"
                >
                  {t('marketing.calendar.manageChannels', 'Manage')}
                </Link>
              </div>
              {channels.length === 0 ? (
                <p className="text-xs text-[rgb(var(--color-text-400))]">
                  {t('marketing.calendar.noChannels', 'No channels yet.')}
                </p>
              ) : (
                <ul className="divide-y divide-[rgb(var(--color-border-100))]">
                  {channels.map((channel) => (
                    <li key={channel.channel_id} className="flex items-center gap-2 py-1.5">
                      <PlatformChip platform={channel.platform} />
                      <span className="truncate text-sm text-[rgb(var(--color-text-700))]">{channel.name}</span>
                      <span className="ml-auto flex-shrink-0 text-xs text-[rgb(var(--color-text-400))]">
                        {channel.handle_or_url ?? ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      <MarkPublishedDialog
        target={markFor}
        isOpen={markFor != null}
        onClose={() => setMarkFor(null)}
        onCompleted={refresh}
      />
    </div>
  );
}
