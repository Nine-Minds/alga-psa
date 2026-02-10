'use client';

import { useEffect, useMemo, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './DropdownMenu';
import { Button } from './Button';
import { useAppTheme } from '../hooks/useAppTheme';
import { useFeatureFlag } from '../hooks/useFeatureFlag';

type ThemeOption = 'light' | 'dark' | 'system';

const themeOptions: Array<{ value: ThemeOption; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export function ThemeToggle() {
  const { enabled: themesEnabled, loading: themesLoading } = useFeatureFlag('themes-enabled');
  const { theme, resolvedTheme, setTheme } = useAppTheme();
  const [mounted, setMounted] = useState(false);

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

  if (!mounted || themesLoading || !themesEnabled) {
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
          aria-label="Theme toggle"
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
              <span className="ml-auto text-xs text-gray-500">Selected</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
