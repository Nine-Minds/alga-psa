'use client';

import React from 'react';
import { CommentAudienceSelect, type ComposerAudience } from '../CommentAudienceControl';

interface ComposerAudienceOrVisibilityProps {
  /** The host's condition for showing the audience select instead of its own visibility control. */
  audienceSelectable: boolean;
  id: string;
  audiences: readonly ComposerAudience[];
  value: ComposerAudience | null;
  onChange: (next: ComposerAudience) => void;
  disabled?: boolean;
  /** The host's own visibility control (classic Switch, Bento segmented buttons), shown when no audience is required. */
  children?: React.ReactNode;
}

/** "An audience replaces the Internal control", in one place. Renders no wrapper element of its own. */
export function ComposerAudienceOrVisibility({
  audienceSelectable, id, audiences, value, onChange, disabled, children,
}: ComposerAudienceOrVisibilityProps) {
  if (audienceSelectable) {
    return <CommentAudienceSelect id={id} audiences={audiences} value={value} onChange={onChange} disabled={disabled} />;
  }
  return <>{children}</>;
}
