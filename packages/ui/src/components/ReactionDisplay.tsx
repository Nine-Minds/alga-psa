'use client';

import React from 'react';
import { SmilePlus } from 'lucide-react';
import { Tooltip } from './Tooltip';
import { EmojiPickerPopover, ALGA_EMOJI_ID } from './EmojiPickerPopover';
import type { IAggregatedReaction } from '@alga-psa/types';
import { cn } from '../lib/utils';

/** Inline Alga logo for reaction pills */
function AlgaLogoSmall() {
  return (
    <svg width={16} height={16} viewBox="0 0 93 105" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M83.1924 34.7078C83.0822 14.6906 66.1255 -1.33965 45.7774 0.0885731C28.5946 1.29622 14.6819 15.2255 13.4963 32.4138C12.0846 52.806 28.2086 69.7847 48.303 69.7847C51.0878 69.7847 53.7953 69.4484 56.3981 68.8307C54.8761 81.8998 48.6173 93.5186 39.3808 101.928C37.8367 103.334 39.5407 105.76 41.3825 104.768C65.9655 91.4838 82.7623 65.6434 83.1759 35.8383C83.1869 35.5239 83.198 35.2096 83.198 34.8953C83.198 34.8677 83.198 34.8401 83.198 34.8126C83.1924 34.774 83.1924 34.7409 83.1924 34.7078ZM33.2157 30.8477C31.3518 33.9468 28.17 35.4467 26.1077 34.206C24.0453 32.9653 23.8799 29.4471 25.7382 26.3535C27.6021 23.2545 30.7838 21.7545 32.8462 22.9953C34.9086 24.2305 35.074 27.7487 33.2157 30.8477ZM46.0531 35.9099C45.0164 39.373 42.3089 41.6173 39.9984 40.928C37.6878 40.2387 36.6567 36.875 37.6934 33.4119C38.7301 29.9489 41.4376 27.7046 43.7481 28.3938C46.0587 29.0831 47.0899 32.4469 46.0531 35.9099Z" fill="#8A4DEA"/>
      <path d="M3.39977 55.6639C6.0577 55.7907 8.71012 55.7797 11.3515 55.6418C12.1787 55.5977 13.0058 55.537 13.833 55.4598C14.8807 55.3661 15.4873 54.2246 14.9744 53.3037C14.4671 52.3994 14.0039 51.473 13.5738 50.53C13.2484 49.8131 12.4433 49.4767 11.7099 49.758C11.0427 50.0116 10.3755 50.2543 9.69719 50.4804C7.56313 51.1917 5.38495 51.7707 3.1792 52.2119C1.16645 52.6089 1.34843 55.5701 3.39977 55.6639Z" fill="#8A4DEA"/>
      <path d="M91.8507 66.5163C89.2644 64.5477 86.8712 62.3419 84.682 59.9322C83.9375 59.1105 82.581 59.3917 82.2336 60.445C81.8972 61.4762 81.5333 62.4963 81.1583 63.511C80.9101 64.1782 81.1638 64.9282 81.7759 65.2866C84.4614 66.8527 87.2351 68.2754 90.1026 69.5106C92.0161 70.3323 93.505 67.7736 91.8507 66.5163Z" fill="#8A4DEA"/>
      <path d="M75.9031 74.9215C74.9822 76.5813 74.0006 78.208 72.9639 79.7962C72.6165 80.3311 72.6441 81.0369 73.0577 81.5277C76.2726 85.3657 79.8459 88.9169 83.7556 92.1042C85.3547 93.4056 87.5053 91.3598 86.2646 89.711C82.9615 85.3105 80.3532 80.4027 78.5445 75.1696C78.1309 73.9785 76.5152 73.8131 75.9031 74.9215Z" fill="#8A4DEA"/>
      <path d="M21.6254 62.0382C21.0133 61.4371 20.0483 61.4702 19.4858 62.1099C15.8629 66.2346 11.6609 69.7528 7.02333 72.5375C5.09881 73.6956 3.10813 74.7267 1.05678 75.6366C-0.840165 76.4748 0.0145622 79.3147 2.05488 78.9618C4.65766 78.5096 7.22736 77.9251 9.75846 77.2192C16.1441 75.4381 22.2706 72.8519 28 69.5653C28.943 69.0249 28.954 67.6628 28.0331 67.0838C25.7336 65.6446 23.583 63.9572 21.6254 62.0382Z" fill="#8A4DEA"/>
      <path d="M50.2608 75.3321C51.1265 74.3837 50.4262 72.8617 49.1469 72.8893C48.0771 72.9113 47.0128 72.9058 46.2408 72.8782C43.4174 72.779 40.2081 72.2772 36.6017 71.0971C35.8848 70.86 35.1128 71.1963 34.7985 71.8856C31.3189 79.5506 26.1299 86.1403 19.7773 91.2466C18.0293 92.6528 16.193 93.9486 14.285 95.1232C12.5204 96.2095 13.7501 98.9116 15.7242 98.2774C18.2388 97.4778 20.7092 96.5514 23.119 95.5092C33.293 91.1143 42.6785 83.6478 50.2608 75.3321Z" fill="#8A4DEA"/>
    </svg>
  );
}

interface ReactionDisplayProps {
  id: string;
  reactions: IAggregatedReaction[];
  onToggle: (emoji: string) => void;
  onAdd: (emoji: string) => void;
  userNames?: Record<string, string>;
}

function buildTooltipContent(
  reaction: IAggregatedReaction,
  userNames?: Record<string, string>
): string {
  const names = reaction.userIds
    .map((uid) => userNames?.[uid] || 'Someone')
    .slice(0, 5);
  const remaining = reaction.userIds.length - names.length;
  let text = names.join(', ');
  if (remaining > 0) text += ` and ${remaining} more`;
  return text;
}

export function ReactionDisplay({
  id,
  reactions,
  onToggle,
  onAdd,
  userNames,
}: ReactionDisplayProps) {
  if (reactions.length === 0) {
    return (
      <div id={`${id}-reactions`} className="flex items-center gap-1 mt-1">
        <EmojiPickerPopover
          id={`${id}-reaction-picker`}
          onSelect={onAdd}
        >
          <button
            type="button"
            id={`${id}-add-reaction-button`}
            className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[rgb(var(--color-text-400))] hover:bg-[rgb(var(--color-border-100))] hover:text-[rgb(var(--color-text-600))] transition-colors opacity-0 group-hover/comment:opacity-100"
            aria-label="Add reaction"
          >
            <SmilePlus size={16} />
          </button>
        </EmojiPickerPopover>
      </div>
    );
  }

  return (
    <div id={`${id}-reactions`} className="flex flex-wrap items-center gap-1 mt-1">
      {reactions.map((reaction) => (
        <Tooltip
          key={reaction.emoji}
          content={buildTooltipContent(reaction, userNames)}
        >
          <button
            type="button"
            id={`${id}-reaction-${[...reaction.emoji].map(c => c.codePointAt(0)!.toString(16)).join('-')}`}
            onClick={() => onToggle(reaction.emoji)}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-sm border transition-colors cursor-pointer',
              reaction.currentUserReacted
                ? 'bg-[rgb(var(--color-primary-50))] border-[rgb(var(--color-primary-400))] text-[rgb(var(--color-primary-700))] dark:bg-[rgb(var(--color-primary-400)/0.15)] dark:border-[rgb(var(--color-primary-400)/0.3)] dark:text-[rgb(var(--color-primary-300))]'
                : 'bg-[rgb(var(--color-border-50))] border-[rgb(var(--color-border-200))] text-[rgb(var(--color-text-700))] hover:border-[rgb(var(--color-border-300))] dark:bg-[rgb(var(--color-border-200)/0.1)] dark:border-[rgb(var(--color-border-200)/0.2)] dark:text-[rgb(var(--color-text-400))] dark:hover:border-[rgb(var(--color-border-200)/0.3)]'
            )}
            aria-label={`${reaction.emoji} ${reaction.count} reaction${reaction.count !== 1 ? 's' : ''}${reaction.currentUserReacted ? ', you reacted' : ''}`}
          >
            <span className="text-base leading-none">{reaction.emoji === ALGA_EMOJI_ID ? <AlgaLogoSmall /> : reaction.emoji}</span>
            <span className="text-xs font-medium">{reaction.count}</span>
          </button>
        </Tooltip>
      ))}
      <EmojiPickerPopover
        id={`${id}-reaction-picker`}
        onSelect={onAdd}
      >
        <button
          type="button"
          id={`${id}-add-reaction-button`}
          className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[rgb(var(--color-text-400))] hover:bg-[rgb(var(--color-border-100))] hover:text-[rgb(var(--color-text-600))] transition-colors"
          aria-label="Add reaction"
        >
          <SmilePlus size={16} />
        </button>
      </EmojiPickerPopover>
    </div>
  );
}
