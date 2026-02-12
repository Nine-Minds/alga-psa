'use client';

import { createReactInlineContentSpec } from "@blocknote/react";

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
      displayName: { default: "Unknown" }
    },
    content: "none",
  },
  {
    render: (props) => {
      const { userId, username, displayName } = props.inlineContent.props;

      // Display @username if available, otherwise @[Display Name]
      const displayText = username ? `@${username}` : `@[${displayName}]`;

      return (
        <span
          className="inline-flex items-center px-1 py-0.5 rounded bg-[rgb(var(--badge-info-bg))] text-[rgb(var(--badge-info-text))] font-medium cursor-pointer hover:opacity-80 transition-colors"
          data-user-id={userId}
          title={`${displayName} (${username || 'no username'})`}
        >
          {displayText}
        </span>
      );
    },
  },
);
