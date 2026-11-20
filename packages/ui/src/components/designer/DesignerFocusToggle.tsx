'use client';

/**
 * The one control that enters and leaves focus mode, in every designer's toolbar. It reads the
 * surface above it, so a designer that is not wrapped in one simply has no toggle.
 */
import React from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';

import { Button } from '../Button';
import { useTranslation } from '../../lib/i18n/client';
import { formatShortcut } from '../../keyboard-shortcuts/display';
import { useClientPlatform } from '../../keyboard-shortcuts/platform';
import { useResolvedShortcutBindings } from '../../keyboard-shortcuts/provider';
import {
  DESIGNER_FOCUS_MODE_SHORTCUT_ACTION_ID,
  useOptionalDesignerFocusState,
} from './DesignerFocusSurface';

export interface DesignerFocusToggleProps {
  id: string;
  className?: string;
}

export function DesignerFocusToggle({ id, className }: DesignerFocusToggleProps): React.JSX.Element | null {
  const { t } = useTranslation('common');
  const surface = useOptionalDesignerFocusState();
  const platform = useClientPlatform('other');
  const binding = useResolvedShortcutBindings(DESIGNER_FOCUS_MODE_SHORTCUT_ACTION_ID)[0];

  if (!surface) {
    return null;
  }

  const label = surface.isFocused
    ? t('designer.focusMode.exit', { defaultValue: 'Exit focus mode' })
    : t('designer.focusMode.enter', { defaultValue: 'Focus mode' });
  // The author's own binding, written the way their platform writes it.
  const tooltip = binding ? `${label} (${formatShortcut(binding, platform)})` : label;

  return (
    <Button
      id={id}
      variant="ghost"
      size="icon"
      className={`shrink-0 ${className ?? ''}`.trim()}
      aria-pressed={surface.isFocused}
      aria-label={label}
      tooltipText={tooltip}
      onClick={surface.toggle}
    >
      {surface.isFocused ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
    </Button>
  );
}

export default DesignerFocusToggle;
