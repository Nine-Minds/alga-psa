'use client';

import { useEffect, useMemo, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './DropdownMenu';
import { Button } from './Button';
import { useAppTheme } from '../hooks/useAppTheme';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

type ThemeOption = 'light' | 'dark' | 'system';

interface ThemeToggleLabels {
  ariaLabel?: string;
  light?: string;
  dark?: string;
  system?: string;
  selected?: string;
}

interface ThemeToggleProps {
  labels?: ThemeToggleLabels;
}

export function ThemeToggle({ labels }: ThemeToggleProps) {
  const { t } = useTranslation('common');
  const { theme, resolvedTheme, setTheme } = useAppTheme();
  const [mounted, setMounted] = useState(false);
  const themeOptions: Array<{ value: ThemeOption; label: string; icon: typeof Sun }> = [
    { value: 'light', label: labels?.light ?? t('enums.theme.light'), icon: Sun },
    { value: 'dark', label: labels?.dark ?? t('enums.theme.dark'), icon: Moon },
    { value: 'system', label: labels?.system ?? t('enums.theme.system'), icon: Monitor },
  ];
  const ariaLabel = labels?.ariaLabel ?? t('themeToggle.ariaLabel');
  const selectedLabel = labels?.selected ?? t('themeToggle.selected');

  useEffect(() => {
    setMounted(true);
  }, []);

  const ActiveIcon = useMemo(() => {
    if (resolvedTheme === 'dark') {
      return Moon;
    }
    if (resolvedTheme === 'light') {
      return Sun;
    }
    return Monitor;
  }, [resolvedTheme]);

  if (!mounted) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          id="theme-toggle"
          data-automation-id="theme-toggle"
          variant="ghost"
          size="icon"
          aria-label={ariaLabel}
          className="h-10 w-10"
        >
          <ActiveIcon className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {themeOptions.map(({ value, label, icon: Icon }) => (
          <DropdownMenuItem
            key={value}
            onSelect={() => setTheme(value)}
            className="flex items-center gap-2"
          >
            <Icon className="h-4 w-4" />
            <span className="text-sm">{label}</span>
            {theme === value && (
              <span className="ml-auto text-xs text-gray-500">{selectedLabel}</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
