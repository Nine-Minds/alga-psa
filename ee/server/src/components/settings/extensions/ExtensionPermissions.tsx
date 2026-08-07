/**
 * Extension Permissions Component
 * 
 * Displays extension permissions in a structured way
 */
'use client';

import React from 'react';
import { ShieldIcon, CheckCircleIcon, XCircleIcon, AlertTriangleIcon, InfoIcon } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export interface ExtensionPermissionsProps {
  permissions: string[];
  compact?: boolean;
}

// Stable category ids — the heading each one renders is a translated string,
// so the bucket must not be keyed on its English label.
type PermissionCategory = 'storage' | 'ui' | 'data' | 'api' | 'system' | 'other';

const CATEGORY_ORDER: PermissionCategory[] = ['storage', 'ui', 'data', 'api', 'system', 'other'];

const CATEGORY_HEADING_FALLBACKS: Record<PermissionCategory, string> = {
  storage: 'Storage Permissions',
  ui: 'UI Permissions',
  data: 'Data Permissions',
  api: 'API Permissions',
  system: 'System Permissions',
  other: 'Other Permissions',
};

// Categorize permissions for display
const categorizePermissions = (permissions: string[]) => {
  const categories = Object.fromEntries(
    CATEGORY_ORDER.map((category) => [category, [] as string[]]),
  ) as Record<PermissionCategory, string[]>;

  permissions.forEach(permission => {
    const [resource] = permission.split(':');

    switch (resource) {
      case 'storage':
        categories.storage.push(permission);
        break;
      case 'ui':
        categories.ui.push(permission);
        break;
      case 'data':
      case 'client':
      case 'contact':
      case 'invoice':
      case 'ticket':
        categories.data.push(permission);
        break;
      case 'api':
        categories.api.push(permission);
        break;
      case 'system':
      case 'integration':
        categories.system.push(permission);
        break;
      default:
        categories.other.push(permission);
        break;
    }
  });

  // Filter out empty categories
  return CATEGORY_ORDER
    .map((category) => [category, categories[category]] as const)
    .filter(([, perms]) => perms.length > 0);
};

// Get severity level of a permission
const getPermissionSeverity = (permission: string): 'low' | 'medium' | 'high' => {
  const [resource, action] = permission.split(':');
  
  // Read-only permissions are generally low severity
  if (action === 'read' || action === 'view' || action === 'list') {
    return 'low';
  }
  
  // Write/update permissions are medium severity
  if (action === 'write' || action === 'update') {
    return 'medium';
  }
  
  // Delete/create permissions are high severity
  if (action === 'delete' || action === 'create' || action === 'execute' || action === 'manage') {
    return 'high';
  }
  
  // API permissions are medium to high severity
  if (resource === 'api') {
    return action === 'read' ? 'medium' : 'high';
  }
  
  // Invoice and billing permissions are higher severity
  if (resource === 'invoice' || resource === 'billing') {
    return action === 'read' ? 'low' : 'high';
  }
  
  // Integration permissions are higher severity
  if (resource === 'integration' || resource === 'system') {
    return 'high';
  }
  
  // Default to medium
  return 'medium';
};

// Get color for severity level
const getSeverityColor = (severity: 'low' | 'medium' | 'high') => {
  switch (severity) {
    case 'low':
      return 'bg-success/15 text-success';
    case 'medium':
      return 'bg-warning/15 text-warning-foreground';
    case 'high':
      return 'bg-destructive/15 text-destructive';
    default:
      return 'bg-muted text-muted-foreground';
  }
};

// Get icon for severity level
const getSeverityIcon = (severity: 'low' | 'medium' | 'high') => {
  switch (severity) {
    case 'low':
      return <CheckCircleIcon className="h-3.5 w-3.5 mr-1" />;
    case 'medium':
      return <AlertTriangleIcon className="h-3.5 w-3.5 mr-1" />;
    case 'high':
      return <XCircleIcon className="h-3.5 w-3.5 mr-1" />;
    default:
      return <InfoIcon className="h-3.5 w-3.5 mr-1" />;
  }
};

/**
 * Component to display extension permissions in a structured way
 */
export function ExtensionPermissions({ permissions, compact = false }: ExtensionPermissionsProps) {
  const { t } = useTranslation('msp/extensions');

  // If there are no permissions, render nothing
  if (!permissions || permissions.length === 0) {
    return null;
  }

  // Categorize permissions
  const categorizedPermissions = categorizePermissions(permissions);
  
  // If compact mode, just show pills
  if (compact) {
    return (
      <ul className="flex flex-wrap gap-1.5">
        {permissions.map((permission) => {
          const severity = getPermissionSeverity(permission);
          return (
            <li
              key={permission}
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getSeverityColor(severity)}`}
              title={permission}
            >
              {getSeverityIcon(severity)}
              {permission}
            </li>
          );
        })}
      </ul>
    );
  }
  
  // Full display mode
  return (
    <div className="space-y-4">
      {categorizedPermissions.map(([category, categoryPermissions]) => (
        <div key={category}>
          <h4 className="text-sm font-medium text-gray-700 mb-2">
            {t(`permissions.categoryHeadings.${category}`, {
              defaultValue: CATEGORY_HEADING_FALLBACKS[category],
            })}
          </h4>
          <ul className="space-y-2">
            {categoryPermissions.map((permission) => {
              const severity = getPermissionSeverity(permission);
              return (
                <li key={permission} className="flex items-start">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${getSeverityColor(severity)}`}>
                    {getSeverityIcon(severity)}
                    {permission}
                  </span>
                  <span className="ml-2 text-xs text-gray-500">
                    {severity === 'low' &&
                      t('permissions.access.low', { defaultValue: 'Read-only access' })}
                    {severity === 'medium' &&
                      t('permissions.access.medium', { defaultValue: 'Modification access' })}
                    {severity === 'high' &&
                      t('permissions.access.high', { defaultValue: 'Advanced access' })}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      
      <div className="text-xs text-gray-500 mt-2">
        <p>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-xs font-medium bg-success/15 text-success mr-1">
            <CheckCircleIcon className="h-3 w-3 mr-0.5" />{' '}
            {t('permissions.severity.low', { defaultValue: 'Low' })}
          </span>{' '}
          {t('permissions.legend.low', {
            defaultValue: 'Read-only permissions allow the extension to view data but not modify it.',
          })}
        </p>
        <p className="mt-1">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-xs font-medium bg-warning/15 text-warning-foreground mr-1">
            <AlertTriangleIcon className="h-3 w-3 mr-0.5" />{' '}
            {t('permissions.severity.medium', { defaultValue: 'Medium' })}
          </span>{' '}
          {t('permissions.legend.medium', {
            defaultValue: 'Modification permissions allow the extension to update existing data.',
          })}
        </p>
        <p className="mt-1">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-xs font-medium bg-destructive/15 text-destructive mr-1">
            <XCircleIcon className="h-3 w-3 mr-0.5" />{' '}
            {t('permissions.severity.high', { defaultValue: 'High' })}
          </span>{' '}
          {t('permissions.legend.high', {
            defaultValue:
              'Advanced permissions allow the extension to create, delete, or execute operations.',
          })}
        </p>
      </div>
    </div>
  );
}