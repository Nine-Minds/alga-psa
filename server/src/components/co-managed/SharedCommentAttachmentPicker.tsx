'use client';

import { useSyncExternalStore } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { AttachmentStaging } from '@/lib/co-managed/attachmentStaging';

/**
 * Composer footer for the shared ticket screen: choose files for the next
 * message. Staged files live in the data source's store; it sends them through
 * the co-managed draft flow and clears them only after the message is saved.
 */
export default function SharedCommentAttachmentPicker({ staging, limits, attachable, disabled }: {
  staging: AttachmentStaging;
  limits: { maxBytes: number; maxFiles: number };
  /** Files can only be sent to audiences the draft flow supports. */
  attachable: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation('msp/licensing');
  const files = useSyncExternalStore(staging.subscribe, staging.getSnapshot, staging.getSnapshot);
  const invalid = files.length > limits.maxFiles || files.some(({ file }) => file.size > limits.maxBytes);
  if (!attachable) {
    return files.length
      ? <p role="alert" className="text-sm text-destructive">{t('coManaged.conversation.files.audienceUnavailable')}</p>
      : null;
  }
  return (
    <div className="space-y-2">
      <Input id="co-shared-comment-files" type="file" multiple preserveCursor={false} disabled={disabled}
        label={t('coManaged.conversation.files.choose')} aria-describedby="co-shared-comment-files-help"
        onChange={event => { staging.add(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
      <p id="co-shared-comment-files-help" className="text-xs text-muted-foreground">
        {t('coManaged.conversation.files.help', { count: limits.maxFiles, size: Math.floor(limits.maxBytes / 1048576) })}
      </p>
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map(({ key, file }) => (
            <li key={key} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{file.name}</span>
              <Button id={`co-shared-comment-file-remove-${key}`} type="button" variant="ghost" size="sm" disabled={disabled}
                aria-label={t('coManaged.conversation.files.removeNamed', { name: file.name })} onClick={() => staging.remove(key)}>
                {t('coManaged.conversation.files.remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {invalid && <p role="alert" className="text-sm text-destructive">{t('coManaged.conversation.files.invalid')}</p>}
    </div>
  );
}
