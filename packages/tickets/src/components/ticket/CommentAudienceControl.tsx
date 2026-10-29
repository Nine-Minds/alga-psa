'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import type { CommentAudience } from '@alga-psa/types';

/**
 * Audiences the native composer may name. `shared_it` needs the co-managed command's
 * authority, so it is never selectable here (it still renders as a badge).
 */
export type ComposerAudience = Extract<CommentAudience, 'requester' | 'organization_private'>;
export const COMPOSER_AUDIENCES: readonly ComposerAudience[] = ['requester', 'organization_private'];

export const audienceIsInternal = (audience: CommentAudience | null | undefined): boolean =>
  audience != null && audience !== 'requester';

const BADGE_VARIANT: Record<CommentAudience, BadgeVariant> = {
  requester: 'info',
  shared_it: 'secondary',
  organization_private: 'warning',
};

function useAudienceLabels() {
  const { t } = useTranslation('features/tickets');
  return (audience: CommentAudience): string => {
    switch (audience) {
      case 'requester':
        return t('conversation.audience.requester', 'Requester');
      case 'shared_it':
        return t('conversation.audience.sharedIt', 'Shared IT');
      default:
        return t('conversation.audience.organizationPrivate', 'Organization private');
    }
  };
}

export function CommentAudienceBadge({ audience, id }: { audience: CommentAudience; id?: string }) {
  const label = useAudienceLabels()(audience);
  return (
    <Badge id={id} variant={BADGE_VARIANT[audience]} size="sm">
      {label}
    </Badge>
  );
}

interface CommentAudienceSelectProps {
  id: string;
  value: ComposerAudience | null;
  onChange: (audience: ComposerAudience) => void;
  disabled?: boolean;
}

/** Audience picker for the composer. No default: the author must choose (fail-closed). */
export function CommentAudienceSelect({ id, value, onChange, disabled }: CommentAudienceSelectProps) {
  const { t } = useTranslation('features/tickets');
  const labelOf = useAudienceLabels();
  return (
    <div className="flex flex-col gap-1">
      <CustomSelect
        id={id}
        value={value ?? ''}
        onValueChange={(next: string) => {
          if ((COMPOSER_AUDIENCES as readonly string[]).includes(next)) onChange(next as ComposerAudience);
        }}
        options={COMPOSER_AUDIENCES.map((audience) => ({ value: audience, label: labelOf(audience) }))}
        placeholder={t('conversation.audience.placeholder', 'Who can see this?')}
        disabled={disabled}
      />
      {value == null && (
        <p id={`${id}-required`} role="alert" className="text-xs text-[rgb(var(--color-text-500))]">
          {t('conversation.audience.required', 'Choose who can see this comment before posting it.')}
        </p>
      )}
    </div>
  );
}
