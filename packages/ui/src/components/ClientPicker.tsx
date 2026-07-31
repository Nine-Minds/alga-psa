'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { FocusScope } from '@radix-ui/react-focus-scope';
import { RemoveScroll } from 'react-remove-scroll';
import { ChevronDown, Plus } from 'lucide-react';
import type { VariantProps } from 'class-variance-authority';
import type { IClient, ITag } from '@alga-psa/types';

import { Input } from './Input';
import CustomSelect from './CustomSelect';
import { Button, buttonVariants } from './Button';
import ClientAvatar from './ClientAvatar';
import { TagFilter } from './tags/TagFilter';
import { useClientTags } from '../context/ClientTagsContext';
import type { EntityAvatarProps } from './EntityAvatar';
import { useTranslation } from '../lib/i18n/client';

import { ReflectionContainer } from '../ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from '../ui-reflection/useAutomationIdAndRegister';
import type { AutomationProps, FormFieldComponent, ButtonComponent } from '../ui-reflection/types';
import { CommonActions } from '../ui-reflection/actionBuilders';

type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
type ButtonSize = VariantProps<typeof buttonVariants>['size'];
type ClientFilterState = 'all' | 'active' | 'inactive';
type ClientTypeFilter = 'all' | 'company' | 'individual';

interface ClientPickerProps {
  id?: string;
  clients?: IClient[];
  onSelect: (clientId: string | null) => void;
  selectedClientId: string | null;
  filterState?: ClientFilterState;
  onFilterStateChange?: (state: ClientFilterState) => void;
  clientTypeFilter?: ClientTypeFilter;
  onClientTypeFilterChange?: (type: ClientTypeFilter) => void;
  disabledClientIds?: Set<string>;
  disabledTooltip?: string;
  fitContent?: boolean;
  className?: string;
  placeholder?: string;
  modal?: boolean;
  size?: EntityAvatarProps['size'];
  triggerVariant?: ButtonVariant;
  triggerSize?: ButtonSize;
  triggerButtonClassName?: string;
  onAddNew?: () => void;
  disabled?: boolean;
}

interface OptionButtonProps {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  selected?: boolean;
  className?: string;
  children: React.ReactNode;
}

const OptionButton: React.FC<OptionButtonProps> = ({ id, label, onSelect, disabled = false, selected = false, className, children }) => {
  const { automationIdProps } = useAutomationIdAndRegister<ButtonComponent>({
    type: 'button',
    id,
    label,
    disabled,
  });

  return (
    <button
      {...automationIdProps}
      type="button"
      role="option"
      aria-selected={selected}
      disabled={disabled}
      data-automation-type="button"
      className={className}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onSelect();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          onSelect();
        }
      }}
    >
      {children}
    </button>
  );
};

export const ClientPicker: React.FC<ClientPickerProps & AutomationProps> = ({
  id = 'client-picker',
  clients = [],
  onSelect,
  selectedClientId,
  filterState,
  onFilterStateChange,
  clientTypeFilter,
  onClientTypeFilterChange,
  disabledClientIds,
  disabledTooltip = 'Has active contract',
  fitContent = false,
  className = '',
  placeholder = 'Select Client',
  modal = true,
  size = 'sm',
  triggerVariant = 'outline',
  triggerSize,
  triggerButtonClassName = '',
  onAddNew,
  disabled = false,
  'data-automation-type': dataAutomationType = 'picker',
}) => {
  const { t } = useTranslation('common');
  const { fetchClientTags } = useClientTags();
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [internalFilterState, setInternalFilterState] = useState<ClientFilterState>(filterState ?? 'active');
  const [internalClientTypeFilter, setInternalClientTypeFilter] = useState<ClientTypeFilter>(clientTypeFilter ?? 'all');
  const [clientTags, setClientTags] = useState<ITag[]>([]);
  const [selectedTagFilters, setSelectedTagFilters] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [dropdownCoords, setDropdownCoords] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    listMaxHeight: number;
  }>({ top: 0, left: 0, width: 0, listMaxHeight: 320 });

  const selectedClient = useMemo(
    () => clients.find((c) => c.client_id === selectedClientId),
    [clients, selectedClientId]
  );

  useEffect(() => {
    if (!isOpen || !fetchClientTags || clients.length === 0) return;
    let cancelled = false;
    fetchClientTags(clients.map((client) => client.client_id))
      .then((tags) => {
        if (!cancelled) setClientTags(tags);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen, fetchClientTags, clients]);

  const tagTextsByClientId = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const tag of clientTags) {
      let texts = map.get(tag.tagged_id);
      if (!texts) {
        texts = new Set<string>();
        map.set(tag.tagged_id, texts);
      }
      texts.add(tag.tag_text);
    }
    return map;
  }, [clientTags]);

  const uniqueFilterTags = useMemo(() => {
    const byText = new Map<string, ITag>();
    for (const tag of clientTags) {
      if (!byText.has(tag.tag_text)) byText.set(tag.tag_text, tag);
    }
    return Array.from(byText.values()).sort((a, b) => a.tag_text.localeCompare(b.tag_text));
  }, [clientTags]);

  const showTagFilter = uniqueFilterTags.length > 0;
  const resolvedFilterState = filterState ?? internalFilterState;
  const resolvedClientTypeFilter = clientTypeFilter ?? internalClientTypeFilter;

  const handleFilterStateChange = (state: ClientFilterState) => {
    if (filterState === undefined) {
      setInternalFilterState(state);
    }
    onFilterStateChange?.(state);
  };

  const handleClientTypeFilterChange = (type: ClientTypeFilter) => {
    if (clientTypeFilter === undefined) {
      setInternalClientTypeFilter(type);
    }
    onClientTypeFilterChange?.(type);
  };

  const filteredClients = useMemo(() => {
    return clients
      .filter((client) => {
        const matchesSearch = client.client_name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesState =
          resolvedFilterState === 'all'
            ? true
            : resolvedFilterState === 'active'
              ? !client.is_inactive
              : resolvedFilterState === 'inactive'
                ? client.is_inactive
                : true;
        const matchesClientType =
          resolvedClientTypeFilter === 'all'
            ? true
            : resolvedClientTypeFilter === 'company'
              ? client.client_type === 'company'
              : resolvedClientTypeFilter === 'individual'
                ? client.client_type === 'individual'
                : true;
        const matchesTags =
          selectedTagFilters.length === 0
            ? true
            : selectedTagFilters.some((tagText) =>
                tagTextsByClientId.get(client.client_id)?.has(tagText)
              );

        return matchesSearch && matchesState && matchesClientType && matchesTags;
      })
      .sort((a, b) => {
        const aDisabled = disabledClientIds?.has(a.client_id) ?? false;
        const bDisabled = disabledClientIds?.has(b.client_id) ?? false;
        if (aDisabled !== bDisabled) return aDisabled ? 1 : -1;
        return a.client_name.localeCompare(b.client_name);
      });
  }, [clients, resolvedFilterState, resolvedClientTypeFilter, searchTerm, disabledClientIds, selectedTagFilters, tagTextsByClientId]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      const isInsideDropdown = dropdownRef.current?.contains(target);
      const isInsideButton = triggerRef.current?.contains(target);
      const isInsideRadixSelect =
        target.closest('[data-radix-select-content]') !== null ||
        target.closest('[data-radix-popper-content-wrapper]') !== null;

      if (!isInsideDropdown && !isInsideButton && !isInsideRadixSelect) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  }, [isOpen]);

  const updateDropdownPosition = useCallback(() => {
    if (!triggerRef.current) return;

    const buttonRect = triggerRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 16;

    const dropdownWidth = Math.min(420, Math.max(buttonRect.width, 300));

    const spaceOnRight = viewportWidth - buttonRect.right;
    const spaceOnLeft = buttonRect.left;

    let left = buttonRect.left;

    if (buttonRect.left + dropdownWidth > viewportWidth - margin) {
      if (spaceOnLeft > spaceOnRight) {
        left = Math.max(margin, buttonRect.right - dropdownWidth);
      } else {
        left = Math.max(margin, viewportWidth - dropdownWidth - margin);
      }
    }

    // Search + filter header, and the optional add-new footer, surround the list.
    const chromeHeight = 125 + (onAddNew ? 49 : 0);
    const minListHeight = 150;
    const maxListHeight = 320;

    const spaceBelow = viewportHeight - buttonRect.bottom - 4 - margin;
    const spaceAbove = buttonRect.top - 4 - margin;
    const showAbove = spaceBelow < chromeHeight + minListHeight && spaceAbove > spaceBelow;
    const available = (showAbove ? spaceAbove : spaceBelow) - chromeHeight;
    const listMaxHeight = Math.max(minListHeight, Math.min(maxListHeight, available));

    setDropdownCoords({
      top: showAbove ? undefined : buttonRect.bottom + 4,
      bottom: showAbove ? viewportHeight - buttonRect.top + 4 : undefined,
      left,
      width: dropdownWidth,
      listMaxHeight,
    });
  }, [onAddNew]);

  useEffect(() => {
    if (!isOpen) return;

    updateDropdownPosition();
    window.addEventListener('scroll', updateDropdownPosition, true);
    window.addEventListener('resize', updateDropdownPosition);

    return () => {
      window.removeEventListener('scroll', updateDropdownPosition, true);
      window.removeEventListener('resize', updateDropdownPosition);
    };
  }, [isOpen, updateDropdownPosition]);

  useEffect(() => {
    if (!isOpen) return;

    const animationFrame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [isOpen]);

  const handleSelect = (clientId: string) => {
    if (disabledClientIds?.has(clientId)) return;

    if (clientId !== selectedClientId) {
      onSelect(clientId);
    }
    setIsOpen(false);
  };

  const handleAddNew = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setSearchTerm('');
    setIsOpen(false);
    onAddNew?.();
  };

  const opts = useMemo(
    () => [
      { value: 'active', label: 'Active Clients' },
      { value: 'inactive', label: 'Inactive Clients' },
      { value: 'all', label: 'All Clients' },
    ],
    []
  );

  const clientTypes = useMemo(
    () => [
      { value: 'all', label: 'All Types' },
      { value: 'company', label: 'Companies' },
      { value: 'individual', label: 'Individuals' },
    ],
    []
  );

  const mappedOptions = useMemo(
    () =>
      clients.map((opt): { value: string; label: string } => ({
        value: opt.client_name,
        label: opt.client_name,
      })),
    [clients]
  );

  const { automationIdProps: clientPickerProps, updateMetadata } = useAutomationIdAndRegister<FormFieldComponent>(
    {
      type: 'formField',
      fieldType: 'select',
      id,
      value: selectedClientId || '',
      disabled,
      required: false,
      options: mappedOptions,
    },
    () => [CommonActions.open('Open client picker dropdown')]
  );

  const prevMetadataRef = useRef<{
    value: string;
    label: string;
    disabled: boolean;
    required: boolean;
    options: { value: string; label: string }[];
  } | null>(null);

  useEffect(() => {
    if (!updateMetadata) return;
    const metadata = {
      value: selectedClientId || '',
      label: placeholder,
      disabled,
      required: false,
      options: mappedOptions,
    };
    if (JSON.stringify(prevMetadataRef.current) !== JSON.stringify(metadata)) {
      updateMetadata(metadata);
      prevMetadataRef.current = metadata;
    }
  }, [disabled, mappedOptions, placeholder, selectedClientId, updateMetadata]);

  const dropdown = (
    <RemoveScroll allowPinchZoom>
      <FocusScope
        asChild
        loop
        trapped
        onMountAutoFocus={(event) => {
          event.preventDefault();
        }}
        onUnmountAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.querySelector('button')?.focus();
        }}
      >
      <div
        ref={dropdownRef}
        className="fixed z-[10000] bg-white border border-gray-200 rounded-md shadow-lg overflow-hidden"
        style={{
          top: dropdownCoords.top,
          bottom: dropdownCoords.bottom,
          left: dropdownCoords.left,
          width: dropdownCoords.width,
          pointerEvents: 'auto',
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        data-radix-popper-content-wrapper=""
      >
        <div className="p-3 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center gap-2">
            <Input
              ref={searchInputRef}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search clients..."
              autoFocus
              className="h-9"
            />
            {showTagFilter && (
              <TagFilter
                id={`${id}-tag-filter`}
                tags={uniqueFilterTags}
                selectedTags={selectedTagFilters}
                onToggleTag={(tagText) => {
                  setSelectedTagFilters((current) =>
                    current.includes(tagText)
                      ? current.filter((text) => text !== tagText)
                      : [...current, tagText]
                  );
                }}
                onClearTags={() => setSelectedTagFilters([])}
                modal
                align="start"
                contentClassName="z-[10001]"
              />
            )}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <CustomSelect
              id={`${id}-state-filter`}
              value={resolvedFilterState}
              onValueChange={(value) => handleFilterStateChange(value as ClientFilterState)}
              options={opts}
              placeholder="Filter"
              className="flex-1 min-w-0"
            />
            <CustomSelect
              id={`${id}-type-filter`}
              value={resolvedClientTypeFilter}
              onValueChange={(value) => handleClientTypeFilterChange(value as ClientTypeFilter)}
              options={clientTypes}
              placeholder="Type"
              className="flex-1 min-w-0"
            />
          </div>
        </div>

        <div
          id={`${id}-listbox`}
          role="listbox"
          aria-label={placeholder}
          className="overflow-y-auto"
          style={{ overscrollBehavior: 'contain', maxHeight: dropdownCoords.listMaxHeight }}
          onWheel={(e) => e.stopPropagation()}
        >
          {filteredClients.length === 0 ? (
            <div className="p-4 text-sm text-gray-500">No clients found.</div>
          ) : (
            filteredClients.map((client) => {
              const isDisabled = disabledClientIds?.has(client.client_id) ?? false;
              const isSelected = client.client_id === selectedClientId;
              return (
                <OptionButton
                  key={client.client_id}
                  id={`${id}-option-${client.client_id}`}
                  label={client.client_name}
                  onSelect={() => handleSelect(client.client_id)}
                  disabled={isDisabled}
                  selected={isSelected}
                  className={`flex w-full items-center gap-2 p-3 text-left ${
                    isDisabled
                      ? 'opacity-50 cursor-not-allowed'
                      : `cursor-pointer hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-inset ${isSelected ? 'bg-gray-50' : ''}`
                  }`}
                >
                  <ClientAvatar clientId={client.client_id} clientName={client.client_name} logoUrl={(client as any).logoUrl} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{client.client_name}</div>
                    <div className="text-xs text-gray-500 truncate">
                      {client.client_type ? client.client_type : '—'}
                      {client.is_inactive ? ' • Inactive' : ''}
                    </div>
                  </div>
                  {isDisabled && (
                    <span className="text-xs text-gray-400 whitespace-nowrap">{disabledTooltip}</span>
                  )}
                </OptionButton>
              );
            })
          )}
        </div>
        {onAddNew && (
          <>
            <div className="border-t border-gray-200" />
            <Button
              id="client-picker-add-new-btn"
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 rounded-none text-primary"
              onClick={handleAddNew}
            >
              <Plus className="h-4 w-4" />
              {t('pickers.addNewClient', { defaultValue: 'Add new client' })}
            </Button>
          </>
        )}
      </div>
      </FocusScope>
    </RemoveScroll>
  );

  return (
    <ReflectionContainer id={`${id}-container`} label={placeholder}>
      <div
        ref={containerRef}
        className={`relative ${fitContent ? 'inline-block' : 'w-full'} ${className}`}
        {...clientPickerProps}
      >
        <div ref={triggerRef}>
          <Button
            id={`${id}-trigger`}
            type="button"
            variant={triggerVariant}
            size={triggerSize}
            className={`${fitContent ? 'w-auto' : 'w-full'} justify-between ${triggerButtonClassName}`}
            onClick={() => { if (!disabled) setIsOpen((prev) => !prev); }}
            onKeyDown={(event) => {
              if (disabled) return;
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setIsOpen(true);
              }
            }}
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-controls={`${id}-listbox`}
            data-automation-type={dataAutomationType}
          >
            <div className="flex items-center gap-2 min-w-0">
              {selectedClient ? (
                <>
                  <ClientAvatar
                    clientId={selectedClient.client_id}
                    clientName={selectedClient.client_name}
                    logoUrl={(selectedClient as any).logoUrl}
                    size={size === 'xs' ? 'xs' : 'sm'}
                  />
                  <span className="truncate">{selectedClient.client_name}</span>
                </>
              ) : (
                <span className="text-gray-500">{placeholder}</span>
              )}
            </div>
            <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </Button>
        </div>
        {isOpen && modal && createPortal(dropdown, document.body)}
        {isOpen && !modal && dropdown}
      </div>
    </ReflectionContainer>
  );
};
