'use client';

import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { Command } from 'cmdk';
import { Search, Plus, RefreshCw, XCircle, ArrowUpRight, ChevronsRight } from 'lucide-react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import type { Asset } from '@alga-psa/types';
import { useRegisterUIComponent } from '@alga-psa/ui/ui-reflection/useRegisterUIComponent';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { cn } from '@alga-psa/ui/lib/utils';

interface QuickAction {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  shortcut?: string;
  disabled?: boolean;
  onSelect: () => void;
}

interface AssetCommandPaletteProps {
  isOpen: boolean;
  assets: Asset[];
  filteredAssets: Asset[];
  hasActiveFilters: boolean;
  onClose: () => void;
  onSelectAsset: (asset: Asset) => void;
  onCreateAsset: () => void;
  onRefreshData: () => void;
  onClearFilters: () => void;
}

export function AssetCommandPalette({
  isOpen,
  assets,
  filteredAssets,
  hasActiveFilters,
  onClose,
  onSelectAsset,
  onCreateAsset,
  onRefreshData,
  onClearFilters
}: AssetCommandPaletteProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const registerPalette = useRegisterUIComponent({
    id: 'asset-command-palette',
    type: 'dialog',
    label: 'Asset Command Palette',
    title: 'Asset Command Palette',
    open: isOpen
  });

  useEffect(() => {
    registerPalette?.({
      open: isOpen
    });
  }, [isOpen, registerPalette]);

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      return;
    }

    const focusTimeout = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);

    return () => clearTimeout(focusTimeout);
  }, [isOpen]);

  const handleClose = useCallback(() => {
    setSearchQuery('');
    onClose();
  }, [onClose]);

  const quickActions: QuickAction[] = useMemo(() => [
    {
      id: 'create-asset',
      label: 'Create asset',
      description: 'Open quick add to register a new asset',
      icon: <Plus className="h-4 w-4" />,
      shortcut: 'N',
      onSelect: () => {
        onCreateAsset();
        handleClose();
      }
    },
    {
      id: 'refresh-assets',
      label: 'Refresh data',
      description: 'Re-fetch assets from the server',
      icon: <RefreshCw className="h-4 w-4" />,
      shortcut: 'R',
      onSelect: () => {
        onRefreshData();
        handleClose();
      }
    },
    {
      id: 'clear-filters',
      label: 'Clear filters',
      description: 'Remove all active filters and search terms',
      icon: <XCircle className="h-4 w-4" />,
      shortcut: 'Shift+⌘+K',
      disabled: !hasActiveFilters,
      onSelect: () => {
        if (hasActiveFilters) {
          onClearFilters();
        }
        handleClose();
      }
    }
  ], [onCreateAsset, onRefreshData, onClearFilters, hasActiveFilters, handleClose]);

  const searchableAssets = useMemo(() => {
    const baseAssets = searchQuery
      ? assets.filter(asset => {
          const query = searchQuery.toLowerCase();
          return (
            asset.name.toLowerCase().includes(query) ||
            asset.asset_tag?.toLowerCase().includes(query) ||
            asset.client?.client_name?.toLowerCase().includes(query || '')
          );
        })
      : filteredAssets;

    return baseAssets.slice(0, 15);
  }, [assets, filteredAssets, searchQuery]);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      hideCloseButton
      draggable={false}
      className="max-w-2xl"
      title="Command Palette"
    >
      <div
        className="flex flex-col gap-4"
        {...withDataAutomationId({ id: 'asset-command-palette-content' })}
      >
        <Command
          className="rounded-xl border border-gray-200 shadow-sm overflow-hidden focus:outline-none"
          value={searchQuery}
          onValueChange={setSearchQuery}
        >
          <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-3">
            <Search className="h-4 w-4 text-gray-400" />
            <Command.Input
              ref={inputRef}
              placeholder="Search assets, clients, tickets…"
              className="flex-1 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
            />
            <kbd className="hidden sm:inline-flex select-none items-center gap-1 rounded border border-gray-200 bg-white px-2 text-[10px] font-medium text-gray-500">
              <span className="text-xs">ESC</span>
            </kbd>
          </div>

          <Command.List className="max-h-80 overflow-y-auto px-3 py-2">
            <Command.Empty className="py-6 text-center text-sm text-gray-500">
              No matches yet. Try a different keyword.
            </Command.Empty>

            <Command.Group heading="Quick actions" className="space-y-1 py-2">
              {quickActions.map(action => (
                <Command.Item
                  key={action.id}
                  disabled={action.disabled}
                  value={action.label}
                  onSelect={() => {
                    if (!action.disabled) {
                      action.onSelect();
                    }
                  }}
                  className={cn(
                    'flex items-center justify-between rounded-md px-3 py-2 text-sm text-gray-700',
                    'cursor-pointer aria-selected:bg-primary-50 aria-selected:text-primary-700',
                    action.disabled && 'opacity-60 cursor-not-allowed'
                  )}
                  {...withDataAutomationId({ id: `command-action-${action.id}` })}
                >
                  <span className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-50 text-primary-600">
                      {action.icon}
                    </span>
                    <span className="flex flex-col">
                      <span className="font-medium">{action.label}</span>
                      <span className="text-xs text-gray-500">{action.description}</span>
                    </span>
                  </span>
                  {action.shortcut && (
                    <kbd className="inline-flex select-none items-center gap-1 rounded border border-gray-200 bg-gray-50 px-2 text-[10px] font-medium text-gray-500">
                      {action.shortcut}
                    </kbd>
                  )}
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Separator className="my-2 border-t border-gray-100" />

            <Command.Group heading="Assets" className="space-y-1 py-2">
              {searchableAssets.map(asset => (
                <Command.Item
                  key={asset.asset_id}
                  value={`${asset.name} ${asset.asset_tag ?? ''} ${asset.client?.client_name ?? ''}`}
                  onSelect={() => {
                    onSelectAsset(asset);
                    handleClose();
                  }}
                  className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-gray-700 cursor-pointer aria-selected:bg-primary-50 aria-selected:text-primary-700"
                  {...withDataAutomationId({ id: `command-asset-${asset.asset_id}` })}
                >
                  <span className="flex flex-col">
                    <span className="font-medium">{asset.name}</span>
                    <span className="text-xs text-gray-500">
                      {asset.asset_tag ? `${asset.asset_tag} • ` : ''}
                      {asset.client?.client_name || 'Unassigned'}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-gray-400">
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-600">
                      {asset.asset_type.replace('_', ' ')}
                    </span>
                    <ArrowUpRight className="h-4 w-4" />
                  </span>
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Separator className="my-2 border-t border-gray-100" />

            <Command.Group heading="Hints" className="space-y-1 py-2 text-xs text-gray-500">
              <div className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2">
                <span className="flex items-center gap-2">
                  <ChevronsRight className="h-3.5 w-3.5" />
                  Keep typing to search across the full asset list. Tickets and client lookup will arrive in a later drop.
                </span>
                <kbd className="inline-flex select-none items-center gap-1 rounded border border-gray-200 bg-white px-2 text-[10px] font-medium text-gray-500">
                  Coming soon
                </kbd>
              </div>
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </Dialog>
  );
}

export default AssetCommandPalette;
