'use client';

/**
 * Asset Patch Status Section - EE Component
 *
 * Displays patch status information for workstations and servers
 * managed by an RMM integration like NinjaOne.
 */

import React, { useState } from 'react';
import { Shield, AlertCircle, CheckCircle, Clock, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { Asset, WorkstationAsset, ServerAsset } from '@/interfaces/asset.interfaces';

interface AssetPatchStatusSectionProps {
  asset: Asset;
  className?: string;
}

/**
 * Format relative time from ISO string
 */
function formatRelativeTime(isoString: string | null | undefined): string {
  if (!isoString) return 'Never';

  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) {
    return 'Just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return date.toLocaleDateString();
  }
}

/**
 * Get patch data from asset extension
 */
function getPatchData(asset: Asset): {
  pendingOsPatches: number;
  pendingSoftwarePatches: number;
  failedPatches: number;
  lastPatchScan: string | null;
  antivirusStatus: string | null;
  antivirusProduct: string | null;
} | null {
  // Check if this is a workstation or server
  const extension = asset.workstation || asset.server;

  if (!extension) {
    return null;
  }

  const ext = extension as WorkstationAsset | ServerAsset;

  // Use granular fields if available, otherwise fall back to total
  const pendingOsPatches = ext.pending_os_patches ?? Math.floor((ext.pending_patches || 0) * 0.6);
  const pendingSoftwarePatches = ext.pending_software_patches ?? Math.floor((ext.pending_patches || 0) * 0.4);

  return {
    pendingOsPatches,
    pendingSoftwarePatches,
    failedPatches: ext.failed_patches || 0,
    lastPatchScan: ext.last_patch_scan_at || null,
    antivirusStatus: ext.antivirus_status || null,
    antivirusProduct: ext.antivirus_product || null,
  };
}

/**
 * Get compliance status
 */
function getComplianceStatus(patchData: ReturnType<typeof getPatchData>): {
  status: 'compliant' | 'warning' | 'critical';
  label: string;
  color: string;
} {
  if (!patchData) {
    return { status: 'warning', label: 'Unknown', color: 'text-gray-500 bg-gray-100' };
  }

  const totalPending = patchData.pendingOsPatches + patchData.pendingSoftwarePatches;

  if (patchData.failedPatches > 0) {
    return { status: 'critical', label: 'Action Required', color: 'text-red-700 bg-red-100' };
  } else if (totalPending > 10) {
    return { status: 'warning', label: 'Updates Available', color: 'text-amber-700 bg-amber-100' };
  } else if (totalPending > 0) {
    return { status: 'warning', label: 'Minor Updates', color: 'text-blue-700 bg-blue-100' };
  }

  return { status: 'compliant', label: 'Up to Date', color: 'text-emerald-700 bg-emerald-100' };
}

/**
 * Asset Patch Status Section
 */
export function AssetPatchStatusSection({ asset, className = '' }: AssetPatchStatusSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  // Only render for workstations and servers that are RMM-managed
  if (!asset.rmm_provider || !asset.rmm_device_id) {
    return null;
  }

  if (asset.asset_type !== 'workstation' && asset.asset_type !== 'server') {
    return null;
  }

  const patchData = getPatchData(asset);

  if (!patchData) {
    return null;
  }

  const compliance = getComplianceStatus(patchData);
  const totalPending = patchData.pendingOsPatches + patchData.pendingSoftwarePatches;

  return (
    <div className={`bg-white rounded-lg border border-gray-200 ${className}`}>
      {/* Header */}
      <button
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <Shield className={`h-5 w-5 ${
            compliance.status === 'compliant' ? 'text-emerald-500' :
            compliance.status === 'warning' ? 'text-amber-500' : 'text-red-500'
          }`} />
          <span className="font-medium">Patch Status</span>
          <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${compliance.color}`}>
            {compliance.label}
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
        <div className="border-t border-gray-200 p-4">
          <div className="grid grid-cols-2 gap-4">
            {/* OS Patches */}
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg ${
                patchData.pendingOsPatches > 0 ? 'bg-amber-100' : 'bg-emerald-100'
              }`}>
                {patchData.pendingOsPatches > 0 ? (
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                ) : (
                  <CheckCircle className="h-4 w-4 text-emerald-600" />
                )}
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">OS Patches</p>
                <p className="text-lg font-semibold text-gray-900">{patchData.pendingOsPatches}</p>
                <p className="text-xs text-gray-500">pending</p>
              </div>
            </div>

            {/* Software Patches */}
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg ${
                patchData.pendingSoftwarePatches > 0 ? 'bg-blue-100' : 'bg-emerald-100'
              }`}>
                {patchData.pendingSoftwarePatches > 0 ? (
                  <AlertCircle className="h-4 w-4 text-blue-600" />
                ) : (
                  <CheckCircle className="h-4 w-4 text-emerald-600" />
                )}
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Software</p>
                <p className="text-lg font-semibold text-gray-900">{patchData.pendingSoftwarePatches}</p>
                <p className="text-xs text-gray-500">pending</p>
              </div>
            </div>

            {/* Failed Patches */}
            {patchData.failedPatches > 0 && (
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-red-100">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Failed</p>
                  <p className="text-lg font-semibold text-red-600">{patchData.failedPatches}</p>
                  <p className="text-xs text-gray-500">patches</p>
                </div>
              </div>
            )}

            {/* Last Scan */}
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-gray-100">
                <Clock className="h-4 w-4 text-gray-600" />
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Last Scan</p>
                <p className="text-sm font-medium text-gray-900">
                  {formatRelativeTime(patchData.lastPatchScan)}
                </p>
              </div>
            </div>
          </div>

          {/* Antivirus Status */}
          {patchData.antivirusProduct && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className={`h-4 w-4 ${
                    patchData.antivirusStatus === 'good' || patchData.antivirusStatus === 'active'
                      ? 'text-emerald-500'
                      : 'text-amber-500'
                  }`} />
                  <span className="text-sm font-medium text-gray-700">{patchData.antivirusProduct}</span>
                </div>
                <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
                  patchData.antivirusStatus === 'good' || patchData.antivirusStatus === 'active'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-amber-100 text-amber-700'
                }`}>
                  {patchData.antivirusStatus || 'Unknown'}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AssetPatchStatusSection;
