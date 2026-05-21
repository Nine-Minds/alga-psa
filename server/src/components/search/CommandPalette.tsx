'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Compass, Search } from 'lucide-react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Kbd, SHORTCUT_ACTION_CATALOG, parseCommandPaletteQuery } from '@alga-psa/ui/keyboard-shortcuts';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { navigationSections, bottomMenuItems, type MenuItem } from '@/config/menuConfig';
import { searchAppTypeaheadAction } from '@/lib/actions/searchActions';

type PaletteResultType = 'nav' | 'action' | 'help' | 'record';
type CommandPaletteMode = 'navigation' | 'fulltext';

interface PaletteResult {
  id: string;
  type: PaletteResultType;
  label: string;
  description?: string;
  url?: string;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

const STORAGE_KEY = 'msp_command_palette_frequency_v1';
const MODE_STORAGE_KEY = 'msp_command_palette_mode_v1';

function flattenMenuItems(items: MenuItem[]): MenuItem[] {
  return items.flatMap((item) => [item, ...(item.subItems ? flattenMenuItems(item.subItems) : [])]);
}

function getFrequencies(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

function bumpFrequency(id: string) {
  if (typeof window === 'undefined') return;
  const next = getFrequencies();
  next[id] = (next[id] ?? 0) + 1;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function matches(value: string, query: string): boolean {
  return value.toLowerCase().includes(query.toLowerCase());
}

function loadInitialMode(): CommandPaletteMode {
  if (typeof window === 'undefined') return 'navigation';
  const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
  return stored === 'fulltext' ? 'fulltext' : 'navigation';
}

export function CommandPalette({ open, onClose }: CommandPaletteProps): React.JSX.Element {
  const { t } = useTranslation('msp/keyboard-shortcuts');
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [mode, setMode] = useState<CommandPaletteMode>(loadInitialMode);
  const [recordResults, setRecordResults] = useState<PaletteResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => parseCommandPaletteQuery(query), [query]);
  const firstField = parsed.terms.find((term) => term.field)?.field;
  const normalizedQuery = parsed.terms.map((term) => term.value).join(' ').trim();
  const frequencies = useMemo(() => getFrequencies(), [open, query]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  }, [mode]);

  const navResults = useMemo<PaletteResult[]>(() => {
    if (firstField && firstField !== 'nav') return [];
    const menuItems = flattenMenuItems([
      ...navigationSections.flatMap((section) => section.items),
      ...bottomMenuItems,
    ]);
    return menuItems
      .filter((item) => item.href && (!normalizedQuery || matches(item.name, normalizedQuery) || matches(item.href, normalizedQuery)))
      .map((item) => ({
        id: `nav:${item.href}`,
        type: 'nav',
        label: item.name,
        description: item.href,
        url: item.href,
      }));
  }, [firstField, normalizedQuery]);

  const actionResults = useMemo<PaletteResult[]>(() => {
    if (firstField && firstField !== 'action') return [];
    return SHORTCUT_ACTION_CATALOG
      .filter((action) => !normalizedQuery || matches(action.id, normalizedQuery) || matches(t(action.labelKey, { defaultValue: action.id }), normalizedQuery))
      .map((action) => ({
        id: `action:${action.id}`,
        type: 'action',
        label: t(action.labelKey, { defaultValue: action.id }),
        description: t(action.descriptionKey ?? action.labelKey, { defaultValue: action.id }),
      }));
  }, [firstField, normalizedQuery, t]);

  const helpResult: PaletteResult = {
    id: 'help:syntax',
    type: 'help',
    label: t('commandPalette.syntax.title', { defaultValue: 'Search tips' }),
    description: t('commandPalette.syntax.summary', { defaultValue: 'Type a menu name or action; use /nav or >action to narrow.' }),
  };

  // Debounced full-text typeahead while in fulltext mode.
  useEffect(() => {
    if (!open || mode !== 'fulltext') return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setRecordResults([]);
      setIsSearching(false);
      return;
    }
    let cancelled = false;
    setIsSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await searchAppTypeaheadAction({ query: trimmed });
        if (cancelled) return;
        setRecordResults(response.results.map((row) => ({
          id: `record:${row.type}:${row.id}`,
          type: 'record',
          label: row.title,
          description: row.subtitle ?? row.snippet ?? row.type,
          url: row.url,
        })));
      } catch (err) {
        if (!cancelled) setRecordResults([]);
        console.error('command-palette.fulltext_failed', err);
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, mode, query]);

  const seeAllUrl = query.trim() ? `/msp/search?q=${encodeURIComponent(query.trim())}` : null;

  const results = useMemo<PaletteResult[]>(() => {
    if (mode === 'fulltext') {
      const items: PaletteResult[] = [...recordResults];
      if (seeAllUrl && recordResults.length > 0) {
        items.push({
          id: 'fulltext:see-all',
          type: 'help',
          label: t('commandPalette.seeAll', { defaultValue: 'See all results' }),
          description: seeAllUrl,
          url: seeAllUrl,
        });
      }
      return items;
    }
    return [...navResults, ...actionResults, helpResult]
      .sort((left, right) => (frequencies[right.id] ?? 0) - (frequencies[left.id] ?? 0))
      .slice(0, 12);
  }, [mode, recordResults, navResults, actionResults, helpResult, frequencies, seeAllUrl, t]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, mode]);

  const activeResult = results[activeIndex];
  const activeDescendant = activeResult ? `command-palette-result-${activeResult.id.replace(/[^a-z0-9]+/gi, '-')}` : undefined;

  const activate = (result: PaletteResult | undefined) => {
    if (!result) return;
    bumpFrequency(result.id);
    if (result.url) {
      window.location.assign(result.url);
      return;
    }
    if (result.type === 'help') {
      setQuery('ticket: client: project: asset: > / @ # $mine');
      return;
    }
    onClose();
  };

  const placeholder = mode === 'fulltext'
    ? t('commandPalette.placeholderFulltext', { defaultValue: 'Search records, comments, documents…' })
    : t('commandPalette.placeholder', { defaultValue: 'Search navigation and actions' });

  return (
    <Dialog
      id="command-palette"
      isOpen={open}
      onClose={onClose}
      title={t('commandPalette.title', { defaultValue: 'Command Palette' })}
      className="max-w-2xl"
      hideCloseButton
    >
      <DialogContent>
        <div className="space-y-3">
          <div
            id="command-palette-mode-toggle"
            role="tablist"
            aria-label={t('commandPalette.modes.ariaLabel', { defaultValue: 'Search mode' })}
            className="inline-flex rounded-md border border-[rgb(var(--color-border-200))] p-0.5 text-xs"
          >
            <button
              id="command-palette-mode-navigation"
              type="button"
              role="tab"
              aria-selected={mode === 'navigation'}
              onClick={() => setMode('navigation')}
              className={`flex items-center gap-1 rounded px-2 py-1 transition-colors ${
                mode === 'navigation'
                  ? 'bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-700))]'
                  : 'text-[rgb(var(--color-text-500))] hover:text-[rgb(var(--color-text-700))]'
              }`}
            >
              <Compass className="h-3.5 w-3.5" aria-hidden="true" />
              {t('commandPalette.modes.navigation', { defaultValue: 'Navigation' })}
            </button>
            <button
              id="command-palette-mode-fulltext"
              type="button"
              role="tab"
              aria-selected={mode === 'fulltext'}
              onClick={() => setMode('fulltext')}
              className={`flex items-center gap-1 rounded px-2 py-1 transition-colors ${
                mode === 'fulltext'
                  ? 'bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-700))]'
                  : 'text-[rgb(var(--color-text-500))] hover:text-[rgb(var(--color-text-700))]'
              }`}
            >
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              {t('commandPalette.modes.fulltext', { defaultValue: 'Full text' })}
            </button>
          </div>
          <Input
            ref={inputRef}
            id="command-palette-input"
            role="combobox"
            aria-expanded={open}
            aria-controls="command-palette-results"
            aria-activedescendant={activeDescendant}
            aria-autocomplete="list"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((current) => Math.min(current + 1, results.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((current) => Math.max(current - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                activate(activeResult);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              } else if ((event.metaKey || event.ctrlKey) && event.key === '/') {
                event.preventDefault();
                setMode((current) => (current === 'navigation' ? 'fulltext' : 'navigation'));
              }
            }}
            placeholder={placeholder}
          />
          <div className="text-xs text-muted-foreground" aria-live="polite">
            {mode === 'fulltext' && isSearching
              ? t('commandPalette.loading', { defaultValue: 'Searching…' })
              : mode === 'fulltext' && query.trim().length < 2
                ? t('commandPalette.fulltextHint', { defaultValue: 'Type at least 2 characters to search records.' })
                : t('commandPalette.resultCount', { count: results.length, defaultValue: '{{count}} results' })}
          </div>
          <div id="command-palette-results" role="listbox" className="max-h-80 overflow-y-auto rounded-md border">
            {results.map((result, index) => (
              <button
                key={result.id}
                id={`command-palette-result-${result.id.replace(/[^a-z0-9]+/gi, '-')}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${index === activeIndex ? 'bg-muted' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => activate(result)}
              >
                <span>
                  <span className="block font-medium">{result.label}</span>
                  {result.description ? <span className="block text-xs text-muted-foreground">{result.description}</span> : null}
                </span>
                <span className="text-xs uppercase text-muted-foreground">
                  {t(`commandPalette.types.${result.type}`, { defaultValue: result.type })}
                </span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Kbd binding="mod+shift+k" />
            <Kbd binding="mod+/" />
            <span>
              {mode === 'navigation'
                ? t('commandPalette.syntax.inlineHelp', { defaultValue: 'Use /nav for navigation or >action for actions.' })
                : t('commandPalette.fulltextInlineHelp', { defaultValue: 'Searching across records, comments, and documents.' })}
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
