// Editor "snippets": a host-supplied library of reusable content the TextEditor can insert from a slash
// command, a keyboard shortcut and a toolbar button. The editor knows nothing about what a snippet is;
// the host (canned ticket responses today) supplies how to load, search and resolve them. That keeps
// packages/ui free of any dependency on feature packages.

import type { PartialBlock } from '@blocknote/core';

export interface EditorSnippet {
  id: string;
  title: string;
  /** Folder/category label; snippets without one are grouped as "uncategorized". */
  category?: string | null;
  /** Short plain-text preview shown under the title. */
  preview?: string;
  isFavorite?: boolean;
  /** ISO timestamp of the user's last use; drives the "recent" group. */
  lastUsedAt?: string | null;
}

export interface EditorSnippetLabels {
  /** Toolbar button text and the picker's dialog title. */
  button: string;
  /** Toolbar button tooltip; mention the shortcut. */
  buttonTooltip: string;
  title: string;
  searchPlaceholder: string;
  searchLabel: string;
  loading: string;
  empty: string;
  noResults: string;
  loadFailed: string;
  insertFailed: string;
  favorites: string;
  recent: string;
  uncategorized: string;
  /** Slash-menu group heading. */
  slashGroup: string;
  /** Slash-menu entry that opens the full picker. */
  slashBrowse: string;
  slashBrowseHint: string;
}

export interface EditorSnippetsConfig {
  labels: EditorSnippetLabels;
  /** Loads the library. Called each time the picker or slash menu needs fresh data. */
  load: () => Promise<EditorSnippet[]>;
  /**
   * Optional server-side search for libraries too large to hold in the browser. When absent the picker
   * filters what `load` returned.
   */
  search?: (query: string) => Promise<EditorSnippet[]>;
  /** Produces the blocks to insert (merge fields already resolved). Throw to report a failure. */
  resolve: (snippet: EditorSnippet) => Promise<PartialBlock[]>;
  /** Called after a successful insert (records recents). Failures are the host's to swallow. */
  onInserted?: (snippet: EditorSnippet) => void | Promise<void>;
  /** Stable prefix for ids/automation ids of the picker controls. */
  idPrefix?: string;
}

export type SnippetSectionKey = 'favorites' | 'recent' | 'category';

export interface SnippetSection {
  key: SnippetSectionKey;
  /** Set for category sections; null for the uncategorized bucket. */
  category: string | null;
  items: EditorSnippet[];
}

const RECENT_LIMIT = 5;

function matches(snippet: EditorSnippet, needle: string): boolean {
  return (
    snippet.title.toLowerCase().includes(needle) ||
    (snippet.category ?? '').toLowerCase().includes(needle) ||
    (snippet.preview ?? '').toLowerCase().includes(needle)
  );
}

/** Filters by a case-insensitive substring over title, category and preview. Empty query keeps all. */
export function filterSnippets(snippets: readonly EditorSnippet[], query: string): EditorSnippet[] {
  const needle = query.trim().toLowerCase();
  return needle ? snippets.filter((snippet) => matches(snippet, needle)) : [...snippets];
}

/**
 * Orders snippets for display: favourites first, then the most recently used (not already shown as a
 * favourite), then everything else grouped by category (alphabetical, uncategorized last). A snippet
 * appears in exactly one section, so the flat keyboard order has no duplicates.
 */
export function buildSnippetSections(snippets: readonly EditorSnippet[], recentLimit = RECENT_LIMIT): SnippetSection[] {
  const byTitle = (a: EditorSnippet, b: EditorSnippet) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  const favorites = snippets.filter((snippet) => snippet.isFavorite).sort(byTitle);
  const used = new Set(favorites.map((snippet) => snippet.id));

  const recent = snippets
    .filter((snippet) => !used.has(snippet.id) && snippet.lastUsedAt)
    .sort((a, b) => (b.lastUsedAt as string).localeCompare(a.lastUsedAt as string))
    .slice(0, recentLimit);
  recent.forEach((snippet) => used.add(snippet.id));

  const rest = snippets.filter((snippet) => !used.has(snippet.id));
  const categories = new Map<string, { label: string | null; items: EditorSnippet[] }>();
  for (const snippet of rest) {
    const label = snippet.category?.trim() || null;
    const key = label ? label.toLowerCase() : '\u0000';
    const bucket = categories.get(key) ?? { label, items: [] };
    bucket.items.push(snippet);
    categories.set(key, bucket);
  }

  const sections: SnippetSection[] = [];
  if (favorites.length) sections.push({ key: 'favorites', category: null, items: favorites });
  if (recent.length) sections.push({ key: 'recent', category: null, items: recent });
  Array.from(categories.values())
    .sort((a, b) => (a.label === null ? 1 : b.label === null ? -1 : a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })))
    .forEach((bucket) => sections.push({ key: 'category', category: bucket.label, items: bucket.items.sort(byTitle) }));
  return sections;
}

/** Flattens sections in display order; the keyboard cursor indexes into this. */
export function flattenSnippetSections(sections: readonly SnippetSection[]): EditorSnippet[] {
  return sections.flatMap((section) => section.items);
}

/** Drops block ids (recursively) so an inserted copy never collides with the editor's own ids. */
export function stripBlockIds<T>(blocks: T): T {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const next: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === 'id' && typeof value === 'string' && 'type' in (node as object) && 'children' in (node as object)) continue;
        next[key] = walk(value);
      }
      return next;
    }
    return node;
  };
  return walk(blocks) as T;
}
