'use client';

import React, { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { DateTimePicker } from '@alga-psa/ui/components/DateTimePicker';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ISocialPostQueueItem } from '@alga-psa/types';
import { rescheduleSocialPost } from '../actions/postActions';

/** Moves a post to a new scheduled time. */
export function ReschedulePostDialog({
  item,
  isOpen,
  onClose,
  onCompleted,
}: {
  item: ISocialPostQueueItem | null;
  isOpen: boolean;
  onClose: () => void;
  onCompleted: () => void;
}): React.ReactElement {
  const { t } = useTranslation('msp/core');
  const [scheduledAt, setScheduledAt] = useState<Date | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen && item?.scheduled_at) {
      const current = new Date(item.scheduled_at);
      setScheduledAt(Number.isNaN(current.getTime()) ? undefined : current);
    } else if (isOpen) {
      setScheduledAt(undefined);
    }
  }, [isOpen, item]);

  const submit = async () => {
    if (!item || !scheduledAt) return;
    setSaving(true);
    try {
      await rescheduleSocialPost(item.post_id, { scheduled_at: scheduledAt.toISOString() });
      toast.success(t('marketing.posts.toast.rescheduled', 'Post rescheduled'));
      onClose();
      onCompleted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      id="marketing-reschedule-post-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={t('marketing.posts.rescheduleDialog.title', 'Reschedule post')}
    >
      <div className="space-y-4 pt-1">
        <p className="text-sm text-[rgb(var(--color-text-600))]">{item?.content_title}</p>
        <DateTimePicker
          id="marketing-reschedule-post-scheduled-at"
          label={t('marketing.posts.rescheduleDialog.scheduledAt', 'New time')}
          value={scheduledAt}
          onChange={(date: Date) => setScheduledAt(date)}
          required
        />
        <div className="flex justify-end gap-2">
          <Button
            id="marketing-reschedule-post-cancel"
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={saving}
          >
            {t('marketing.dialogs.cancel', 'Cancel')}
          </Button>
          <Button
            id="marketing-reschedule-post-submit"
            type="button"
            size="sm"
            onClick={() => void submit()}
            disabled={!scheduledAt || saving}
          >
            {t('marketing.posts.rescheduleDialog.submit', 'Reschedule')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
