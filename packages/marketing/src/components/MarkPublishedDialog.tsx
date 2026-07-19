'use client';

import React, { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ISocialPostQueueItem } from '@alga-psa/types';
import { markTargetPublished } from '../actions/postActions';

/** Confirms a manual publish; optionally records the platform permalink. */
export function MarkPublishedDialog({
  target,
  isOpen,
  onClose,
  onCompleted,
}: {
  target: ISocialPostQueueItem | null;
  isOpen: boolean;
  onClose: () => void;
  onCompleted: () => void;
}): React.ReactElement {
  const { t } = useTranslation('msp/core');
  const [permalink, setPermalink] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) setPermalink('');
  }, [isOpen]);

  const submit = async () => {
    if (!target) return;
    setSaving(true);
    try {
      await markTargetPublished(target.target_id, {
        permalink: permalink.trim() ? permalink.trim() : undefined,
      });
      toast.success(t('marketing.posts.toast.markedPublished', 'Marked as published'));
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
      id="marketing-mark-published-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={t('marketing.posts.markPublished.title', 'Mark published')}
    >
      <div className="space-y-4 pt-1">
        <p className="text-sm text-[rgb(var(--color-text-600))]">
          {target?.content_title}
          {target?.channel_name ? ` · ${target.channel_name}` : ''}
        </p>
        <Input
          id="marketing-mark-published-permalink"
          label={t('marketing.posts.markPublished.permalink', 'Permalink (optional)')}
          placeholder="https://…"
          value={permalink}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPermalink(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button
            id="marketing-mark-published-cancel"
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={saving}
          >
            {t('marketing.dialogs.cancel', 'Cancel')}
          </Button>
          <Button
            id="marketing-mark-published-confirm"
            type="button"
            size="sm"
            onClick={() => void submit()}
            disabled={saving}
          >
            {t('marketing.posts.markPublished.confirm', 'Mark published')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
