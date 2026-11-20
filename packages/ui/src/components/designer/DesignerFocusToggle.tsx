'use client';

/**
 * The one control that enters and leaves focus mode, in every designer's toolbar. It reads the
 * surface above it, so a designer that is not wrapped in one simply has no toggle.
 */
import React from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';

import { Button } from '../Button';
import { useTranslation } from '../../lib/i18n/client';
import { useOptionalDesignerFocusState } from './DesignerFocusSurface';

export interface DesignerFocusToggleProps {
  id: string;
  className?: string;
}

export function DesignerFocusToggle({ id, className }: DesignerFocusToggleProps): React.JSX.Element | null {
  const { t } = useTranslation('common');
  const surface = useOptionalDesignerFocusState();

  if (!surface) {
    return null;
  }

  const label = surface.isFocused
    ? t('designer.focusMode.exit', { defaultValue: 'Exit focus mode' })
    : t('designer.focusMode.enter', { defaultValue: 'Focus mode' });

  return (
    <Button
      id={id}
      variant="ghost"
      size="icon"
      className={`shrink-0 ${className ?? ''}`.trim()}
      aria-pressed={surface.isFocused}
      aria-label={label}
      tooltipText={label}
      onClick={surface.toggle}
    >
      {surface.isFocused ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
    </Button>
  );
}

export default DesignerFocusToggle;
