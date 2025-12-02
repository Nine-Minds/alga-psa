'use client';

/**
 * Asset Software Inventory Component - EE Component
 *
 * Displays the software inventory for workstations and servers
 * managed by an RMM integration like NinjaOne.
 */

import React, { useState, useMemo } from 'react';
import { Package, Search, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { Asset, WorkstationAsset, ServerAsset } from '@/interfaces/asset.interfaces';

interface AssetSoftwareInventoryProps {
  asset: Asset;
  className?: string;
}

interface SoftwareItem {
  name: string;
  version?: string;
  publisher?: string;
  installDate?: string;
}

/**
 * Parse software list from asset extension
 */
function getSoftwareList(asset: Asset): SoftwareItem[] {
  const extension = asset.workstation || asset.server;

  if (!extension) {
    return [];
  }

  const installedSoftware = (extension as WorkstationAsset).installed_software ||
    ((extension as ServerAsset).installed_services as unknown[]) ||
    [];

  if (!Array.isArray(installedSoftware)) {
    return [];
  }

  return installedSoftware.map((item: any) => ({
    name: item.name || item.displayName || item.productName || 'Unknown',
    version: item.version || item.displayVersion || undefined,
    publisher: item.publisher || item.vendor || undefined,
    installDate: item.installDate || item.installedOn || undefined,
  })).filter(item => item.name && item.name !== 'Unknown');
}

/**
 * Asset Software Inventory
 */
export function AssetSoftwareInventory({ asset, className = '' }: AssetSoftwareInventoryProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const allSoftware = React.useMemo(() => getSoftwareList(asset), [asset]);

  const filteredSoftware = useMemo(() => {
    if (!searchTerm) {
      return allSoftware;
    }
    const lowerSearch = searchTerm.toLowerCase();
    return allSoftware.filter(sw =>
      sw.name.toLowerCase().includes(lowerSearch) ||
      sw.publisher?.toLowerCase().includes(lowerSearch)
    );
  }, [allSoftware, searchTerm]);

  // Only render for workstations and servers that are RMM-managed
  if (!asset.rmm_provider || !asset.rmm_device_id) {
    return null;
  }

  if (asset.asset_type !== 'workstation' && asset.asset_type !== 'server') {
    return null;
  }

  // Limit display if not expanded
  const displaySoftware = isExpanded ? filteredSoftware : filteredSoftware.slice(0, 5);

  if (allSoftware.length === 0) {
    return null;
  }

  return (
    <div className={`bg-white rounded-lg border border-gray-200 ${className}`}>
      {/* Header */}
      <button
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-purple-500" />
          <span className="font-medium">Software Inventory</span>
          <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 text-purple-700">
            {allSoftware.length} apps
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-gray-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-gray-400" />
        )}
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="border-t border-gray-200">
          {/* Search */}
          <div className="p-3 border-b border-gray-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search software..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Software List */}
          <div className="max-h-80 overflow-y-auto">
            {displaySoftware.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500">
                No software matches your search
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {displaySoftware.map((sw, index) => (
                  <div key={`${sw.name}-${index}`} className="p-3 hover:bg-gray-50">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {sw.name}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          {sw.version && (
                            <span className="text-xs text-gray-500">v{sw.version}</span>
                          )}
                          {sw.publisher && (
                            <span className="text-xs text-gray-400">by {sw.publisher}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Show More/Less */}
          {filteredSoftware.length > 5 && (
            <div className="p-3 border-t border-gray-100 text-center">
              <span className="text-xs text-gray-500">
                Showing {displaySoftware.length} of {filteredSoftware.length} applications
              </span>
            </div>
          )}
        </div>
      )}

      {/* Collapsed Preview */}
      {!isExpanded && allSoftware.length > 0 && (
        <div className="border-t border-gray-200 p-3">
          <div className="flex flex-wrap gap-1">
            {allSoftware.slice(0, 3).map((sw, index) => (
              <span
                key={`preview-${sw.name}-${index}`}
                className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-700"
              >
                {sw.name.length > 20 ? `${sw.name.substring(0, 20)}...` : sw.name}
              </span>
            ))}
            {allSoftware.length > 3 && (
              <span className="inline-flex items-center px-2 py-0.5 text-xs text-gray-500">
                +{allSoftware.length - 3} more
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default AssetSoftwareInventory;
