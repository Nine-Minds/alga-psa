import React from 'react';
import {
  Ticket,
  Building2,
  User,
  FolderKanban,
  Monitor,
  X,
} from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { MentionableEntityType } from '../../lib/chat-actions/searchEntitiesForMention';

export type ChatMention = {
  type: MentionableEntityType;
  id: string;
  displayText: string;
};

const typeIcons: Record<MentionableEntityType, React.ElementType> = {
  ticket: Ticket,
  client: Building2,
  contact: User,
  project: FolderKanban,
  asset: Monitor,
  user: User,
};

interface ChatMentionChipProps {
  mention: ChatMention;
  onRemove: (mention: ChatMention) => void;
}

export function ChatMentionChip({ mention, onRemove }: ChatMentionChipProps) {
  const { t } = useTranslation('msp/chat');
  const Icon = typeIcons[mention.type];

  return (
    <span className={`chat-mention-chip chat-mention-chip--${mention.type}`}>
      <Icon size={12} />
      <span className="chat-mention-chip__text">{mention.displayText}</span>
      <button
        type="button"
        className="chat-mention-chip__remove"
        onClick={() => onRemove(mention)}
        aria-label={t('mentions.removeChip', {
          mention: mention.displayText,
          defaultValue: 'Remove {{mention}}',
        })}
      >
        <X size={10} />
      </button>
    </span>
  );
}
