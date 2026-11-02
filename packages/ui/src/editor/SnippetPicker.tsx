'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { Input } from '../components/Input';
import {
  buildSnippetSections,
  filterSnippets,
  flattenSnippetSections,
  type EditorSnippet,
  type EditorSnippetsConfig,
} from './snippets';

const SEARCH_DEBOUNCE_MS = 200;

export interface SnippetPickerProps {
  isOpen: boolean;
  config: EditorSnippetsConfig;
  onClose: () => void;
  /** Resolves once the snippet is in the editor; the picker stays open (with an error) if it rejects. */
  onPick: (snippet: EditorSnippet) => Promise<void>;
}

/**
 * Searchable, keyboard-navigable snippet list: favourites, then recents, then categories.
 * Focus stays in the search input; Up/Down move the highlight (aria-activedescendant), Enter inserts.
 */
export function SnippetPicker({ isOpen, config, onClose, onPick }: SnippetPickerProps) {
  const { labels } = config;
  const prefix = config.idPrefix ?? 'snippet-picker';
  const [library, setLibrary] = useState<EditorSnippet[]>([]);
  const [remote, setRemote] = useState<EditorSnippet[] | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [inserting, setInserting] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Load fresh data each time the picker opens.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setQuery('');
    setRemote(null);
    setError(null);
    setActive(0);
    setLoading(true);
    config
      .load()
      .then((items) => !cancelled && setLibrary(items))
      .catch(() => !cancelled && setError(labels.loadFailed))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Optional server-side search, debounced; stale responses are dropped.
  useEffect(() => {
    if (!isOpen || !config.search || !query.trim()) {
      setRemote(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      config.search!(query.trim())
        .then((items) => !cancelled && setRemote(items))
        .catch(() => !cancelled && setError(labels.loadFailed));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, query]);

  const visible = useMemo(() => {
    const base = remote ?? filterSnippets(library, query);
    // While searching, relevance beats grouping: keep one flat section in server/library order.
    return query.trim() ? [{ key: 'category' as const, category: null, items: base, flat: true }] : buildSnippetSections(base).map((s) => ({ ...s, flat: false }));
  }, [library, remote, query]);
  const flat = useMemo(() => flattenSnippetSections(visible), [visible]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-active="true"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, flat]);

  const pick = useCallback(
    async (snippet: EditorSnippet | undefined) => {
      if (!snippet || inserting) return;
      setInserting(true);
      setError(null);
      try {
        await onPick(snippet);
      } catch {
        setError(labels.insertFailed);
      } finally {
        setInserting(false);
      }
    },
    [inserting, onPick, labels.insertFailed]
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(flat.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Home' && event.ctrlKey) {
      setActive(0);
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void pick(flat[active]);
    }
  };

  const sectionTitle = (key: string, category: string | null) =>
    key === 'favorites' ? labels.favorites : key === 'recent' ? labels.recent : category ?? labels.uncategorized;

  const optionId = (index: number) => `${prefix}-option-${index}`;
  let running = -1;

  return (
    <Dialog
      id={`${prefix}-dialog`}
      isOpen={isOpen}
      onClose={onClose}
      title={labels.title}
      forceModal
      className="max-w-xl"
    >
      <div onKeyDown={onKeyDown}>
        <Input
          id={`${prefix}-search`}
          type="search"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={labels.searchPlaceholder}
          aria-label={labels.searchLabel}
          role="combobox"
          aria-expanded
          aria-controls={`${prefix}-listbox`}
          aria-activedescendant={flat.length ? optionId(active) : undefined}
          autoComplete="off"
        />
        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <div
          ref={listRef}
          id={`${prefix}-listbox`}
          role="listbox"
          aria-label={labels.title}
          aria-busy={loading}
          className="mt-3 max-h-[50vh] overflow-y-auto"
        >
          {loading ? (
            <p className="p-3 text-sm text-[rgb(var(--color-text-500))]">{labels.loading}</p>
          ) : flat.length === 0 ? (
            <p className="p-3 text-sm text-[rgb(var(--color-text-500))]">{query.trim() ? labels.noResults : labels.empty}</p>
          ) : (
            visible.map((section, sectionIndex) => (
              <div key={`${section.key}-${section.category ?? ''}-${sectionIndex}`} role="group" aria-label={section.flat ? undefined : sectionTitle(section.key, section.category)}>
                {!section.flat && (
                  <div className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-[rgb(var(--color-text-500))]">
                    {sectionTitle(section.key, section.category)}
                  </div>
                )}
                {section.items.map((snippet) => {
                  running += 1;
                  const index = running;
                  const isActive = index === active;
                  return (
                    <div
                      key={snippet.id}
                      id={optionId(index)}
                      role="option"
                      aria-selected={isActive}
                      data-active={isActive}
                      data-automation-id={`${prefix}-option-${snippet.id}`}
                      className={`cursor-pointer rounded-md px-3 py-2 ${isActive ? 'bg-[rgb(var(--color-primary-50))]' : 'hover:bg-[rgb(var(--color-border-100))]'}`}
                      onMouseMove={() => setActive(index)}
                      onClick={() => void pick(snippet)}
                    >
                      <div className="text-sm font-medium text-[rgb(var(--color-text-900))]">{snippet.title}</div>
                      {snippet.preview && (
                        <div className="truncate text-xs text-[rgb(var(--color-text-500))]">{snippet.preview}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </Dialog>
  );
}

export default SnippetPicker;
