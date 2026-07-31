'use client';

import React from 'react';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { copyToClipboard } from './format';

/** Copies post text to the clipboard with toast feedback. */
export function CopyTextButton({
  id,
  text,
  size = 'xs',
  variant = 'outline',
}: {
  id: string;
  text: string;
  size?: 'xs' | 'sm';
  variant?: 'default' | 'outline' | 'ghost';
}): React.ReactElement {
  const { t } = useTranslation('msp/core');

  const handleCopy = async () => {
    const ok = await copyToClipboard(text);
    if (ok) {
      toast.success(t('marketing.posts.toast.copied', 'Copied to clipboard'));
    } else {
      toast.error(t('marketing.posts.toast.copyFailed', 'Could not copy to clipboard'));
    }
  };

  return (
    <Button id={id} type="button" size={size} variant={variant} onClick={() => void handleCopy()}>
      {t('marketing.posts.copyText', 'Copy text')}
    </Button>
  );
}
