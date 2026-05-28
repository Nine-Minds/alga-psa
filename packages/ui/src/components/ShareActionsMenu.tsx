'use client';

import * as React from 'react';
import { Share2, type LucideIcon } from 'lucide-react';
import { Button, type ButtonProps } from './Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './DropdownMenu';
import { Tooltip } from './Tooltip';
import { useTranslation } from '../lib/i18n/client';

export type ShareAction = {
  id: string;
  label: React.ReactNode;
  icon?: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  /** Render a separator above this item. */
  separator?: boolean;
};

type ShareActionsMenuProps = {
  id: string;
  actions: ShareAction[];
  /** Tooltip text and accessible label for the icon-only trigger. */
  tooltip?: string;
  triggerVariant?: ButtonProps['variant'];
  triggerSize?: ButtonProps['size'];
  triggerClassName?: string;
  /** Disable the trigger entirely (e.g. when no rows loaded). */
  disabled?: boolean;
  align?: 'start' | 'center' | 'end';
};

const SIZE_SQUARE_CLASSES: Record<NonNullable<ButtonProps['size']>, string> = {
  default: 'w-10 px-0',
  sm: 'w-9 px-0',
  xs: 'w-7 px-0',
  lg: 'w-11 px-0',
  icon: '',
};

export function ShareActionsMenu({
  id,
  actions,
  tooltip,
  triggerVariant = 'outline',
  triggerSize = 'default',
  triggerClassName,
  disabled = false,
  align = 'end',
}: ShareActionsMenuProps) {
  const { t } = useTranslation('common');
  const tooltipText = tooltip ?? t('actions.share', { defaultValue: 'Share' });
  const sizeClass = SIZE_SQUARE_CLASSES[triggerSize ?? 'default'] ?? '';

  const trigger = (
    <DropdownMenuTrigger asChild>
      <Button
        id={id}
        variant={triggerVariant}
        size={triggerSize}
        disabled={disabled}
        className={[sizeClass, triggerClassName].filter(Boolean).join(' ')}
        label={tooltipText}
        aria-label={tooltipText}
      >
        <Share2 className="h-4 w-4" />
      </Button>
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu>
      <Tooltip content={tooltipText}>{trigger}</Tooltip>
      <DropdownMenuContent align={align} className="w-56">
        {actions.map((action, index) => {
          const Icon = action.icon;
          return (
            <React.Fragment key={action.id}>
              {action.separator && index > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                id={action.id}
                disabled={action.disabled}
                onSelect={(event) => {
                  event.preventDefault();
                  if (action.disabled) return;
                  action.onSelect();
                }}
                className="gap-2"
              >
                {Icon ? <Icon className="h-4 w-4 text-[rgb(var(--color-text-500))]" /> : null}
                <span className="flex-1">{action.label}</span>
              </DropdownMenuItem>
            </React.Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
