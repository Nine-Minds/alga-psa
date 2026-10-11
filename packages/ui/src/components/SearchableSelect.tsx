'use client'

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Command } from 'cmdk';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './Button';
import { FormFieldComponent, AutomationProps } from '../ui-reflection/types';
import { useAutomationIdAndRegister } from '../ui-reflection/useAutomationIdAndRegister';
import { useTranslation } from '../lib/i18n/client';

export interface SelectOption {
  value: string;
  label: string;
  /** Muted second line under the label; omit to keep the row single-line. */
  secondaryLabel?: string;
  /** Extra text that search matches but that is never shown (codes, synonyms, descriptions). */
  keywords?: string;
  /**
   * Heading the option is listed under (e.g. the step a field comes from). Options of one group are
   * listed together, groups in order of first appearance; options without a group get no heading.
   */
  group?: string;
  /** Shorter text for the closed control when this option is selected; defaults to `label`. */
  triggerLabel?: string;
}

type SelectSize = 'sm' | 'md' | 'lg';

const sizeClasses: Record<SelectSize, string> = {
  sm: 'h-8 text-xs px-2',
  md: 'h-10 text-sm px-4',
  lg: 'h-12 text-base px-4',
};

interface SearchableSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  label?: string;
  /** Unique identifier for UI reflection system */
  id?: string;
  /** Whether the select is required */
  required?: boolean;
  /** Empty message to display when no options match the search */
  emptyMessage?: string;
  /**
   * How the dropdown is rendered.
   * - `inline`: renders an absolutely-positioned dropdown in-flow (may be clipped by overflow containers).
   * - `overlay`: renders a positioned dropdown in a portal (helps avoid clipping).
   */
  dropdownMode?: 'inline' | 'overlay';
  /** Placeholder text for the search input */
  searchPlaceholder?: string;
  /** Auto-focus the search input when opening */
  autoFocusSearch?: boolean;
  /** Max height for the option list */
  maxListHeight?: string;
  /**
   * Optional portal container for `dropdownMode="overlay"`.
   * If omitted, the component will portal into the nearest dialog (role="dialog") if present, otherwise document.body.
   */
  portalContainer?: Element | null;
  /** Size variant for the select trigger */
  size?: SelectSize;
  /** Allow selecting a typed value that does not already exist in the options list */
  allowCustomValue?: boolean;
  /** Customize the label shown for the create/use-typed-value option */
  customValueLabel?: (value: string) => string;
  /** Start with the list open (e.g. a row just added so its first job is choosing). */
  defaultOpen?: boolean;
  /**
   * Minimum width of an overlay dropdown in px. Long option labels in a narrow control stay
   * readable: the list grows past the trigger and is kept inside the viewport.
   */
  dropdownMinWidth?: number;
}

function normalizeOptionText(value: string): string {
  return value.trim().toLowerCase();
}

const SEARCH_RANK_NONE = Number.POSITIVE_INFINITY;

/**
 * How well an option matches a search; lower is better, Infinity means no match. The label counts
 * most (exact, then starts with, then a word starting with the search, then anywhere, then every
 * search word somewhere in it), then the second line, then hidden keywords.
 */
export function getSearchableSelectRank(option: SelectOption, search: string): number {
  const searchLower = search.trim().toLowerCase();
  if (!searchLower) return 0;
  const searchWords = searchLower.split(/\s+/).filter(Boolean);
  const label = option.label.toString().toLowerCase();
  const containsAllWords = (text: string) => searchWords.every((word) => text.includes(word));

  if (label === searchLower) return 0;
  if (label.startsWith(searchLower)) return 1;
  if (new RegExp(`(^|[^a-z0-9])${searchLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(label)) return 2;
  if (label.includes(searchLower)) return 3;
  if (searchWords.length > 1 && containsAllWords(label)) return 4;

  const secondary = (option.secondaryLabel ?? '').toLowerCase();
  if (secondary.includes(searchLower) || (searchWords.length > 1 && containsAllWords(`${label}\n${secondary}`))) return 5;

  const haystack = `${label}\n${secondary}\n${(option.keywords ?? '').toLowerCase()}`;
  if (haystack.includes(searchLower) || (searchWords.length > 1 && containsAllWords(haystack))) return 6;
  return SEARCH_RANK_NONE;
}

/**
 * Splits options into runs listed under one heading each: every option of a group goes with the
 * group's first option, so groups keep the order in which they first appear (by search rank while
 * searching). Ungrouped options form runs without a heading.
 */
export function groupSearchableSelectOptions(
  options: SelectOption[]
): Array<{ group?: string; options: SelectOption[] }> {
  if (!options.some((option) => option.group)) return [{ options }];
  const runs: Array<{ group?: string; options: SelectOption[] }> = [];
  const runByGroup = new Map<string, { group?: string; options: SelectOption[] }>();
  for (const option of options) {
    if (!option.group) {
      const last = runs[runs.length - 1];
      if (last && !last.group) last.options.push(option);
      else runs.push({ options: [option] });
      continue;
    }
    const existing = runByGroup.get(option.group);
    if (existing) {
      existing.options.push(option);
      continue;
    }
    const run = { group: option.group, options: [option] };
    runByGroup.set(option.group, run);
    runs.push(run);
  }
  return runs;
}

/** Options matching a search, best match first; equally good matches keep their original order. */
export function rankSearchableSelectOptions(options: SelectOption[], search: string): SelectOption[] {
  if (!search.trim()) return options;
  return options
    .map((option, index) => ({ option, index, rank: getSearchableSelectRank(option, search) }))
    .filter((entry) => entry.rank !== SEARCH_RANK_NONE)
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((entry) => entry.option);
}

const OVERLAY_GAP = 4;
const OVERLAY_VIEWPORT_GUTTER = 8;
/** Search row above the list: input height plus its border. */
const OVERLAY_SEARCH_ROW = 44;
/** Below this much room the list is too short to pick from, so flipping wins. */
const OVERLAY_MIN_USEFUL_HEIGHT = 220;
const OVERLAY_MIN_LIST_HEIGHT = 96;

/** `maxListHeight` (`15rem`, `240px`, …) in px; falls back to 240 for anything else. */
export function parseOverlayListHeight(maxListHeight: string): number {
  const match = /^([\d.]+)\s*(px|rem|em)?$/.exec(maxListHeight.trim());
  if (!match) return 240;
  const amount = Number.parseFloat(match[1]);
  if (!Number.isFinite(amount)) return 240;
  return match[2] === 'rem' || match[2] === 'em' ? amount * 16 : amount;
}

/**
 * Where an overlay dropdown goes vertically. It opens below the trigger as long as the list is
 * usable there; when the viewport is too short (a picker low in a side panel) it flips above
 * instead of running off the bottom edge, and the list is capped to the room it actually has.
 */
export function resolveOverlayVerticalFit({
  triggerTop,
  triggerBottom,
  viewportHeight,
  preferredListHeight,
}: {
  triggerTop: number;
  triggerBottom: number;
  viewportHeight: number;
  preferredListHeight: number;
}): { placement: 'below' | 'above'; listMaxHeight: number } {
  const spaceBelow = viewportHeight - triggerBottom - OVERLAY_GAP - OVERLAY_VIEWPORT_GUTTER;
  const spaceAbove = triggerTop - OVERLAY_GAP - OVERLAY_VIEWPORT_GUTTER;
  const neededBelow = Math.min(preferredListHeight + OVERLAY_SEARCH_ROW, OVERLAY_MIN_USEFUL_HEIGHT);
  const placement = spaceBelow >= neededBelow || spaceBelow >= spaceAbove ? 'below' : 'above';
  const space = placement === 'below' ? spaceBelow : spaceAbove;

  return {
    placement,
    listMaxHeight: Math.max(
      OVERLAY_MIN_LIST_HEIGHT,
      Math.min(preferredListHeight, space - OVERLAY_SEARCH_ROW)
    ),
  };
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  className = '',
  disabled = false,
  label,
  id,
  required = false,
  emptyMessage,
  dropdownMode = 'inline',
  searchPlaceholder,
  autoFocusSearch = true,
  maxListHeight = '15rem',
  portalContainer,
  size = 'md',
  allowCustomValue = false,
  customValueLabel,
  defaultOpen = false,
  dropdownMinWidth,
}: SearchableSelectProps & AutomationProps): React.JSX.Element {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('form.selectPlaceholder', { defaultValue: 'Select...' });
  const resolvedEmptyMessage = emptyMessage ?? t('form.noResults', { defaultValue: 'No results found' });
  const [open, setOpen] = useState(defaultOpen && !disabled);
  const [search, setSearch] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [overlayPosition, setOverlayPosition] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    listMaxHeight: number;
  } | null>(null);
  const [announce, setAnnounce] = useState('');

  // Memoize the mapped options to prevent recreating on every render
  const mappedOptions = useMemo(() => options.map((opt: SelectOption): { value: string; label: string } => ({
    value: opt.value,
    label: typeof opt.label === 'string' ? opt.label : 'Complex Label'
  })), [options]);

  const { automationIdProps, updateMetadata } = useAutomationIdAndRegister<FormFieldComponent>({
    type: 'formField',
    fieldType: 'select',
    id: id,
    label,
    value: value || '',
    disabled,
    required,
    options: mappedOptions
  });

  // Update metadata when field props change
  useEffect(() => {
    if (updateMetadata) {
      updateMetadata({
        value: value || '',
        label,
        disabled,
        required,
        options: mappedOptions
      });
    }
  }, [value, disabled, label, required, mappedOptions, updateMetadata]);

  // Filter options based on search. An option matches when its label, secondary line, or keywords
  // contain the whole search, or contain every word of it (in any order).
  const filteredOptions = useMemo(() => {
    if (!search) return options;

    return rankSearchableSelectOptions(options, search);
  }, [options, search]);

  const normalizedSearch = search.trim();
  const hasExactOptionMatch = useMemo(() => {
    if (!normalizedSearch) {
      return false;
    }

    const normalized = normalizeOptionText(normalizedSearch);
    return options.some((option: SelectOption) => (
      normalizeOptionText(option.label) === normalized ||
      normalizeOptionText(option.value) === normalized
    ));
  }, [normalizedSearch, options]);

  const showCustomValueOption = allowCustomValue && Boolean(normalizedSearch) && !hasExactOptionMatch;

  // Find the selected option label
  const selectedOption = options.find((option: SelectOption) => option.value === value);
  const labelId = label ? `${automationIdProps.id}-label` : undefined;
  const listboxId = `${automationIdProps.id}-listbox`;
  const inputId = `${automationIdProps.id}-search`;

  const resolvedSearchPlaceholder =
    searchPlaceholder ?? t('form.searchPlaceholder', { defaultValue: 'Search...' });

  const getResolvedPortalContainer = useCallback((): Element | null => {
    if (typeof document === 'undefined') return null;
    if (portalContainer) return portalContainer;
    const trigger = triggerRef.current;
    const dialog = trigger?.closest?.('[role="dialog"]');
    return dialog ?? document.body;
  }, [portalContainer]);

  const updateOverlayPosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const container = getResolvedPortalContainer();
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : rect.right;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : rect.bottom;
    const gutter = OVERLAY_VIEWPORT_GUTTER;
    // At least the trigger's width, wider when asked, never wider than the viewport.
    const width = Math.min(Math.max(rect.width, dropdownMinWidth ?? 0), Math.max(rect.width, viewportWidth - gutter * 2));
    // Grow leftwards when the wider list would run off the right edge.
    const viewportLeft = Math.max(gutter, Math.min(rect.left, viewportWidth - gutter - width));
    // Open upwards instead of off the bottom edge when the viewport is short.
    const { placement, listMaxHeight } = resolveOverlayVerticalFit({
      triggerTop: rect.top,
      triggerBottom: rect.bottom,
      viewportHeight,
      preferredListHeight: parseOverlayListHeight(maxListHeight),
    });

    if (!container || container === document.body) {
      setOverlayPosition({
        ...(placement === 'below'
          ? { top: rect.bottom + OVERLAY_GAP }
          : { bottom: viewportHeight - rect.top + OVERLAY_GAP }),
        left: viewportLeft,
        width,
        listMaxHeight,
      });
      return;
    }

    const containerRect = container.getBoundingClientRect();
    setOverlayPosition({
      ...(placement === 'below'
        ? { top: rect.bottom - containerRect.top + OVERLAY_GAP }
        : { bottom: containerRect.bottom - rect.top + OVERLAY_GAP }),
      left: viewportLeft - containerRect.left,
      width,
      listMaxHeight,
    });
  }, [dropdownMinWidth, getResolvedPortalContainer, maxListHeight]);

  // Positioning for overlay dropdowns
  useEffect(() => {
    if (!open || disabled || dropdownMode !== 'overlay') return;
    updateOverlayPosition();

    const handle = () => updateOverlayPosition();
    window.addEventListener('resize', handle);
    window.addEventListener('scroll', handle, true);

    return () => {
      window.removeEventListener('resize', handle);
      window.removeEventListener('scroll', handle, true);
    };
  }, [open, disabled, dropdownMode, updateOverlayPosition]);

  // Click outside to close
  useEffect(() => {
    if (!open || disabled) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        contentRef.current &&
        !contentRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, disabled]);

  // Escape belongs to the top-most layer: while this dropdown is open it must
  // dismiss the list only. Radix dismissable layers (Dialog, Drawer) listen for
  // Escape on `document` in the capture phase, so a React handler on the input
  // or the trigger cannot stop them and the surrounding dialog closed too -
  // taking any unsaved edits with it. A window-capture listener runs first.
  useEffect(() => {
    if (!open || disabled) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };

    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [open, disabled]);

  // Clear search when closing
  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  useEffect(() => {
    if (selectedOption) {
      setAnnounce(`Selected ${selectedOption.label}`);
      return;
    }
    setAnnounce('');
  }, [selectedOption]);

  const dropdown = (
    <div
      ref={contentRef}
      className={cn(
        dropdownMode === 'overlay'
          ? 'bg-background dark:bg-[rgb(var(--color-card))] rounded-md shadow-lg border border-border dark:border-[rgb(var(--color-border-200))] overflow-hidden'
          : 'rounded-md border border-border dark:border-[rgb(var(--color-border-200))] bg-background dark:bg-[rgb(var(--color-card))] shadow-md overflow-hidden'
      )}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Command className="w-full h-full" shouldFilter={false}>
        <div className="flex items-center border-b px-3 py-2">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <Command.Input
            id={inputId}
            autoFocus={autoFocusSearch}
            value={search}
            onValueChange={setSearch}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setOpen(false);
              }
            }}
            className="flex h-9 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
            placeholder={resolvedSearchPlaceholder}
          />
        </div>
        <Command.List
          id={listboxId}
          role="listbox"
          aria-label={label ?? resolvedPlaceholder}
          className="overflow-y-auto p-1"
          style={{
            maxHeight:
              dropdownMode === 'overlay' && overlayPosition
                ? `${overlayPosition.listMaxHeight}px`
                : maxListHeight,
          }}
        >
          {filteredOptions.length > 0 ? (
            groupSearchableSelectOptions(filteredOptions).map((run, runIndex) => (
              <React.Fragment key={run.group ? `group:${run.group}` : `run:${runIndex}`}>
                {run.group && (
                  <div
                    role="presentation"
                    className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--color-text-400))]"
                  >
                    {run.group}
                  </div>
                )}
                {run.options.map((option: SelectOption) => (
              <Command.Item
                key={option.value}
                value={option.value}
                onSelect={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  'flex items-center px-2 py-1.5 text-sm rounded-sm cursor-pointer',
                  'hover:bg-muted',
                  'aria-selected:bg-muted',
                  value === option.value && 'bg-muted'
                )}
              >
                {option.secondaryLabel ? (
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{option.label}</span>
                    <span className="block truncate text-xs text-[rgb(var(--color-text-400))]">
                      {option.secondaryLabel}
                    </span>
                  </span>
                ) : (
                  <span className="flex-1">{option.label}</span>
                )}
                {value === option.value && (
                  <Check className="w-4 h-4 text-primary-600" />
                )}
              </Command.Item>
                ))}
              </React.Fragment>
            ))
          ) : (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {resolvedEmptyMessage}
            </div>
          )}
          {showCustomValueOption && (
            <Command.Item
              key={`custom-${normalizedSearch}`}
              value={`custom-${normalizedSearch}`}
              onSelect={() => {
                onChange(normalizedSearch);
                setOpen(false);
              }}
              className={cn(
                'mt-1 flex items-center px-2 py-1.5 text-sm rounded-sm cursor-pointer border-t border-border',
                'hover:bg-muted',
                'aria-selected:bg-muted'
              )}
            >
              <span className="flex-1">
                {customValueLabel ? customValueLabel(normalizedSearch) : `Use "${normalizedSearch}"`}
              </span>
            </Command.Item>
          )}
        </Command.List>
      </Command>
    </div>
  );

  return (
    <div className={label ? 'mb-4' : ''} data-automation-type="searchable-select">
      {label && (
        <label id={labelId} className="block text-sm font-medium text-foreground mb-1">
          {label}
        </label>
      )}

      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
      
      <div className="relative">
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          role="combobox"
          aria-controls={open ? listboxId : undefined}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby={labelId}
          aria-required={required}
          className={cn(
            "w-full justify-between",
            sizeClasses[size],
            disabled && "opacity-50 cursor-not-allowed",
            className
          )}
          onClick={() => !disabled && setOpen(!open)}
          onKeyDown={(e) => {
            if (disabled) return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setOpen(true);
            }
            if (e.key === 'Escape' && open) {
              e.preventDefault();
              setOpen(false);
            }
          }}
          disabled={disabled}
          {...automationIdProps}
        >
          <span className={cn("truncate", !selectedOption && "text-muted-foreground")}>
            {selectedOption ? selectedOption.triggerLabel ?? selectedOption.label : value || resolvedPlaceholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
        
        {open && !disabled && dropdownMode === 'inline' && (
          <div className="absolute z-50 w-full mt-1">
            {dropdown}
          </div>
        )}

        {open &&
          !disabled &&
          dropdownMode === 'overlay' &&
          overlayPosition &&
          typeof document !== 'undefined' &&
          (() => {
            const container = getResolvedPortalContainer();
            if (!container) return null;

            const overlayNode = (
              <div
                className="z-[99999]"
                style={{
                  position: container === document.body ? 'fixed' : 'absolute',
                  top: overlayPosition.top,
                  bottom: overlayPosition.bottom,
                  left: overlayPosition.left,
                  width: overlayPosition.width,
                  marginTop: 0,
                }}
              >
                {dropdown}
              </div>
            );

            return createPortal(overlayNode, container);
          })()}
      </div>
    </div>
  );
}

export default SearchableSelect;
