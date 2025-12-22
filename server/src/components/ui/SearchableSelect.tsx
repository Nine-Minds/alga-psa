'use client'

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Command } from 'cmdk';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from 'server/src/lib/utils';
import { Button } from 'server/src/components/ui/Button';
import { FormFieldComponent, AutomationProps } from '../../types/ui-reflection/types';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';

export interface SelectOption {
  value: string;
  label: string;
}

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
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  className = '',
  disabled = false,
  label,
  id,
  required = false,
  emptyMessage = 'No results found',
  dropdownMode = 'inline',
  searchPlaceholder,
  autoFocusSearch = true,
  maxListHeight = '15rem',
  portalContainer,
}: SearchableSelectProps & AutomationProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [overlayPosition, setOverlayPosition] = useState<{ top: number; left: number; width: number } | null>(null);

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

  // Filter options based on search
  const filteredOptions = useMemo(() => {
    if (!search) return options;
    
    const searchLower = search.toLowerCase();
    return options.filter((option: SelectOption) => 
      option.label.toString().toLowerCase().includes(searchLower)
    );
  }, [options, search]);

  // Find the selected option label
  const selectedOption = options.find((option: SelectOption) => option.value === value);

  const resolvedSearchPlaceholder =
    searchPlaceholder ??
    (placeholder ? `Search ${placeholder.replace(/\.\.\.$/, '').toLowerCase()}...` : 'Search...');

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

  // Clear search when closing
  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const dropdown = (
    <div
      ref={contentRef}
      className={cn(
        dropdownMode === 'overlay'
          ? 'bg-white rounded-md shadow-lg border border-gray-200 overflow-hidden'
          : 'rounded-md border border-gray-200 bg-white shadow-md overflow-hidden'
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
            className="flex h-9 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-gray-500"
            placeholder={resolvedSearchPlaceholder}
          />
        </div>
        <Command.List className="overflow-y-auto p-1" style={{ maxHeight: maxListHeight }}>
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option: SelectOption) => (
              <Command.Item
                key={option.value}
                value={option.value}
                onSelect={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  'flex items-center px-2 py-1.5 text-sm rounded-sm cursor-pointer',
                  'hover:bg-gray-100',
                  'aria-selected:bg-gray-100',
                  value === option.value && 'bg-gray-100'
                )}
              >
                <span className="flex-1">{option.label}</span>
                {value === option.value && (
                  <Check className="w-4 h-4 text-primary-600" />
                )}
              </Command.Item>
            ))
          ) : (
            <div className="py-6 text-center text-sm text-gray-500">
              {emptyMessage}
            </div>
          )}
        </Command.List>
      </Command>
    </div>
  );

  return (
    <div className={label ? 'mb-4' : ''} id={id} data-automation-type="searchable-select">
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
      )}
      
      <div className="relative">
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between",
            disabled && "opacity-50 cursor-not-allowed",
            className
          )}
          onClick={() => !disabled && setOpen(!open)}
          disabled={disabled}
          {...automationIdProps}
        >
          <span className={cn("truncate", !selectedOption && "text-gray-400")}>
            {selectedOption ? selectedOption.label : placeholder}
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
