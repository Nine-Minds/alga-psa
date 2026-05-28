'use client';

import React, { useEffect, useRef, useState, useTransition } from 'react';
import { Command } from 'cmdk';
import { Search } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useAriaKeyShortcuts, useCatalogShortcut } from '@alga-psa/ui/keyboard-shortcuts';

import {
  searchAppTypeaheadAction,
  type SearchResultRow,
} from '@/lib/actions/searchActions';
import { CommandPalette } from './CommandPalette';

function toDomIdPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

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
  const [totalCount, setTotalCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [focusAfterExpand, setFocusAfterExpand] = useState(false);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);
  const trimmedQuery = query.trim();
  const isOpen = !collapsed && trimmedQuery.length >= 2 && !isDismissed;
  const visibleResults = results.slice(0, 5);
  const optionCount = isOpen ? visibleResults.length + 1 : 0;
  const seeAllUrl = `/msp/search?q=${encodeURIComponent(trimmedQuery)}`;
  const activeDescendantId = activeIndex >= 0
    ? activeIndex < visibleResults.length
      ? `app-search-option-${toDomIdPart(visibleResults[activeIndex].type)}-${toDomIdPart(visibleResults[activeIndex].id)}`
      : 'app-search-option-see-all-results'
    : undefined;
  const searchAriaShortcut = useAriaKeyShortcuts('global.search');

  const focusSearchInput = React.useCallback(() => {
    if (collapsed) {
      setFocusAfterExpand(true);
      onCollapsedClick?.();
      return;
    }

    inputRef.current?.focus();
    inputRef.current?.select();
  }, [collapsed, onCollapsedClick]);

  const openCommandPalette = React.useCallback(() => {
    setIsCommandPaletteOpen(true);
  }, []);

  useCatalogShortcut('global.search', focusSearchInput);
  useCatalogShortcut('global.commandPalette', openCommandPalette);

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
      setTotalCount(0);
      setActiveIndex(-1);
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
            setTotalCount(response.totalCount);
            setActiveIndex(-1);
          }
        } catch (error) {
          console.error('search.typeahead_failed', error);
          if (requestIdRef.current === requestId) {
            setResults([]);
            setTotalCount(0);
            setActiveIndex(-1);
          }
        }
      });
    }, 200);

    return () => window.clearTimeout(timer);
  }, [trimmedQuery]);

  const navigateToActiveOption = () => {
    if (!trimmedQuery) {
      return;
    }

    if (activeIndex >= 0 && activeIndex < visibleResults.length) {
      window.location.assign(visibleResults[activeIndex].url);
      return;
    }

    window.location.assign(seeAllUrl);
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      if (optionCount === 0) {
        return;
      }
      event.preventDefault();
      setActiveIndex((current) => (current >= optionCount - 1 ? -1 : current + 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      if (optionCount === 0) {
        return;
      }
      event.preventDefault();
      setActiveIndex((current) => {
        if (current === -1) {
          return optionCount - 1;
        }
        if (current === 0) {
          return -1;
        }
        return current - 1;
      });
      return;
    }

    if (event.key === 'Escape') {
      if (!isOpen) {
        return;
      }
      event.preventDefault();
      setResults([]);
      setTotalCount(0);
      setActiveIndex(-1);
      setIsDismissed(true);
      return;
    }

    if (event.key === 'Enter') {
      if (!trimmedQuery) {
        return;
      }
      event.preventDefault();
      navigateToActiveOption();
    }
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setIsDismissed(false);
  };

  if (collapsed) {
    return (
      <>
        <CommandPalette open={isCommandPaletteOpen} onClose={() => setIsCommandPaletteOpen(false)} />
        <button
          id="app-search-collapsed-button"
          type="button"
          onClick={onCollapsedClick}
          className="mx-3 my-3 flex h-10 w-10 items-center justify-center rounded-md border border-gray-500/70 bg-white/10 text-gray-300 hover:bg-white/15"
          aria-label={t('search.placeholder')}
        >
          <Search className="h-5 w-5" aria-hidden="true" />
        </button>
      </>
    );
  }

  return (
    <div className="px-4 py-2">
      <CommandPalette open={isCommandPaletteOpen} onClose={() => setIsCommandPaletteOpen(false)} />
      <Command shouldFilter={false} className="relative">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <Command.Input
            ref={inputRef}
            id="app-search-input"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={isOpen}
            aria-controls="app-search-typeahead-list"
            aria-activedescendant={activeDescendantId}
            aria-keyshortcuts={searchAriaShortcut}
            value={query}
            onValueChange={handleQueryChange}
            onKeyDown={handleInputKeyDown}
            placeholder={t('search.placeholder')}
            className="h-10 w-full rounded-md border border-gray-500/70 bg-white/10 py-2 pl-8 pr-3 text-sm text-sidebar-text outline-none placeholder:text-gray-400 focus:border-primary-400 focus:ring-2 focus:ring-primary-500/30"
          />
        </div>
        {isOpen && (
          <Command.List
            id="app-search-typeahead-list"
            className="absolute left-0 right-0 top-11 z-50 max-h-72 overflow-y-auto rounded-md border border-gray-700 bg-subMenu-bg p-1 text-sm text-subMenu-text shadow-xl"
          >
            {isPending && (
              <Command.Loading className="px-3 py-2 text-gray-400">
                {t('search.loading')}
              </Command.Loading>
            )}
            {isPending ? null : visibleResults.map((result, index) => (
              <Command.Item
                key={`${result.type}-${result.id}`}
                value={`${result.type}-${result.id}`}
                asChild
              >
                <a
                  id={`app-search-option-${toDomIdPart(result.type)}-${toDomIdPart(result.id)}`}
                  data-result-row-id={`app-search-result-row-${toDomIdPart(result.type)}-${toDomIdPart(result.id)}`}
                  href={result.url}
                  className={`block cursor-pointer rounded px-3 py-2 aria-selected:bg-white/10 ${
                    activeIndex === index ? 'bg-white/10' : ''
                  }`}
                >
                  <span className="block truncate">{result.title}</span>
                </a>
              </Command.Item>
            ))}
            {!isPending && (
              <Command.Item value="see-all-results" asChild>
                <a
                  id="app-search-option-see-all-results"
                  href={seeAllUrl}
                  className={`mt-1 block cursor-pointer rounded border-t border-gray-700 px-3 py-2 text-primary-300 aria-selected:bg-white/10 ${
                    activeIndex === visibleResults.length ? 'bg-white/10' : ''
                  }`}
                >
                  {t('search.seeAllResults', {
                    count: totalCount,
                  })}
                </a>
              </Command.Item>
            )}
          </Command.List>
        )}
      </Command>
    </div>
  );
}
