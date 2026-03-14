'use client';

import React, { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { Popover, PopoverTrigger, PopoverContent } from './Popover';

/** Custom Alga logo emoji identifier */
export const ALGA_EMOJI_ID = ':alga:';

/** Alga custom emoji definition for emoji-mart */
const ALGA_CUSTOM_EMOJI = [
  {
    id: 'alga',
    name: 'Alga',
    emojis: [
      {
        id: 'alga',
        name: 'Alga',
        keywords: ['alga', 'logo', 'brand'],
        skins: [{ src: '/images/avatar-purple-big.png' }],
      },
    ],
  },
];

// Lazy-load the heavy emoji-mart Picker component
const Picker = lazy(() =>
  import('@emoji-mart/react').then((mod) => ({ default: mod.default }))
);

interface EmojiPickerPopoverProps {
  id?: string;
  onSelect: (emoji: string) => void;
  children: React.ReactNode;
}

export function EmojiPickerPopover({ id, onSelect, children }: EmojiPickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    if (open) {
      setIsDark(document.documentElement.classList.contains('dark'));
    }
  }, [open]);

  const handleEmojiSelect = useCallback((emoji: any) => {
    if (emoji.id === 'alga') {
      onSelect(ALGA_EMOJI_ID);
    } else {
      onSelect(emoji.native);
    }
    setOpen(false);
  }, [onSelect]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>
      <PopoverContent
        id={id}
        align="start"
        className="w-auto p-0 border-none shadow-lg"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {open && (
          <Suspense fallback={
            <div className="w-[352px] h-[435px] flex items-center justify-center text-sm text-[rgb(var(--color-text-400))]">
              Loading...
            </div>
          }>
            <Picker
              onEmojiSelect={handleEmojiSelect}
              custom={ALGA_CUSTOM_EMOJI}
              theme={isDark ? 'dark' : 'light'}
              set="native"
              perLine={9}
              maxFrequentRows={2}
              previewPosition="none"
              skinTonePosition="search"
              emojiSize={24}
              emojiButtonSize={36}
            />
          </Suspense>
        )}
      </PopoverContent>
    </Popover>
  );
}
