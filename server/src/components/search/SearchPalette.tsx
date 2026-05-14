'use client';

import React, { useEffect, useRef, useState, useTransition } from 'react';
import { Command } from 'cmdk';
import { Search } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

import {
  searchAppTypeaheadAction,
  type SearchResultRow,
} from '@/lib/actions/searchActions';

interface SearchPaletteProps {
  collapsed?: boolean;
  onCollapsedClick?: () => void;
}

export default function SearchPalette({
  collapsed = false,
  onCollapsedClick,
}: SearchPaletteProps): React.JSX.Element {
  const { t } = useTranslation('msp/core');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultRow[]>([]);
  const [focusAfterExpand, setFocusAfterExpand] = useState(false);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);
  const trimmedQuery = query.trim();
  const isOpen = !collapsed && trimmedQuery.length >= 2;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || (!event.metaKey && !event.ctrlKey)) {
        return;
      }

      event.preventDefault();
      if (collapsed) {
        setFocusAfterExpand(true);
        onCollapsedClick?.();
        return;
      }

      inputRef.current?.focus();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [collapsed, onCollapsedClick]);

  useEffect(() => {
    if (collapsed || !focusAfterExpand) {
      return;
    }

    inputRef.current?.focus();
    setFocusAfterExpand(false);
  }, [collapsed, focusAfterExpand]);

  useEffect(() => {
    if (trimmedQuery.length < 2) {
      setResults([]);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const timer = window.setTimeout(() => {
      startTransition(async () => {
        try {
          const response = await searchAppTypeaheadAction({ query: trimmedQuery });
          if (requestIdRef.current === requestId) {
            setResults(response.results);
          }
        } catch (error) {
          console.error('Failed to load app search suggestions', error);
          if (requestIdRef.current === requestId) {
            setResults([]);
          }
        }
      });
    }, 200);

    return () => window.clearTimeout(timer);
  }, [trimmedQuery]);

  if (collapsed) {
    return (
      <button
        id="app-search-collapsed-button"
        type="button"
        onClick={onCollapsedClick}
        className="mx-3 my-3 flex h-10 w-10 items-center justify-center rounded-md border border-gray-500/70 bg-white/10 text-gray-300 hover:bg-white/15"
        aria-label={t('search.placeholder', { defaultValue: 'Search' })}
      >
        <Search className="h-5 w-5" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className="px-3 py-3">
      <Command shouldFilter={false} className="relative">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <Command.Input
            ref={inputRef}
            id="app-search-input"
            value={query}
            onValueChange={setQuery}
            placeholder={t('search.placeholder', { defaultValue: 'Search' })}
            className="h-10 w-full rounded-md border border-gray-500/70 bg-white/10 py-2 pl-8 pr-3 text-sm text-sidebar-text outline-none placeholder:text-gray-400 focus:border-purple-400 focus:ring-2 focus:ring-purple-500/30"
          />
        </div>
        {isOpen && (
          <Command.List className="absolute left-0 right-0 top-11 z-50 max-h-72 overflow-y-auto rounded-md border border-gray-700 bg-subMenu-bg p-1 text-sm text-subMenu-text shadow-xl">
            {isPending && (
              <Command.Loading className="px-3 py-2 text-gray-400">
                {t('search.loading', { defaultValue: 'Searching...' })}
              </Command.Loading>
            )}
            {!isPending && results.length === 0 ? null : results.slice(0, 5).map((result) => (
              <Command.Item
                key={`${result.type}-${result.id}`}
                value={`${result.type}-${result.id}`}
                asChild
              >
                <a
                  id={`app-search-result-row-${result.type}-${result.id}`}
                  href={result.url}
                  className="block cursor-pointer rounded px-3 py-2 aria-selected:bg-white/10"
                >
                  <span className="block truncate">{result.title}</span>
                </a>
              </Command.Item>
            ))}
          </Command.List>
        )}
      </Command>
    </div>
  );
}
