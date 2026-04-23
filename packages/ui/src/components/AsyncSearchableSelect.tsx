'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Command } from 'cmdk';
import { Check, ChevronsUpDown, Loader2, Search } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './Button';
import { FormFieldComponent, AutomationProps } from '../ui-reflection/types';
import { useAutomationIdAndRegister } from '../ui-reflection/useAutomationIdAndRegister';
import { useTranslation } from '../lib/i18n/client';

export interface SelectOption {
  value: string;
  label: string;
  badge?: {
    text: string;
    variant?: 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger';
  };
}

type LoadOptionsResult = {
  options: SelectOption[];
  total: number;
};

interface AsyncSearchableSelectProps {
  value: string;
  onChange: (value: string, option?: SelectOption) => void;
  loadOptions: (args: { search: string; page: number; limit: number }) => Promise<LoadOptionsResult>;
  limit?: number;
  placeholder?: string;
  selectedLabel?: string;
  className?: string;
  disabled?: boolean;
  label?: string;
  id?: string;
  required?: boolean;
  emptyMessage?: string;
  dropdownMode?: 'inline' | 'overlay';
  searchPlaceholder?: string;
  autoFocusSearch?: boolean;
  maxListHeight?: string;
  portalContainer?: Element | null;
  debounceMs?: number;
  showMoreIndicator?: boolean;
  /** Content rendered below the scrollable list, always visible (sticky footer). */
  footerContent?: (args: { search: string; close: () => void }) => React.ReactNode;
}

export function AsyncSearchableSelect({
  value,
  onChange,
  loadOptions,
  limit = 10,
  placeholder,
  selectedLabel,
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
  debounceMs = 300,
  showMoreIndicator = true,
  footerContent,
}: AsyncSearchableSelectProps & AutomationProps): React.JSX.Element {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('form.selectPlaceholder', { defaultValue: 'Select...' });
  const resolvedEmptyMessage = emptyMessage ?? t('form.noResults', { defaultValue: 'No results found' });
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<SelectOption[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const pageRef = useRef(1);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [overlayPosition, setOverlayPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  const selectedOption = useMemo(() => {
    if (!value) return undefined;
    return options.find((o) => o.value === value);
  }, [options, value]);

  const resolvedSearchPlaceholder =
    searchPlaceholder ?? t('form.searchPlaceholder', { defaultValue: 'Search...' });

  const { automationIdProps, updateMetadata } = useAutomationIdAndRegister<FormFieldComponent>({
    type: 'formField',
    fieldType: 'select',
    id,
    label,
    value: value || '',
    disabled,
    required,
    options,
  });

  useEffect(() => {
    if (!updateMetadata) return;
    updateMetadata({
      value: value || '',
      label,
      disabled,
      required,
      options,
    });
  }, [updateMetadata, value, disabled, label, required, options]);

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

    if (!container || container === document.body) {
      setOverlayPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
      return;
    }

    const containerRect = container.getBoundingClientRect();
    setOverlayPosition({
      top: rect.bottom - containerRect.top + 4,
      left: rect.left - containerRect.left,
      width: rect.width,
    });
  }, [getResolvedPortalContainer]);

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

  useEffect(() => {
    if (open) return;
    setSearch('');
    setLoadError(null);
  }, [open]);

  const fetchOptions = useCallback(
    async (term: string, page: number) => {
      if (page === 1) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      setLoadError(null);
      try {
        const result = await loadOptions({ search: term, page, limit });
        if (page === 1) {
          setOptions(result.options);
        } else {
          setOptions((prev) => [...prev, ...result.options]);
        }
        setTotal(result.total);
        pageRef.current = page;
      } catch (e) {
        console.error('[AsyncSearchableSelect] Failed to load options:', e);
        if (page === 1) {
          setOptions([]);
          setTotal(0);
        }
        setLoadError('Failed to load results');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [loadOptions, limit]
  );

  // Reset to page 1 when search term changes or dropdown opens
  useEffect(() => {
    if (!open || disabled) return;

    pageRef.current = 1;
    const t = window.setTimeout(() => {
      fetchOptions(search.trim(), 1);
    }, debounceMs);

    return () => window.clearTimeout(t);
  }, [open, disabled, search, debounceMs, fetchOptions]);

  const hasMore = showMoreIndicator && total > options.length;

  // Load next page on scroll to bottom (infinite scroll)
  const fetchNextPage = useCallback(() => {
    if (loadingMore || loading || !hasMore) return;
    fetchOptions(search.trim(), pageRef.current + 1);
  }, [loadingMore, loading, hasMore, search, fetchOptions]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !open) return;

    // Command.List may wrap content in a nested scrollable div
    const scrollEl = list.querySelector('[role="listbox"]')?.parentElement ?? list;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollEl;
      if (scrollHeight - scrollTop - clientHeight < 40) {
        fetchNextPage();
      }
    };

    scrollEl.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollEl.removeEventListener('scroll', handleScroll);
  }, [open, fetchNextPage]);

  const dropdown = (
    <div
      ref={contentRef}
      className={cn(
        dropdownMode === 'overlay'
          ? 'bg-white dark:bg-[rgb(var(--color-card))] rounded-md shadow-lg border border-gray-200 dark:border-[rgb(var(--color-border-200))] overflow-hidden'
          : 'rounded-md border border-gray-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] shadow-md overflow-hidden'
      )}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Command className="w-full h-full" shouldFilter={false}>
        <div className="flex items-center border-b px-3 py-2">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <Command.Input
            autoFocus={autoFocusSearch}
            value={search}
            onValueChange={setSearch}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setOpen(false);
              }
            }}
            className="flex h-9 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-[rgb(var(--color-text-400))]"
            placeholder={resolvedSearchPlaceholder}
          />
          {loading && <Loader2 className="ml-2 h-4 w-4 animate-spin text-[rgb(var(--color-text-300))]" />}
        </div>

        <Command.List ref={listRef} className="overflow-y-auto overscroll-contain p-1" style={{ maxHeight: maxListHeight }}>
          {loadError ? (
            <div className="py-6 text-center text-sm text-red-600">{loadError}</div>
          ) : options.length > 0 ? (
            <>
              {options.map((option) => (
                <Command.Item
                  key={option.value}
                  value={option.value}
                  onSelect={() => {
                    onChange(option.value, option);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex items-center px-2 py-1.5 text-sm rounded-sm cursor-pointer',
                    'hover:bg-[rgb(var(--color-border-100))]',
                    'aria-selected:bg-[rgb(var(--color-border-100))]',
                    value === option.value && 'bg-[rgb(var(--color-border-100))]'
                  )}
                >
                  <span className="flex-1 flex items-center gap-2">
                    {option.badge && (
                      <span className={cn(
                        'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium',
                        option.badge.variant === 'primary' && 'bg-[rgb(var(--color-primary-100))] text-[rgb(var(--color-primary-700))]',
                        option.badge.variant === 'secondary' && 'bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-600))]',
                        option.badge.variant === 'success' && 'bg-[rgb(var(--badge-success-bg))] text-[rgb(var(--badge-success-text))]',
                        option.badge.variant === 'warning' && 'bg-[rgb(var(--badge-warning-bg))] text-[rgb(var(--badge-warning-text))]',
                        option.badge.variant === 'danger' && 'bg-[rgb(var(--badge-error-bg))] text-[rgb(var(--badge-error-text))]',
                        (!option.badge.variant || option.badge.variant === 'default') && 'bg-[rgb(var(--badge-info-bg))] text-[rgb(var(--badge-info-text))]'
                      )}>
                        {option.badge.text}
                      </span>
                    )}
                    {option.label}
                  </span>
                  {value === option.value && <Check className="w-4 h-4 text-primary-600" />}
                </Command.Item>
              ))}

              {hasMore && (
                <div className="flex items-center justify-center px-2 py-2">
                  {loadingMore && (
                    <Loader2 className="h-4 w-4 animate-spin text-[rgb(var(--color-text-300))]" />
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="py-6 text-center text-sm text-[rgb(var(--color-text-400))]">{resolvedEmptyMessage}</div>
          )}
        </Command.List>

        {footerContent && (
          <div className="border-t border-gray-200 dark:border-[rgb(var(--color-border-200))]">
            {footerContent({ search, close: () => setOpen(false) })}
          </div>
        )}
      </Command>
    </div>
  );

  return (
    <div className={label ? 'mb-4' : ''} id={id} data-automation-type="async-searchable-select">
      {label && <label className="block text-sm font-medium text-[rgb(var(--color-text-600))] mb-1">{label}</label>}

      <div className="relative">
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('w-full justify-between', disabled && 'opacity-50 cursor-not-allowed', className)}
          onClick={() => !disabled && setOpen(!open)}
          disabled={disabled}
          {...automationIdProps}
        >
          <span className={cn('truncate', !value && 'text-[rgb(var(--color-text-300))]')}>
            {selectedOption?.label ?? selectedLabel ?? (value ? value : resolvedPlaceholder)}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>

        {open && !disabled && dropdownMode === 'inline' && <div className="absolute z-50 w-full mt-1">{dropdown}</div>}

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

export default AsyncSearchableSelect;

