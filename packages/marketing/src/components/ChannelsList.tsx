'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { EmptyState } from '@alga-psa/ui/components/EmptyState';
import { AtSign } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ColumnDefinition, IMarketingChannel } from '@alga-psa/types';
import { updateMarketingChannel } from '../actions/channelActions';
import { ChannelDialog } from './ChannelDialog';
import { platformChip } from './format';

export function ChannelsList({ items }: { items: IMarketingChannel[] }): React.ReactElement {
  const { t } = useTranslation('msp/core');
  const router = useRouter();
  const [dialogFor, setDialogFor] = useState<IMarketingChannel | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleToggleActive = async (channel: IMarketingChannel, isActive: boolean) => {
    try {
      await updateMarketingChannel(channel.channel_id, { is_active: isActive });
      toast.success(
        isActive
          ? t('marketing.channels.toast.activated', 'Channel activated')
          : t('marketing.channels.toast.deactivated', 'Channel deactivated')
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const columns: ColumnDefinition<IMarketingChannel>[] = [
    {
      title: t('marketing.channels.columns.name', 'Name'),
      dataIndex: 'name',
      render: (value: string, record: IMarketingChannel) => (
        <div className="flex items-center gap-2">
          <span className="rounded border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-[rgb(var(--color-text-500))]">
            {platformChip(record.platform)}
          </span>
          <span className="font-medium text-[rgb(var(--color-text-800))]">{value}</span>
        </div>
      ),
    },
    { title: t('marketing.channels.columns.platform', 'Platform'), dataIndex: 'platform' },
    {
      title: t('marketing.channels.columns.handle', 'Handle / URL'),
      dataIndex: 'handle_or_url',
      render: (value: string | null) => value ?? '—',
    },
    {
      title: t('marketing.channels.columns.active', 'Active'),
      dataIndex: 'is_active',
      sortable: false,
      render: (value: boolean, record: IMarketingChannel) => (
        <Checkbox
          id={`marketing-channels-active-${record.channel_id}`}
          checked={value}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            void handleToggleActive(record, e.target.checked)
          }
        />
      ),
    },
    {
      title: t('marketing.channels.columns.actions', 'Actions'),
      dataIndex: 'channel_id',
      sortable: false,
      render: (_value: string, record: IMarketingChannel) => (
        <Button
          id={`marketing-channels-edit-${record.channel_id}`}
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
          {t('marketing.channels.title', 'Channels')}
        </h1>
        <Button
          id="marketing-channels-new"
          type="button"
          size="sm"
          onClick={() => {
            setDialogFor(null);
            setDialogOpen(true);
          }}
        >
          {t('marketing.channels.new', 'New channel')}
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<AtSign className="h-6 w-6" />}
          title={t('marketing.channels.emptyTitle', 'No channels yet')}
          description={t(
            'marketing.channels.emptyBody',
            'Channels are the places you publish — a LinkedIn profile, a YouTube channel, a blog.'
          )}
          action={
            <Button
              id="marketing-channels-empty-new"
              type="button"
              size="sm"
              onClick={() => {
                setDialogFor(null);
                setDialogOpen(true);
              }}
            >
              {t('marketing.channels.new', 'New channel')}
            </Button>
          }
        />
      ) : (
        <DataTable data={items} columns={columns} pagination={false} />
      )}

      <ChannelDialog
        item={dialogFor}
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCompleted={() => router.refresh()}
      />
    </div>
  );
}
