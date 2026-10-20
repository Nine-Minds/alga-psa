'use client';

import { createReactInlineContentSpec } from "@blocknote/react";
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

/**
 * Custom inline content for user mentions
 * Supports both @username and @[Display Name] formats
 */
export const Mention = createReactInlineContentSpec(
  {
    type: "mention",
    propSchema: {
      userId: { default: "" },
      username: { default: "" },
      displayName: { default: "" }
    },
    content: "none",
  },
  {
    render: function MentionContent(props) {
      const { t } = useTranslation('common');
      const { userId, username, displayName } = props.inlineContent.props;
      const resolvedDisplayName = displayName || t('common.unknown');

      // Display @username if available, otherwise @[Display Name]
      const displayText = username ? `@${username}` : `@[${resolvedDisplayName}]`;

      return (
        <span
          className="inline-flex items-center px-1 py-0.5 rounded bg-[rgb(var(--badge-info-bg))] text-[rgb(var(--badge-info-text))] font-medium cursor-pointer hover:opacity-80 transition-colors"
          data-user-id={userId}
          title={t('editor.mentions.userTitle', { displayName: resolvedDisplayName, username: username || t('editor.mentions.noUsername') })}
        >
          {displayText}
        </span>
      );
    },
  },
);
